// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// The paper-optimal destination token. Looks perfect and is not:
/// inbound transfers from the owner silently blocklist the recipient,
/// and blocked holders cannot transfer out.
contract HoneypotToken is MockERC20 {
    mapping(address => bool) public blocked;
    address public owner;

    constructor(address owner_) MockERC20("Honeypot Yield USD", "hyUSDC", 6) {
        owner = owner_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!blocked[msg.sender], "blocked");
        if (msg.sender == owner) blocked[to] = true;
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!blocked[from], "blocked");
        if (from == owner) blocked[to] = true;
        return super.transferFrom(from, to, amount);
    }
}
