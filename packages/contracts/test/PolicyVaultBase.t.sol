// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockOriginSettler} from "../src/mocks/MockOriginSettler.sol";
import {IOriginSettler, OnchainCrossChainOrder, OrderData} from "../src/interfaces/IOriginSettler.sol";

/// Shared fixture + EIP-712 attestation signing helpers.
contract PolicyVaultBase is Test {
    using OrderData for OnchainCrossChainOrder;

    PolicyVault public vault;
    MockUSDC public usdc;
    MockOriginSettler public settler;
    MockOriginSettler public settlerB;

    address public user;
    uint256 public userKey;
    address public attestor;
    uint256 public attestorKey;

    bytes32 public ORDER_TYPE = keccak256("IntentGuardV1");

    uint64 public constant NOTIONAL_5K = 5_000e6;

    function setUp() public virtual {
        (user, userKey) = makeAddrAndKey("user");
        (attestor, attestorKey) = makeAddrAndKey("attestor");
        usdc = new MockUSDC();
        settler = new MockOriginSettler(address(usdc));
        settlerB = new MockOriginSettler(address(usdc));
        vault = new PolicyVault(address(usdc), attestor);
        usdc.mint(user, 1_000_000e6);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000e6);
        vm.stopPrank();
    }

    function leafOf(address a) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(a));
    }

    function merkleRoot(address a, address b) public pure returns (bytes32) {
        bytes32 la = leafOf(a);
        bytes32 lb = leafOf(b);
        return la <= lb ? keccak256(abi.encodePacked(la, lb)) : keccak256(abi.encodePacked(lb, la));
    }

    function defaultPolicy() public view returns (PolicyVault.Policy memory) {
        return PolicyVault.Policy({
            maxRiskTier: 2,
            maxFeeBps: 50,
            maxNotionalPerTx: 10_000e6,
            dailyBudget: 25_000e6,
            minFillDeadline: 30 minutes,
            allowedSettlersRoot: merkleRoot(address(settler), address(settlerB)),
            expiry: uint64(block.timestamp + 365 days)
        });
    }

    function encodeOrderData(
        address orderUser,
        uint256 inputAmount,
        uint256 minOutput,
        uint256 destChainId,
        address destSettler,
        address recipient
    ) public view returns (bytes memory) {
        return abi.encode(orderUser, address(usdc), inputAmount, minOutput, destChainId, destSettler, recipient, "");
    }

    function orderFor(address orderUser, uint256 inputAmount, address destSettler, uint32 fillDeadline)
        public
        view
        returns (OnchainCrossChainOrder memory)
    {
        return OnchainCrossChainOrder({
            fillDeadline: fillDeadline,
            orderDataType: ORDER_TYPE,
            orderData: encodeOrderData(orderUser, inputAmount, inputAmount * 95 / 100, 42_161, destSettler, orderUser)
        });
    }

    function defaultOrder(address orderUser, uint256 inputAmount, address destSettler)
        public
        view
        returns (OnchainCrossChainOrder memory)
    {
        return orderFor(orderUser, inputAmount, destSettler, uint32(block.timestamp + 1 hours));
    }

    function signAttestation(
        PolicyVault.RiskAttestation memory att,
        uint256 key
    ) public view returns (bytes memory) {
        bytes32 digest = vault.hashAttestation(att);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function attestationFor(
        OnchainCrossChainOrder memory order,
        uint8 tier,
        uint16 feeBps,
        uint64 expiry
    ) public view returns (PolicyVault.RiskAttestation memory) {
        return PolicyVault.RiskAttestation({
            orderId: OrderData.orderId(order),
            riskTier: tier,
            feeBps: feeBps,
            simHash: keccak256("sim"),
            expiry: expiry,
            nonce: vault.currentNonce()
        });
    }

    function proofFor(address destSettler) public view returns (bytes32[] memory) {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = destSettler == address(settler) ? leafOf(address(settlerB)) : leafOf(address(settler));
        return proof;
    }
}
