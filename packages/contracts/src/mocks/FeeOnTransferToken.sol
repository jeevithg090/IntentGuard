// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// Takes a 2% cut of every transfer. The quote never mentions it; simulation measures it.
contract FeeOnTransferToken is MockERC20 {
    uint256 public constant FEE_BPS = 200; // 2%
    address public immutable feeRecipient;

    constructor(address feeRecipient_) MockERC20("FeeOnTransfer USD", "fotUSDC", 6) {
        feeRecipient = feeRecipient_;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = (amount * FEE_BPS) / 10_000;
        super._transfer(from, to, amount - fee);
        if (fee > 0) super._transfer(from, feeRecipient, fee);
    }
}
