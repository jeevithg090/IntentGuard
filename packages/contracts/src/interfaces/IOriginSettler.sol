// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Minimal ERC-7683-inspired surface (emerging standard with live implementations).
/// IntentGuard uses the order/execution split: the vault opens orders, the solver fills them.
struct OnchainCrossChainOrder {
    uint32 fillDeadline;   // seconds timestamp; refund/cancel path unlocks after this
    bytes32 orderDataType; // e.g. keccak256("IntentGuardV1")
    bytes orderData;       // canonical layout, see OrderData below
}

interface IOriginSettler {
    function open(OnchainCrossChainOrder calldata order) external;
}

/// Canonical IntentGuard orderData layout shared by the vault, settlers and the backend.
///
///   (address user,               // the vault depositor whose policy governs this order
///    address inputToken,         // must equal vault.token()
///    uint256 inputAmount,        // notional in token units (USDC 6dp)
///    uint256 minOutput,          // minimum destination output
///    uint256 destinationChainId, // where the solver settles
///    address settler,            // chosen execution route; must be in the merkle root
///    address recipient,          // destination recipient
///    bytes   destinationData)    // opaque to the vault; parsed by the settler
library OrderData {
    function decode(bytes calldata data)
        internal
        pure
        returns (
            address user,
            address inputToken,
            uint256 inputAmount,
            uint256 minOutput,
            uint256 destinationChainId,
            address settler,
            address recipient,
            bytes memory destinationData
        )
    {
        (user, inputToken, inputAmount, minOutput, destinationChainId, settler, recipient, destinationData) =
            abi.decode(data, (address, address, uint256, uint256, uint256, address, address, bytes));
    }

    function orderId(OnchainCrossChainOrder memory order) internal pure returns (bytes32) {
        return keccak256(abi.encode(order));
    }
}
