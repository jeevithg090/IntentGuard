// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// USDC stand-in for the demo (6 decimals, freely mintable).
contract MockUSDC is MockERC20 {
    constructor() MockERC20("Mock USD Coin", "USDC", 6) {}
}
