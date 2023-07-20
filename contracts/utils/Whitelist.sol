// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "./AccessProtected.sol";

contract Whitelist is AccessProtected {
    mapping(address => bool) public whitelisted;
    event WhitelistAdded(address indexed investor);
    event WhitelistRemoved(address indexed investor);

    function addToWhitelist(address _investor) external onlyAdmin {
        require(!whitelisted[_investor], "already whitelisted");
        whitelisted[_investor] = true;
        emit WhitelistAdded(_investor);
    }

    function removeFromWhitelist(address _investor) external onlyAdmin {
        require(whitelisted[_investor], "investor not in whitelist");
        whitelisted[_investor] = false;
        emit WhitelistRemoved(_investor);
    }

    modifier onlyWhitelist() {
        require(whitelisted[msg.sender], "!whitelisted");
        _;
    }
}
