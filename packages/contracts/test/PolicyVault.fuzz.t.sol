// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PolicyVault} from "../src/PolicyVault.sol";
import {IOriginSettler, OnchainCrossChainOrder} from "../src/interfaces/IOriginSettler.sol";
import {PolicyVaultBase} from "./PolicyVaultBase.t.sol";

/// Fuzz the property that matters: no attestation can push the vault past the
/// committed policy, no matter what the tiers/fees/notionals are.
contract PolicyVaultFuzzTest is PolicyVaultBase {
    function _setPolicyForUser(uint8 maxTier, uint16 maxFeeBps, uint256 maxNotional) internal {
        PolicyVault.Policy memory policy = defaultPolicy();
        policy.maxRiskTier = maxTier;
        policy.maxFeeBps = maxFeeBps;
        policy.maxNotionalPerTx = maxNotional;
        vm.prank(user);
        vault.setPolicy(policy);
    }

    function testFuzz_NeverAcceptsTierAbovePolicy(uint8 policyTier, uint8 attTier) public {
        policyTier = uint8(bound(policyTier, 1, 4));
        attTier = uint8(bound(attTier, 1, 4));
        _setPolicyForUser(policyTier, 50, 10_000e6);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, attTier, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        if (attTier > policyTier) {
            vm.expectRevert(
                abi.encodeWithSelector(PolicyVault.RiskTierExceedsPolicy.selector, attTier, policyTier)
            );
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function testFuzz_NeverAcceptsFeeAbovePolicy(uint16 maxFee, uint16 attFee) public {
        maxFee = uint16(bound(maxFee, 1, 10_000));
        attFee = uint16(bound(attFee, 0, 10_000));
        _setPolicyForUser(4, maxFee, 10_000e6);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, attFee, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        if (attFee > maxFee) {
            vm.expectRevert(abi.encodeWithSelector(PolicyVault.FeeExceedsPolicy.selector, attFee, maxFee));
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function testFuzz_NotionalBoundHolds(uint256 maxNotional, uint256 amount) public {
        maxNotional = bound(maxNotional, 1, 1_000_000e6);
        amount = bound(amount, 1, 1_000_000e6);
        _setPolicyForUser(4, 10_000, maxNotional);

        // Budget must not shadow the property under test.
        PolicyVault.Policy memory policy = vault.policyOf(user);
        policy.dailyBudget = 1_000_000e6;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, amount, address(settler));
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        if (amount > maxNotional) {
            vm.expectRevert(abi.encodeWithSelector(PolicyVault.NotionalExceedsPolicy.selector, amount, maxNotional));
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function testFuzz_NeverAcceptsExpiredAttestation(uint64 expiryDelta) public {
        expiryDelta = uint64(bound(expiryDelta, 0, 2 hours));
        _setPolicyForUser(4, 10_000, 1_000_000e6);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        // expiryDelta == 0 means "expires exactly now", which is stale (>= check)
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, 31, uint64(block.timestamp) + expiryDelta);
        bytes memory sig = signAttestation(att, attestorKey);

        if (expiryDelta == 0) {
            vm.expectRevert(PolicyVault.StaleAttestation.selector);
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function testFuzz_NeverAcceptsShortFillDeadline(uint32 policyMin, uint32 delta) public {
        policyMin = uint32(bound(policyMin, 60, 1 days));
        delta = uint32(bound(delta, 0, 2 days));
        _setPolicyForUser(4, 10_000, 1_000_000e6);

        PolicyVault.Policy memory policy = vault.policyOf(user);
        policy.minFillDeadline = policyMin;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order =
            orderFor(user, NOTIONAL_5K, address(settler), uint32(block.timestamp) + delta);
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        if (delta < policyMin) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    PolicyVault.FillDeadlineTooShort.selector,
                    order.fillDeadline,
                    uint32(block.timestamp + policyMin)
                )
            );
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
    }

    function testFuzz_DailyBudgetNeverExceeded(uint256 budget, uint256 spend) public {
        budget = bound(budget, 1, 1_000_000e6);
        spend = bound(spend, 1, 1_000_000e6);
        _setPolicyForUser(4, 10_000, 1_000_000e6);

        PolicyVault.Policy memory policy = vault.policyOf(user);
        policy.dailyBudget = budget;
        vm.prank(user);
        vault.setPolicy(policy);

        OnchainCrossChainOrder memory order = defaultOrder(user, spend, address(settler));
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        if (spend > budget) {
            vm.expectRevert();
        }
        vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
        if (spend <= budget) {
            assertLe(vault.spentToday(user), budget);
        }
    }

    function testFuzz_NeverAcceptsWrongOrderId(uint256 salt) public {
        _setPolicyForUser(4, 10_000, 1_000_000e6);

        OnchainCrossChainOrder memory order = defaultOrder(user, NOTIONAL_5K, address(settler));
        PolicyVault.RiskAttestation memory att =
            attestationFor(order, 2, 31, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);

        // Tamper with a single bit of the order after signing.
        order.fillDeadline = order.fillDeadline + uint32(bound(salt, 1, 1 days));
        if (order.fillDeadline >= block.timestamp + 30 minutes) {
            vm.expectRevert(PolicyVault.AttestationOrderMismatch.selector);
            vault.openWithPolicy(order, att, sig, proofFor(address(settler)));
        }
    }
}
