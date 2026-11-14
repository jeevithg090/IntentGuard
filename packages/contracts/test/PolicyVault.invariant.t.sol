// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IOriginSettler, OnchainCrossChainOrder} from "../src/interfaces/IOriginSettler.sol";
import {PolicyVaultBase} from "./PolicyVaultBase.t.sol";

/// Handler + invariants: no matter what sequence of calls arrives (fuzzed),
/// the vault's safety properties hold.
contract PolicyVaultHandler is PolicyVaultBase {
    uint256 public ordersOpenedWhilePaused;
    bytes32[] public acceptedAttIds;
    uint256 public successfulOpens;

    function acceptedAttIdsLength() public view returns (uint256) {
        return acceptedAttIds.length;
    }

    function tryOpen(uint256 notionalSeed, uint8 tierSeed, uint16 feeSeed, uint256 deadlineSeed) external {
        uint256 notional = bound(notionalSeed, 1, 10_000e6);
        uint8 tier = uint8(bound(tierSeed, 1, 4));
        uint16 fee = uint16(bound(feeSeed, 0, 50));
        uint32 fillDeadline = uint32(block.timestamp + bound(deadlineSeed, 30 minutes, 2 days));

        // Refill the user so budget logic is what constrains, not token balance.
        usdc.mint(user, 1_000_000e6);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000e6);
        vm.stopPrank();

        OnchainCrossChainOrder memory order = orderFor(user, notional, address(settler), fillDeadline);
        PolicyVault.RiskAttestation memory att = attestationFor(order, tier, fee, uint64(block.timestamp + 1 hours));
        bytes memory sig = signAttestation(att, attestorKey);
        bytes32 attId = keccak256(abi.encode(att));

        bool wasPaused = vault.paused();
        try vault.openWithPolicy(order, att, sig, proofFor(address(settler))) {
            if (wasPaused) ordersOpenedWhilePaused++;
            acceptedAttIds.push(attId);
            successfulOpens++;
        } catch {}
    }

    function pauseNow() external {
        vm.prank(attestor);
        vault.pause();
    }
}

contract PolicyVaultInvariantTest is StdInvariant, Test {
    PolicyVaultHandler public handler;

    function setUp() public {
        handler = new PolicyVaultHandler();
        handler.setUp();
        targetContract(address(handler));
    }

    /// The rolling window spends can never exceed the committed daily budget.
    function invariant_SpentTodayNeverExceedsDailyBudget() public view {
        PolicyVault.Policy memory policy = handler.vault().policyOf(handler.user());
        assertLe(handler.vault().spentToday(handler.user()), policy.dailyBudget, "daily budget breached");
    }

    /// A paused vault never opens an order, even under arbitrary call sequences.
    function invariant_PausedVaultNeverOpensOrders() public view {
        assertEq(handler.ordersOpenedWhilePaused(), 0, "order opened while paused");
    }

    /// No call sequence can make the replay guard accept an already-used attestation.
    function invariant_NoAttestationUsedTwice() public view {
        uint256 n = handler.acceptedAttIdsLength();
        bytes32[] memory ids = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = handler.acceptedAttIds(i);
        }
        for (uint256 i = 0; i < ids.length; i++) {
            for (uint256 j = i + 1; j < ids.length; j++) {
                assertTrue(ids[i] != ids[j], "attestation accepted twice");
            }
        }
    }

    /// The vault's token balance must always equal the sum of user deposits —
    /// no sequence of calls can make the vault retain or lose funds.
    function invariant_VaultBalanceEqualsDeposits() public view {
        MockUSDC usdc = handler.usdc();
        PolicyVault vault = handler.vault();
        assertEq(usdc.balanceOf(address(vault)), vault.deposits(handler.user()), "vault balance != deposits");
    }
}
