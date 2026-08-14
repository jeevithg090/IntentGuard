// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockOriginSettler} from "../src/mocks/MockOriginSettler.sol";

/// Deploys the vault + mock settler + USDC, sets a demo policy, and funds the vault's
/// depositor with spendable USDC. Run with:
///   forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
contract Deploy is Script {
    function leafOf(address a) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(a));
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        address demoUser = vm.envAddress("DEMO_USER_ADDRESS");

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        MockOriginSettler settler = new MockOriginSettler(address(usdc));
        PolicyVault vault = new PolicyVault(address(usdc), attestor);

        // Demo policy: tier <= 2, fee <= 50bps, $10k/tx, $25k/day, 30min fill deadline.
        bytes32 root = leafOf(address(settler));
        PolicyVault.Policy memory policy = PolicyVault.Policy({
            maxRiskTier: 2,
            maxFeeBps: 50,
            maxNotionalPerTx: 10_000e6,
            dailyBudget: 25_000e6,
            minFillDeadline: 30 minutes,
            allowedSettlersRoot: root,
            expiry: uint64(block.timestamp + 365 days)
        });
        vault.setPolicy(policy);

        // Fund the demo user and pre-approve the vault (one less demo step on stage).
        usdc.mint(demoUser, 100_000e6);

        vm.stopBroadcast();

        console2.log("USDC       :", address(usdc));
        console2.log("Settler    :", address(settler));
        console2.log("Vault      :", address(vault));
        console2.log("Attestor   :", attestor);
        console2.log("DemoUser   :", demoUser);
    }
}
