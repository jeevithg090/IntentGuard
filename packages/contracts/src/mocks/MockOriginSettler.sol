// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IOriginSettler, OnchainCrossChainOrder, OrderData} from "../interfaces/IOriginSettler.sol";
import {MockERC20} from "./MockERC20.sol";

/// Mock ERC-7683 origin settler: pulls the order's input from the caller (the vault),
/// records the open, and lets the demo mark fills. The solverHistory signal reads
/// OrderOpened/OrderFilled events from this contract.
contract MockOriginSettler is IOriginSettler {
    event OrderOpened(
        bytes32 indexed orderId, address indexed caller, address indexed settler, uint256 inputAmount, uint32 fillDeadline
    );
    event OrderFilled(bytes32 indexed orderId, uint256 filledAt, uint256 outputAmount);

    address public immutable token; // pulled from msg.sender on open()

    mapping(bytes32 => bool) public filled;
    uint256 public opens;

    constructor(address token_) {
        token = token_;
    }

    function open(OnchainCrossChainOrder calldata order) external {
        (address user, address inputToken, uint256 inputAmount,,, address settler,,) = OrderData.decode(order.orderData);
        require(settler == address(this), "SettlerNotSelf");
        require(inputToken == token, "WrongToken");
        require(user != address(0), "NoUser");

        MockERC20(token).transferFrom(msg.sender, address(this), inputAmount);
        opens++;
        emit OrderOpened(OrderData.orderId(order), msg.sender, address(this), inputAmount, order.fillDeadline);
    }

    /// Demo helper: the solver claims it filled the order.
    function fill(bytes32 orderId_, uint256 outputAmount) external {
        filled[orderId_] = true;
        emit OrderFilled(orderId_, block.timestamp, outputAmount);
    }
}
