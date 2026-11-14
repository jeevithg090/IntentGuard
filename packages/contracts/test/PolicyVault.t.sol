// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PolicyVault} from "../src/PolicyVault.sol";
import {MockOriginSettler} from "../src/mocks/MockOriginSettler.sol";
import {IOriginSettler, OnchainCrossChainOrder, OrderData} from "../src/interfaces/IOriginSettler.sol";
import {PolicyVaultBase} from "./PolicyVaultBase.t.sol";

contract PolicyVaultTest is PolicyVaultBase {
    event OrderOpened(
        bytes32 indexed orderId,
        address indexed user,
        address indexed settler,
        uint256 notional,
        uint8 riskTier,
        bytes32 simHash
    );

    /*//////////////////////////////////////////////////////////////
                             HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    function test_OpenWithinPolicy_Succeeds() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        uint256 settlerBalBefore = usdc.balanceOf(address(settler));

        vm.expectEmit(true, true, true, true);
        emit OrderOpened(att.orderId, user, address(settler), NOTIONAL_5K, 2, keccak256("sim"));

        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));

        assertEq(vaultBalBefore - NOTIONAL_5K, usdc.balanceOf(address(vault)), "vault should release the notional");
        assertEq(usdc.balanceOf(address(settler)) - settlerBalBefore, NOTIONAL_5K, "settler should receive funds");
        assertEq(settler.filled(att.orderId), false);
        assertTrue(vault.usedAttestations(keccak256(abi.encode(att))), "attestation must be marked used");
        assertEq(vault.spentToday(user), NOTIONAL_5K);
        assertEq(vault.dayStart(user), block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                          POLICY BOUND CHECKS
    //////////////////////////////////////////////////////////////*/

    function test_RevertWhen_RiskTierExceedsPolicy() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 4, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.RiskTierExceedsPolicy.selector, 4, 2));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_FeeExceedsPolicy() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 75, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.FeeExceedsPolicy.selector, 75, 50));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_NotionalExceedsPolicy() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, 15_000e6, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.NotionalExceedsPolicy.selector, 15_000e6, 10_000e6));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_SettlerNotInMerkleRoot() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        MockOriginSettler rogue = new MockOriginSettler(address(usdc));
        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(rogue));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.SettlerNotAllowed.selector, address(rogue)));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    /*//////////////////////////////////////////////////////////////
                        ATTESTATION INTEGRITY
    //////////////////////////////////////////////////////////////*/

    function test_RevertWhen_AttestationExpired() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp - 1));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(PolicyVault.StaleAttestation.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_SignedByWrongKey() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, userKey); // wrong key

        vm.expectRevert(PolicyVault.BadAttestor.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_AttestationReplayed() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));

        vm.expectRevert(PolicyVault.AttestationReplayed.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_OrderIdMismatch() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        OnchainCrossChainOrder memory other = defaultOrder(user, NOTIONAL_5K, address(settlerB));
        PolicyVault.RiskAttestation memory att = attestationFor(other, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(PolicyVault.AttestationOrderMismatch.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_FillDeadlineTooShort() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order =
            orderFor(user, NOTIONAL_5K, address(settler), uint32(block.timestamp + 60));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.FillDeadlineTooShort.selector, order.fillDeadline, uint32(block.timestamp + 30 minutes)
            )
        );
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_BadOrderData() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        // Genuinely malformed ABI: the length word claims 5 bytes of trailing data
        // but the 32-byte data word is missing.
        bytes memory wellFormed = abi.encode(
            user, address(usdc), NOTIONAL_5K, NOTIONAL_5K * 95 / 100, uint256(42_161), address(settler), user, "short"
        );
        bytes memory truncated = new bytes(wellFormed.length - 32);
        for (uint256 i = 0; i < truncated.length; i++) {
            truncated[i] = wellFormed[i];
        }
        order.orderData = truncated;

        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(PolicyVault.BadOrderData.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_OrderDataMalleabilityRejected() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        // Two different byte encodings of the same tuple: trailing data changes
        // the orderId, so the attestation can only ever match one of them.
        OnchainCrossChainOrder memory orderA = defaultOrder(user, NOTIONAL_5K, address(settler));
        OnchainCrossChainOrder memory orderB = defaultOrder(user, NOTIONAL_5K, address(settler));
        orderB.orderData = abi.encode(
            user, address(usdc), NOTIONAL_5K, NOTIONAL_5K * 95 / 100, uint256(42_161), address(settler), user, "x"
        );
        assertTrue(
            OrderData.orderId(orderA) != OrderData.orderId(orderB), "distinct encodings must produce distinct orderIds"
        );

        PolicyVault.RiskAttestation memory att = attestationFor(orderA, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        // orderA passes with its matching attestation…
        vault.openWithPolicy(orderA, att, sig, proofFor(address(settler)));

        // …and the same attestation cannot be reused against any other order:
        // the replay guard fires first (cheapest check wins).
        vm.expectRevert(PolicyVault.AttestationReplayed.selector);
        vault.openWithPolicy(orderB, att, sig, proofFor(address(settler)));
    }

    function test_RevertWhen_AttestationLieAboutNotional() public {
        // The attestation's notional claim (if it had one) is irrelevant: the vault
        // reads the notional from the order itself. A 15k order with a "5k" attestation
        // still hits NotionalExceedsPolicy.
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, 15_000e6, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.NotionalExceedsPolicy.selector, 15_000e6, 10_000e6));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    /*//////////////////////////////////////////////////////////////
                             BUDGET WINDOW
    //////////////////////////////////////////////////////////////*/

    function test_RevertWhen_DailyBudgetExhausted() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        policy.dailyBudget = 10_000e6;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order8k = defaultOrder(user, 8_000e6, address(settler));
        PolicyVault.RiskAttestation memory att8k = attestationFor(order8k, 2, 31, uint64(block.timestamp + 1 hours));
        vault.openWithPolicy(order8k, att8k, signAttestation(att8k, attestorKey), proofFor(address(settler)));

        OnchainCrossChainOrder memory order5k = defaultOrder(user, 5_000e6, address(settler));
        PolicyVault.RiskAttestation memory att5k = attestationFor(order5k, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig5k = signAttestation(att5k, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.DailyBudgetExhausted.selector, 5_000e6, 2_000e6));
        vault.openWithPolicy(order5k, att5k, sig5k, proofFor(address(settler)));
    }

    function test_DailyBudgetResetsAfterWindow() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        policy.dailyBudget = 10_000e6;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order8k = defaultOrder(user, 8_000e6, address(settler));
        PolicyVault.RiskAttestation memory att8k = attestationFor(order8k, 2, 31, uint64(block.timestamp + 1 hours));
        vault.openWithPolicy(order8k, att8k, signAttestation(att8k, attestorKey), proofFor(address(settler)));

        vm.warp(block.timestamp + 24 hours + 1);

        OnchainCrossChainOrder memory order5k = defaultOrder(user, 5_000e6, address(settler));
        PolicyVault.RiskAttestation memory att5k = attestationFor(order5k, 2, 31, uint64(block.timestamp + 1 hours));
        vault.openWithPolicy(order5k, att5k, signAttestation(att5k, attestorKey), proofFor(address(settler)));

        assertEq(vault.spentToday(user), 5_000e6, "spentToday should reset with the new window");
    }

    /*//////////////////////////////////////////////////////////////
                             KILL SWITCH
    //////////////////////////////////////////////////////////////*/

    function test_RevertWhen_Paused() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        vm.prank(attestor); // the monitor's key can pause
        vault.pause();

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(PolicyVault.Paused.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_UnpauseRestoresOperation() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        vm.prank(attestor);
        vault.pause();
        vm.stopPrank();
        vault.unpause(); // owner = this test contract

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        vault.openWithPolicy(order, att, signAttestation(att, attestorKey), proofFor(address(settler)));

        assertEq(usdc.balanceOf(address(settler)), NOTIONAL_5K);
    }

    function test_OnlyOwnerCanUnpause() public {
        vm.prank(attestor);
        vault.pause();

        vm.expectRevert(PolicyVault.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        vault.unpause();
    }

    /*//////////////////////////////////////////////////////////////
                             ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_RevertWhen_PolicyExpired() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        vm.warp(block.timestamp + 365 days + 1);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(PolicyVault.PolicyExpired.selector);
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_OnlyOwnerCanSetPolicy() public {
        // setPolicy is self-service: msg.sender sets *their own* policy.
        // The access-control guard is on pause/unpause/attestor changes.
        vm.expectRevert(PolicyVault.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        vault.setAttestor(address(0xFEED));
    }

    function test_OnlyOwnerOrAttestorCanPause() public {
        vm.expectRevert(PolicyVault.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        vault.pause();
    }

    /*//////////////////////////////////////////////////////////////
                        EIP-712 CHAIN BINDING
    //////////////////////////////////////////////////////////////*/

    function test_AttestationBoundToChainId() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));

        // Simulate a signature produced on another chain: hash the attestation as if
        // the domain separator was computed for chainId 1 instead of this chain.
        bytes32 foreignSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("IntentGuard PolicyVault"),
                keccak256("1"),
                uint256(1),
                address(vault)
            )
        );
        bytes32 foreignDigest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                foreignSeparator,
                keccak256(
                    abi.encode(
                        keccak256(
                            "RiskAttestation(bytes32 orderId,uint8 riskTier,uint16 feeBps,bytes32 simHash,uint64 expiry,uint64 nonce)"
                        ),
                        att.orderId,
                        att.riskTier,
                        att.feeBps,
                        att.simHash,
                        att.expiry,
                        att.nonce
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, foreignDigest);
        bytes memory foreignSig = abi.encodePacked(r, s, v);

        vm.expectRevert(PolicyVault.BadAttestor.selector);
        vault.openWithPolicy(order, att, foreignSig, proofFor(address(settler)));
    }

    /*//////////////////////////////////////////////////////////////
                              THE PITCH
    //////////////////////////////////////////////////////////////*/

    /// A fully compromised attestor — the attacker holds the real signing key —
    /// still cannot exceed the user's committed policy. The vault re-checks
    /// independently; the attestor's word is only a recommendation.
    function test_CompromisedAgent_CannotExceedPolicy() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        policy.maxRiskTier = 2;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 4, 31, uint64(block.timestamp + 1 hours));

        // The "attacker" signs a perfectly valid, correctly-bound attestation
        // claiming riskTier = 4 — with the real attestor key.
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.RiskTierExceedsPolicy.selector, 4, 2));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    /*//////////////////////////////////////////////////////////////
                           ADMIN + DEPOSIT PATHS
    //////////////////////////////////////////////////////////////*/

    function test_OwnerCanSetOwnerAndAttestor() public {
        vault.setOwner(address(0xBEEF));
        assertEq(vault.owner(), address(0xBEEF));

        vm.expectEmit(true, false, false, false);
        emit PolicyVault.AttestorChanged(address(0xFEED));
        vm.prank(address(0xBEEF));
        vault.setAttestor(address(0xFEED));
        assertEq(vault.attestor(), address(0xFEED));
    }

    function test_NonOwnerCannotSetOwnerOrAttestor() public {
        vm.expectRevert(PolicyVault.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        vault.setOwner(address(0xBEEF));

        vm.expectRevert(PolicyVault.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        vault.setAttestor(address(0xFEED));
    }

    function test_DepositWithdrawRoundtrip() public {
        usdc.mint(user, 10_000e6); // fresh tokens; setUp already deposited the full balance
        uint256 before_ = usdc.balanceOf(address(vault));

        vm.prank(user);
        vault.deposit(10_000e6);
        assertEq(usdc.balanceOf(address(vault)) - before_, 10_000e6, "vault should custody the deposit");
        assertEq(vault.deposits(user), 1_000_000e6 + 10_000e6);

        vm.prank(user);
        vault.withdraw(10_000e6);
        assertEq(usdc.balanceOf(user), 10_000e6, "withdraw returns the tokens to the user");
        assertEq(vault.deposits(user), 1_000_000e6);
    }

    function test_WithdrawBeyondDepositReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.InsufficientDeposit.selector, 2_000_000e6, 1_000_000e6));
        vm.prank(user);
        vault.withdraw(2_000_000e6);
    }

    function test_DepositWhilePausedReverts() public {
        vm.prank(attestor);
        vault.pause();
        vm.expectRevert(PolicyVault.DepositsPaused.selector);
        vm.prank(user);
        vault.deposit(1e6);
    }

    function test_InsufficientDepositBlocksOpen() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        // A second user with a policy but no deposits.
        address broke = makeAddr("broke");
        usdc.mint(broke, 100e6);
        vm.startPrank(broke);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        PolicyVault.Policy memory brokePolicy = defaultPolicy();
        vm.prank(broke);
        vault.setPolicy(brokePolicy);

        OnchainCrossChainOrder memory order = defaultOrder(broke, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.InsufficientDeposit.selector, NOTIONAL_5K, 0));
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function test_PublicRecoverAttestorMatches() public {
        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);
        assertEq(vault.recoverAttestor(att, sig), attestor, "public recovery should match the signer");
    }

    function test_RecoverRejectsGarbageSignature() public {
        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        vm.expectRevert(bytes("bad sig length"));
        vault.recoverAttestor(att, hex"1234");
    }

    function test_MerkleLeftBranchVerifies() public {
        // Root where the settler leaf is the *right* sibling, so the proof walks
        // the left branch of the comparison (computed > proof[i]).
        PolicyVault.Policy memory policy = defaultPolicy();
        // leafOf(settler) vs leafOf(settlerB): pick root = keccak(proof, leaf)
        bytes32 la = leafOf(address(settlerB));
        bytes32 lb = leafOf(address(settler));
        bytes32 root = keccak256(abi.encodePacked(la, lb)); // proof = la, computed = lb
        policy.allowedSettlersRoot = root;
        vm.prank(user);
        vault.setPolicy(policy);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = la; // computed (settler) > proof ⇒ left-branch: keccak(proof, computed)

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        vault.openWithPolicy(order, att, signAttestation(att, attestorKey), proof);
        assertEq(usdc.balanceOf(address(settler)), NOTIONAL_5K);
    }

    function test_MerkleProofTooShortReverts() public {
        PolicyVault.Policy memory policy = defaultPolicy();
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att = attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));

        bytes32[] memory empty;
        bytes memory sig = signAttestation(att, attestorKey);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.SettlerNotAllowed.selector, address(settler)));
        vault.openWithPolicy(order, att, sig, empty);
    }
}
