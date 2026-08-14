// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IOriginSettler, OnchainCrossChainOrder, OrderData} from "./interfaces/IOriginSettler.sol";

/// IntentGuard PolicyVault — the only thing that decides what is permitted.
///
/// The vault holds user funds and is the sole caller of IOriginSettler.open().
/// The backend (attestor) may recommend; the vault re-checks every field of the
/// attestation against the user's committed policy, so a compromised or lying
/// attestor can never exceed the mandate. "The chain enforces it."
contract PolicyVault {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error Unauthorized();
    error Paused();
    error StaleAttestation();
    error AttestationReplayed();
    error BadAttestor();
    error AttestationOrderMismatch();
    error RiskTierExceedsPolicy(uint8 attestationTier, uint8 policyTier);
    error FeeExceedsPolicy(uint16 attestationFeeBps, uint16 policyFeeBps);
    error NotionalExceedsPolicy(uint256 notional, uint256 policyMax);
    error FillDeadlineTooShort(uint32 fillDeadline, uint32 minRequired);
    error SettlerNotAllowed(address settler);
    error DailyBudgetExhausted(uint256 wouldSpend, uint256 remaining);
    error PolicyExpired();
    error BadOrderData();
    error InsufficientDeposit(uint256 requested, uint256 deposited);
    error DepositsPaused();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    struct Policy {
        uint8 maxRiskTier; // 1..4
        uint16 maxFeeBps;
        uint256 maxNotionalPerTx;
        uint256 dailyBudget; // rolling window, enforced on-chain
        uint32 minFillDeadline; // floor on the refund window, seconds
        bytes32 allowedSettlersRoot; // merkle root of permitted settlers
        uint64 expiry;
    }

    struct RiskAttestation {
        bytes32 orderId; // keccak256(abi.encode(order))
        uint8 riskTier; // 1..4, computed by the oracle
        uint16 feeBps;
        bytes32 simHash; // binds Feature 3's simulation result
        uint64 expiry;
        uint64 nonce; // replay protection
    }

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event PolicySet(address indexed user, Policy policy);
    event OrderOpened(
        bytes32 indexed orderId,
        address indexed user,
        address indexed settler,
        uint256 notional,
        uint8 riskTier,
        bytes32 simHash
    );
    event PauseStateChanged(bool paused);
    event AttestorChanged(address indexed newAttestor);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable token;

    mapping(address => Policy) public policies;
    mapping(address => uint256) public spentToday;
    mapping(address => uint64) public dayStart;
    mapping(bytes32 => bool) public usedAttestations; // replay guard
    mapping(address => uint256) public deposits; // per-user custodied balance

    address public owner;
    address public attestor;
    bool public paused;
    uint64 public currentNonce;

    // EIP-712 domain; chainId and verifyingContract are constructor-bound,
    // so an attestation cannot be replayed across deployments or chains.
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "RiskAttestation(bytes32 orderId,uint8 riskTier,uint16 feeBps,bytes32 simHash,uint64 expiry,uint64 nonce)"
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address token_, address attestor_) {
        token = token_;
        owner = msg.sender;
        attestor = attestor_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("IntentGuard PolicyVault"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setAttestor(address newAttestor) external onlyOwner {
        attestor = newAttestor;
        emit AttestorChanged(newAttestor);
    }

    /// Feature 5's kill switch. Owner or attestor guardian may pause;
    /// only the owner (a human) may unpause.
    function pause() external {
        if (msg.sender != owner && msg.sender != attestor) revert Unauthorized();
        paused = true;
        emit PauseStateChanged(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PauseStateChanged(false);
    }

    /*//////////////////////////////////////////////////////////////
                                 POLICY
    //////////////////////////////////////////////////////////////*/

    function setPolicy(Policy calldata policy) external {
        if (policy.maxRiskTier == 0 || policy.maxRiskTier > 4) revert BadOrderData();
        if (policy.expiry <= block.timestamp) revert PolicyExpired();
        policies[msg.sender] = policy;
        emit PolicySet(msg.sender, policy);
    }

    function policyOf(address user) external view returns (Policy memory) {
        return policies[user];
    }

    /*//////////////////////////////////////////////////////////////
                                 DEPOSITS
    //////////////////////////////////////////////////////////////*/

    /// The user's funds live here; the vault is the only caller of settler.open().
    function deposit(uint256 amount) external {
        if (paused) revert DepositsPaused();
        (bool ok,) = token.call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)); // transferFrom
        require(ok, "transfer failed");
        deposits[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// Withdraw any amount not currently committed to open orders.
    function withdraw(uint256 amount) external {
        if (amount > deposits[msg.sender]) revert InsufficientDeposit(amount, deposits[msg.sender]);
        deposits[msg.sender] -= amount;
        (bool ok,) = token.call(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount)); // transfer
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                              OPEN (CORE)
    //////////////////////////////////////////////////////////////*/

    /// The decoded, policy-checked facts of an order. `orderId` is the ERC-7683
    /// canonical id; notional/settler are read from the order, never the attestation.
    struct OrderFacts {
        bytes32 orderId;
        address user;
        address settler;
        uint256 notional;
    }

    /// Open an ERC-7683 order with a backend-issued RiskAttestation.
    /// Checks run cheapest-first; every field is independently re-checked
    /// against the user's committed policy. Order is the sole source of truth:
    /// the attestation's notional, settler and deadline claims are ignored —
    /// they are read from the order itself.
    function openWithPolicy(
        OnchainCrossChainOrder calldata order,
        RiskAttestation calldata att,
        bytes calldata attestorSig,
        bytes32[] calldata settlerProof
    ) external {
        // 1. kill switch
        if (paused) revert Paused();

        // 2. attestation freshness
        if (block.timestamp >= att.expiry) revert StaleAttestation();

        // 3. replay guard
        bytes32 attId = keccak256(abi.encode(att));
        if (usedAttestations[attId]) revert AttestationReplayed();

        // 4. the signature must come from the configured attestor, and be bound
        //    to this deployment and chain via EIP-712
        if (recoverAttestor(att, attestorSig) != attestor) revert BadAttestor();

        // 5. the attestation must describe exactly this order
        if (att.orderId != OrderData.orderId(order)) revert AttestationOrderMismatch();

        // 6..11. decode the order once and re-check every field against the
        //        committed policy; updates the rolling daily budget on-chain
        OrderFacts memory f = _validateAndSpend(order, att, settlerProof);

        // 12. mark the attestation used so it can never be replayed
        usedAttestations[attId] = true;

        // 13. release the custodied funds to the chosen settler
        if (f.notional > deposits[f.user]) revert InsufficientDeposit(f.notional, deposits[f.user]);
        deposits[f.user] -= f.notional;
        _approveAndOpen(order, f.settler, f.notional);

        emit OrderOpened(f.orderId, f.user, f.settler, f.notional, att.riskTier, att.simHash);
    }

    function _validateAndSpend(
        OnchainCrossChainOrder calldata order,
        RiskAttestation calldata att,
        bytes32[] calldata settlerProof
    ) internal returns (OrderFacts memory f) {
        address inputToken;
        // Strict ABI check: 7 static fields (224) + offset word (32) + length word (32)
        // + data padded to 32. The declared length must match the trailing data
        // exactly, so a malleable encoding can never sneak past.
        if (order.orderData.length < 288) revert BadOrderData();
        uint256 dlen = uint256(bytes32(order.orderData[256:288]));
        if (order.orderData.length != 288 + ((dlen + 31) / 32) * 32) revert BadOrderData();
        (f.user, inputToken, f.notional,,, f.settler,,) = OrderData.decode(order.orderData);
        f.orderId = OrderData.orderId(order);
        Policy storage policy = policies[f.user];

        if (inputToken != token || f.notional == 0) revert BadOrderData();
        if (block.timestamp >= policy.expiry) revert PolicyExpired();
        if (att.riskTier > policy.maxRiskTier) revert RiskTierExceedsPolicy(att.riskTier, policy.maxRiskTier);
        if (att.feeBps > policy.maxFeeBps) revert FeeExceedsPolicy(att.feeBps, policy.maxFeeBps);
        if (f.notional > policy.maxNotionalPerTx) revert NotionalExceedsPolicy(f.notional, policy.maxNotionalPerTx);
        if (order.fillDeadline < block.timestamp + policy.minFillDeadline) {
            revert FillDeadlineTooShort(order.fillDeadline, uint32(block.timestamp + policy.minFillDeadline));
        }

        // the chosen settler must be in the policy's merkle root
        bytes32 leaf = keccak256(abi.encodePacked(f.settler));
        if (!_merkleVerify(policy.allowedSettlersRoot, leaf, settlerProof)) revert SettlerNotAllowed(f.settler);

        // rolling daily budget, updated on-chain
        _spend(f.user, f.notional, policy.dailyBudget);
    }

    /*//////////////////////////////////////////////////////////////
                              ATT. VERIFY
    //////////////////////////////////////////////////////////////*/

    function hashAttestation(RiskAttestation calldata att) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(ATTESTATION_TYPEHASH, att.orderId, att.riskTier, att.feeBps, att.simHash, att.expiry, att.nonce)
                )
            )
        );
    }

    function recoverAttestor(RiskAttestation calldata att, bytes calldata signature)
        public
        view
        returns (address)
    {
        bytes32 digest = hashAttestation(att);
        return _recover(digest, signature);
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ecrecover failed");
        return signer;
    }

    /*//////////////////////////////////////////////////////////////
                              MERKLE
    //////////////////////////////////////////////////////////////*/

    function _merkleVerify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (computed <= proof[i]) {
                computed = keccak256(abi.encodePacked(computed, proof[i]));
            } else {
                computed = keccak256(abi.encodePacked(proof[i], computed));
            }
        }
        return computed == root;
    }

    /*//////////////////////////////////////////////////////////////
                              BUDGET
    //////////////////////////////////////////////////////////////*/

    function _spend(address user, uint256 amount, uint256 dailyBudget) internal {
        uint64 now_ = uint64(block.timestamp);
        if (dayStart[user] == 0) dayStart[user] = now_;

        if (now_ >= dayStart[user] + 1 days) {
            // new window
            dayStart[user] = now_;
            spentToday[user] = amount;
            if (amount > dailyBudget) revert DailyBudgetExhausted(amount, 0);
            return;
        }

        uint256 remaining = dailyBudget > spentToday[user] ? dailyBudget - spentToday[user] : 0;
        if (amount > remaining) revert DailyBudgetExhausted(amount, remaining);
        spentToday[user] += amount;
    }

    /*//////////////////////////////////////////////////////////////
                              FORWARD
    //////////////////////////////////////////////////////////////*/

    function _approveAndOpen(OnchainCrossChainOrder calldata order, address settler, uint256 notional) internal {
        (bool ok,) = token.call(abi.encodeWithSelector(0x095ea7b3, settler, notional)); // approve(address,uint256)
        require(ok, "approve failed");
        IOriginSettler(settler).open(order);
    }
}
