// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./utils/AccessProtected.sol";
import "./utils/BaseRelayRecipient.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./utils/EIP712Base.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/** @title Loaning NFT. */
contract Loan is AccessProtected, ReentrancyGuard, BaseRelayRecipient, IERC721Receiver, EIP712Base, Pausable {
    using Address for address;
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;

    Counters.Counter public _loanIds;

    IERC20 public immutable token;

    address public treasury;

    uint256 public treasuryPercentage;

    uint256 public maxLoanPeriod = 604800;

    uint256 public minLoanPeriod = 3600;

    // nftContract address to nftId to LoanableItemId
    mapping(address => mapping(uint256 => uint256)) public _nftToBundleId;

    mapping(address => bool) public allowedNFT;

    enum NFTRewardsClaimer {
        loaner,
        loanee
    }

    struct LoanableItem {
        address[] nftAddresses;
        address owner;
        address loanee;
        uint256[] tokenIds;
        uint256 upfrontFee;
        uint8 percentageRewards;
        uint256 timePeriod;
        uint256 totalRewards;
        NFTRewardsClaimer claimer;
        uint256 loanerClaimedRewards;
        uint256 loaneeClaimedRewards;
        address[] nftRewardContracts;
        uint256[] nftRewards;
        uint256 startingTime;
        address reservedTo;
    }

    mapping(uint256 => bool) public areNFTsClaimed;

    mapping(uint256 => bool) public areNFTRewardsClaimed;

    mapping(uint256 => LoanableItem) public loanItems;

    struct Offer {
        uint256 loanId;
        address loanee;
        uint256 upfrontFee;
        uint8 percentageRewards;
        uint256 timePeriod;
        bool claimer;
    }

    mapping(bytes32 => bool) private cancelledOffers;

    bytes32 private constant OFFER_TYPEHASH =
        keccak256(
            bytes(
                "Offer(uint256 loanId,address loanee,uint256 upfrontFee,uint8 percentageRewards,uint256 timePeriod,bool claimer)"
            )
        );

    event LoanableItemCreated(
        uint256 itemId,
        address owner,
        address[] nftAddresses,
        uint256[] lockedNFT,
        uint256 upfrontFee,
        uint8 percentageRewards,
        uint256 timePeriod,
        address reservedTo,
        NFTRewardsClaimer claimer
    );

    event LoanIssued(address loanee, uint256 loanId);

    event ERC20RewardsAdded(uint256 loanId, uint256 amount);

    event NFTRewardsAdded(uint256 loanId, address[] nftAddresses, uint256[] nftIds);

    event ERC20RewardsClaimed(address claimer, uint256 rewards, uint256 loanId);

    event NFTRewardsClaimed(address claimer, address[] nftAddresses, uint256[] nftIds, uint256 loanId);

    event NFTsClaimed(address owner, address[] nftAddresses, uint256[] nftIds, uint256 loanId);

    event withdrawNfts(address indexed admin, address indexed to, address[] nftAddresses, uint256[] nftIds);

    constructor(
        address[] memory _nftAddresses,
        IERC20 _token,
        address _treasuryAddress,
        uint256 _treasuryPercentage
    ) {
        require(address(_token) != address(0), "ZERO_ADDRESS");
        _initializeEIP712("Loan", "1");
        for (uint256 i = 0; i < _nftAddresses.length; i++) {
            require(_nftAddresses[i].isContract(), "Given NFT Address must be a contract");
            allowedNFT[_nftAddresses[i]] = true;
        }
        token = _token;
        treasury = _treasuryAddress;
        treasuryPercentage = _treasuryPercentage;
    }

    /**
     * Updates Treasury address
     *
     * @param _treasury - Treasury Address to be set
     */
    function updateTreasury(address _treasury) external onlyAdmin {
        require(_treasury != address(0), "Null Address cannot be used");
        require(!_treasury.isContract(), "Cannot update contract address as treasury");
        treasury = _treasury;
    }

    /**
     * Updates Contract fee percentage
     *
     * @param _percent - Contract fee percentage to be set
     */
    function updatetreasuryPercentage(uint256 _percent) external onlyAdmin {
        treasuryPercentage = _percent;
    }

    /**
     * Updates Maximum allowed time period
     *
     * @param _timePeriod - Maximum time period in seconds
     */

    function updateMaxTimePeriod(uint256 _timePeriod) external onlyAdmin {
        require(_timePeriod > 0, "Incorrect time period");
        require(_timePeriod > minLoanPeriod);
        maxLoanPeriod = _timePeriod;
    }

    /**
     * Updates Minimum allowed time period
     *
     * @param _timePeriod - Minimum time period in seconds
     */

    function updateMinTimePeriod(uint256 _timePeriod) external onlyAdmin {
        require(_timePeriod > 0, "Incorrect time period");
        require(_timePeriod < maxLoanPeriod);
        minLoanPeriod = _timePeriod;
    }

    /**
     * Sets whether NFT Contract is Allowed or Not
     *
     * @param _nftAddress - ERC721 contract address
     * @param _enabled - Enable/Disable
     */

    function allowNFTContract(address _nftAddress, bool _enabled) external onlyAdmin {
        require(_nftAddress != address(0), "Null Address cannot be used");
        require(_nftAddress.isContract(), "Given NFT Address must be a contract");
        allowedNFT[_nftAddress] = _enabled;
    }

    /**
     * Checks whether NFT id is part of any bundle
     *
     * @param _nftAddress - ERC721 contract address
     * @param _nftId - NFT id
     */

    function _isBundled(address _nftAddress, uint256 _nftId) external view returns (bool) {
        require(allowedNFT[_nftAddress], "NFT contract address is not allowed");
        return (_nftToBundleId[_nftAddress][_nftId] > 0);
    }

    /**
     * Checks whether a specific user has access to given NFT id
     *
     * @param _nftAddress - ERC721 contract address
     * @param _nftId - NFT id
     */
    function hasAccessToNFT(
        address _nftAddress,
        uint256 _nftId,
        address _owner
    ) external view returns (bool) {
        require(allowedNFT[_nftAddress], "NFT contract address is not allowed");
        require(_nftToBundleId[_nftAddress][_nftId] > 0, "NFT is not bundled as a Loanable Item");
        uint256 loanId = _nftToBundleId[_nftAddress][_nftId];
        require(loanItems[loanId].owner != address(0), "Loanable Item Not Found");
        require(
            (block.timestamp - loanItems[loanId].startingTime) <= loanItems[loanId].timePeriod,
            "Inactive loan item"
        );
        return (_owner == loanItems[loanId].loanee);
    }

    /**
     * Listing a Loanable item
     *
     * @param _nftAddresses - ERC721 contract addresses
     * @param _nftIds - List of NFT ids
     * @param _upfrontFee - Upfront fee to loan item
     * @param _percentageRewards - Percentage of earned rewards
     * @param _timePeriod - Duration of the loan
     * @param _reservedTo - Is the listing reserved to a specific user
     * @param _claimer - Who can claim NFT rewards(loaner or loanee)
     */

    function createLoanableItem(
        address[] calldata _nftAddresses,
        uint256[] calldata _nftIds,
        uint256 _upfrontFee,
        uint8 _percentageRewards,
        uint256 _timePeriod,
        address _reservedTo,
        NFTRewardsClaimer _claimer
    ) external nonReentrant whenNotPaused returns (uint256) {
        address sender = _msgSender();
        require(_nftAddresses.length == _nftIds.length, "_nftAddresses.length != _nftIds.length");
        require(_nftIds.length > 0, "Atleast one NFT should be part of loanable Item");
        require(_percentageRewards <= 100, "Percentage cannot be more than 100");
        require(_timePeriod >= minLoanPeriod && _timePeriod <= maxLoanPeriod, "Incorrect loan time period specified");
        require(_reservedTo != sender, "Cannot reserve loan to owner");
        for (uint256 i = 0; i < _nftIds.length; i++) {
            require(allowedNFT[_nftAddresses[i]], "NFT contract address is not allowed");
            require(_nftToBundleId[_nftAddresses[i]][_nftIds[i]] == 0, "Loan Bundle exits with the given NFT");
            address nftOwner = IERC721(_nftAddresses[i]).ownerOf(_nftIds[i]);
            require(sender == nftOwner, "Sender is not the owner of given NFT");
        }
        _loanIds.increment();
        uint256 newLoanId = _loanIds.current();
        loanItems[newLoanId].owner = sender;
        loanItems[newLoanId].upfrontFee = _upfrontFee;
        loanItems[newLoanId].percentageRewards = _percentageRewards;
        loanItems[newLoanId].timePeriod = _timePeriod;
        loanItems[newLoanId].claimer = NFTRewardsClaimer(_claimer);
        if (_reservedTo != address(0) && !_reservedTo.isContract()) {
            loanItems[newLoanId].reservedTo = _reservedTo;
        }
        for (uint256 i = 0; i < _nftIds.length; i++) {
            _nftToBundleId[_nftAddresses[i]][_nftIds[i]] = newLoanId;
            loanItems[newLoanId].nftAddresses.push(_nftAddresses[i]);
            loanItems[newLoanId].tokenIds.push(_nftIds[i]);
            IERC721(_nftAddresses[i]).transferFrom(sender, address(this), _nftIds[i]);
        }
        emit LoanableItemCreated(
            newLoanId,
            sender,
            _nftAddresses,
            _nftIds,
            _upfrontFee,
            _percentageRewards,
            _timePeriod,
            _reservedTo,
            _claimer
        );
        return newLoanId;
    }

    /**
     * Loaner can reserve the loan to a user.
     *
     * @param _loanId - Id of the loanable item
     * @param _reserveTo - Address of the user to reserve the loan
     */

    function reserveLoanItem(uint256 _loanId, address _reserveTo) external whenNotPaused {
        address sender = _msgSender();
        require(sender == loanItems[_loanId].owner, "Only loan owner can reserve loan items");
        require(
            _reserveTo != address(0) && sender != _reserveTo && !_reserveTo.isContract(),
            "Invalid reserve address"
        );
        require(loanItems[_loanId].startingTime == 0, "Cannot reserve an active loan item");
        loanItems[_loanId].reservedTo = _reserveTo;
    }

    function hashOffer(Offer memory offer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    OFFER_TYPEHASH,
                    offer.loanId,
                    offer.loanee,
                    offer.upfrontFee,
                    offer.percentageRewards,
                    offer.timePeriod,
                    offer.claimer
                )
            );
    }

    function verify(
        address signer,
        Offer memory offer,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) internal view returns (bool) {
        require(signer != address(0), "NativeMetaTransaction: INVALID_SIGNER");
        return signer == ecrecover(toTypedMessageHash(hashOffer(offer)), sigV, sigR, sigS);
    }

    /**
     * Loaner can update NFT rewards claimer
     *
     * @param _loanId - Id of the loanable item
     * @param _isLoanerNFTRewardsClaimer - Can Loaner claim NFT rewards
     */

    function updateNFTRewardsClaimer(uint256 _loanId, bool _isLoanerNFTRewardsClaimer) external whenNotPaused {
        require(_msgSender() == loanItems[_loanId].owner, "Only loan owner can update loan");
        require(!areNFTsClaimed[_loanId], "NFTs already claimed, cannot update loan");
        require(loanItems[_loanId].loanee == address(0), "Cannot update loaned item");
        if (_isLoanerNFTRewardsClaimer) {
            loanItems[_loanId].claimer = NFTRewardsClaimer.loaner;
        } else {
            loanItems[_loanId].claimer = NFTRewardsClaimer.loanee;
        }
    }

    /**
     * Loaner can loan an Item to a loanee
     *
     * @param offer - Offer struct
     * @param sigR - Signature r value
     * @param sigS - Signature s value
     * @param sigV - Signature v value
     */

    function issueLoan(
        Offer memory offer,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) external nonReentrant whenNotPaused {
        address sender = _msgSender();
        uint256 _loanId = offer.loanId;
        require(offer.percentageRewards <= 100, "Percentage cannot be more than 100");
        require(
            offer.timePeriod >= minLoanPeriod && offer.timePeriod <= maxLoanPeriod,
            "Incorrect loan time period specified"
        );
        require(loanItems[_loanId].owner == sender, "Only loan owner can issue loan");
        require(sender != offer.loanee, "loaner cannot be loanee");
        require(loanItems[_loanId].loanee == address(0), "Loan Item is already loaned");
        require(!areNFTsClaimed[_loanId], "NFTs already claimed, cannot issue loan");
        if (loanItems[_loanId].reservedTo != address(0)) {
            require(loanItems[_loanId].reservedTo == offer.loanee, "Private loan can only be issued to reserved user");
        }
        require(verify(offer.loanee, offer, sigR, sigS, sigV), "Signer and signature do not match");
        require(!cancelledOffers[hashOffer(offer)], "This offer has been cancelled");
        loanItems[_loanId].upfrontFee = offer.upfrontFee;
        loanItems[_loanId].percentageRewards = offer.percentageRewards;
        loanItems[_loanId].timePeriod = offer.timePeriod;
        loanItems[_loanId].loanee = offer.loanee;
        loanItems[_loanId].startingTime = block.timestamp;
        loanItems[_loanId].claimer = offer.claimer ? NFTRewardsClaimer.loaner : NFTRewardsClaimer.loanee;
        if (loanItems[_loanId].upfrontFee != 0) {
            if (treasury != address(0) && treasuryPercentage != 0) {
                uint256 contractFee = ((loanItems[_loanId].upfrontFee * treasuryPercentage) / 100) / 100;
                token.transferFrom(offer.loanee, treasury, contractFee);
                token.transferFrom(offer.loanee, loanItems[_loanId].owner, loanItems[_loanId].upfrontFee - contractFee);
            } else {
                token.transferFrom(offer.loanee, loanItems[_loanId].owner, loanItems[_loanId].upfrontFee);
            }
        }
        emit LoanIssued(sender, _loanId);
    }

    /**
     * Loanee can loan an Item
     *
     * @param _loanId - Id of the loanable item
     */

    function loanItem(uint256 _loanId) external nonReentrant whenNotPaused {
        address sender = _msgSender();
        require(loanItems[_loanId].owner != address(0), "Loanable Item Not Found");
        require(sender != loanItems[_loanId].owner, "loaner cannot be loanee");
        require(loanItems[_loanId].loanee == address(0), "Loan Item is already loaned");
        require(!areNFTsClaimed[_loanId], "NFTs already claimed, cannot issue loan");
        if (loanItems[_loanId].reservedTo != address(0)) {
            require(loanItems[_loanId].reservedTo == sender, "Private loan can only be issued to reserved user");
        }
        loanItems[_loanId].loanee = sender;
        loanItems[_loanId].startingTime = block.timestamp;
        if (loanItems[_loanId].upfrontFee != 0) {
            if (treasury != address(0) && treasuryPercentage != 0) {
                uint256 contractFee = ((loanItems[_loanId].upfrontFee * treasuryPercentage) / 100) / 100;
                token.transferFrom(sender, treasury, contractFee);
                token.transferFrom(sender, loanItems[_loanId].owner, loanItems[_loanId].upfrontFee - contractFee);
            } else {
                token.transferFrom(sender, loanItems[_loanId].owner, loanItems[_loanId].upfrontFee);
            }
        }
        emit LoanIssued(sender, _loanId);
    }

    /**
     * Admin can add ERC20 Rewards
     *
     * @param _loanId - loan id
     * @param _amount - Rewards Amount.
     */

    function addERC20Rewards(uint256 _loanId, uint256 _amount) external onlyAdmin nonReentrant {
        address sender = _msgSender();
        require(loanItems[_loanId].owner != address(0), "Loanable Item Not Found");
        require(_amount > 0, "Invalid amount");
        require(loanItems[_loanId].startingTime > 0, "Inactive loan item");
        require(
            (block.timestamp - loanItems[_loanId].startingTime) <= loanItems[_loanId].timePeriod,
            "Inactive loan item"
        );
        loanItems[_loanId].totalRewards = loanItems[_loanId].totalRewards + _amount;
        token.transferFrom(sender, address(this), _amount);
        emit ERC20RewardsAdded(_loanId, _amount);
    }

    /**
     * Admin can add NFT Rewards
     *
     * @param _loanId - loan id
     * @param _nftAddresses - NFT Contract addresses.
     * @param _nftIds - NFT Rewards.
     */

    function addNFTRewards(
        uint256 _loanId,
        address[] calldata _nftAddresses,
        uint256[] calldata _nftIds
    ) external onlyAdmin whenNotPaused {
        address sender = _msgSender();
        require(_nftIds.length > 0, "nftIds length == 0");
        require(_nftAddresses.length == _nftIds.length, "_nftAddresses.length != _nftIds.length");
        require(loanItems[_loanId].owner != address(0), "Loanable Item Not Found");
        require(loanItems[_loanId].startingTime > 0, "Inactive loan item");
        require(
            (block.timestamp - loanItems[_loanId].startingTime) <= loanItems[_loanId].timePeriod,
            "Inactive loan item"
        );
        for (uint256 i = 0; i < _nftIds.length; i++) {
            address nftAddress = _nftAddresses[i];
            uint256 nftId = _nftIds[i];
            require(_nftToBundleId[nftAddress][nftId] == 0, "Bundled NFT cannot be added as rewards");
            _nftToBundleId[nftAddress][nftId] = _loanId;
            loanItems[_loanId].nftRewardContracts.push(nftAddress);
            loanItems[_loanId].nftRewards.push(nftId);
            IERC721(nftAddress).transferFrom(sender, address(this), nftId);
        }
        emit NFTRewardsAdded(_loanId, _nftAddresses, _nftIds);
    }

    /**
     * Get Bundled NFTs
     *
     * @param _loanId - Id of the loaned item
     *
     */
    function getBundledNFTs(uint256 _loanId) external view returns (address[] memory, uint256[] memory) {
        return (loanItems[_loanId].nftAddresses, loanItems[_loanId].tokenIds);
    }

    /**
     * Get NFT Rewards
     *
     * @param _loanId - Id of the loaned item
     *
     */
    function getNFTRewards(uint256 _loanId) external view returns (address[] memory, uint256[] memory) {
        return (loanItems[_loanId].nftRewardContracts, loanItems[_loanId].nftRewards);
    }

    /**
     * Get Loanee Rewards
     *
     * @param _loanId - Id of the loaned item
     *
     */

    function getLoaneeRewards(uint256 _loanId) public view returns (uint256) {
        uint256 loanerRewards = (loanItems[_loanId].totalRewards * loanItems[_loanId].percentageRewards) / 100;
        uint256 loaneeRewards = loanItems[_loanId].totalRewards - loanerRewards;
        return (loaneeRewards - loanItems[_loanId].loaneeClaimedRewards);
    }

    /**
     * Get Loanee Rewards
     *
     * @param _loanId - Id of the loaned item
     *
     */

    function getLoanerRewards(uint256 _loanId) public view returns (uint256) {
        uint256 loanerRewards = (loanItems[_loanId].totalRewards * loanItems[_loanId].percentageRewards) / 100;
        return (loanerRewards - loanItems[_loanId].loanerClaimedRewards);
    }

    /**
     * Claim ERC20 Rewards
     *
     * @param _loanId - Id of the loaned item
     *
     */

    function claimERC20Rewards(uint256 _loanId) external nonReentrant {
        address sender = _msgSender();
        require(
            sender == loanItems[_loanId].owner || sender == loanItems[_loanId].loanee,
            "Either loaner or loanee can claim rewards"
        );
        require(loanItems[_loanId].totalRewards > 0, "No rewards found for given LoanId");
        if (sender == loanItems[_loanId].owner) {
            uint256 loanerRewards = getLoanerRewards(_loanId);
            require(loanerRewards > 0, "No rewards found");
            loanItems[_loanId].loanerClaimedRewards = loanItems[_loanId].loanerClaimedRewards + loanerRewards;
            token.safeTransfer(loanItems[_loanId].owner, loanerRewards);
            emit ERC20RewardsClaimed(sender, loanerRewards, _loanId);
        } else {
            uint256 loaneeRewards = getLoaneeRewards(_loanId);
            require(loaneeRewards > 0, "No rewards found");
            loanItems[_loanId].loaneeClaimedRewards = loanItems[_loanId].loaneeClaimedRewards + loaneeRewards;
            token.safeTransfer(loanItems[_loanId].loanee, loaneeRewards);
            emit ERC20RewardsClaimed(sender, loaneeRewards, _loanId);
        }
    }

    /**
     * Claim NFT Rewards
     *
     * @param _loanId - Id of the loaned item
     *
     */

    function claimNFTRewards(uint256 _loanId) external nonReentrant whenNotPaused {
        address sender = _msgSender();
        require(loanItems[_loanId].owner != address(0), "Loanable Item Not Found");
        require(!areNFTRewardsClaimed[_loanId], "Rewards already claimed");
        require(loanItems[_loanId].startingTime > 0, "Inactive loan item");
        require(
            sender == loanItems[_loanId].owner || sender == loanItems[_loanId].loanee,
            "Either loaner or loanee can claim nft rewards"
        );
        require(
            (block.timestamp - loanItems[_loanId].startingTime) >= loanItems[_loanId].timePeriod,
            "Loan period is still active "
        );
        areNFTRewardsClaimed[_loanId] = true;
        if (loanItems[_loanId].claimer == NFTRewardsClaimer.loaner) {
            require(sender == loanItems[_loanId].owner, "Only Loaner can claim NFT rewards");
            for (uint256 i = 0; i < loanItems[_loanId].nftRewards.length; i++) {
                uint256 id = loanItems[_loanId].nftRewards[i];
                address nftAddress = loanItems[_loanId].nftRewardContracts[i];
                _nftToBundleId[nftAddress][id] = 0;
                IERC721(nftAddress).transferFrom(address(this), loanItems[_loanId].owner, id);
            }
            emit NFTRewardsClaimed(
                loanItems[_loanId].owner,
                loanItems[_loanId].nftRewardContracts,
                loanItems[_loanId].nftRewards,
                _loanId
            );
        } else {
            require(sender == loanItems[_loanId].loanee, "Only Loanee can claim NFT rewards");
            for (uint256 i = 0; i < loanItems[_loanId].nftRewards.length; i++) {
                uint256 id = loanItems[_loanId].nftRewards[i];
                address nftAddress = loanItems[_loanId].nftRewardContracts[i];
                IERC721(nftAddress).transferFrom(address(this), loanItems[_loanId].loanee, id);
            }
            emit NFTRewardsClaimed(
                loanItems[_loanId].loanee,
                loanItems[_loanId].nftRewardContracts,
                loanItems[_loanId].nftRewards,
                _loanId
            );
        }
    }

    /**
     * Loaner can Claim NFTs
     *
     * @param _loanId - Id of the loaned item
     *
     */
    function claimNFTs(uint256 _loanId) external nonReentrant whenNotPaused {
        require(_msgSender() == loanItems[_loanId].owner, "Sender is not the owner of NFTs");
        require(!areNFTsClaimed[_loanId], "NFTs already claimed");
        if (loanItems[_loanId].startingTime > 0) {
            require(
                (block.timestamp - loanItems[_loanId].startingTime) >= loanItems[_loanId].timePeriod,
                "Loan period is still active "
            );
        }
        areNFTsClaimed[_loanId] = true;
        for (uint256 i = 0; i < loanItems[_loanId].tokenIds.length; i++) {
            uint256 id = loanItems[_loanId].tokenIds[i];
            address nftAddress = loanItems[_loanId].nftAddresses[i];
            _nftToBundleId[nftAddress][id] = 0;
            IERC721(nftAddress).transferFrom(address(this), loanItems[_loanId].owner, id);
        }
        emit NFTsClaimed(
            loanItems[_loanId].owner,
            loanItems[_loanId].nftAddresses,
            loanItems[_loanId].tokenIds,
            _loanId
        );
    }

    function setTrustedForwarder(address _trustedForwarder) external onlyAdmin {
        trustedForwarder = _trustedForwarder;
    }

    function _msgSender() internal view override(Context, BaseRelayRecipient) returns (address) {
        return BaseRelayRecipient._msgSender();
    }

    /**
     * Withdraw ERC20 Rewards
     * @param _token - IERC20 Token
     */

    function withdrawERC20(IERC20 _token) external onlyAdmin {
        require(_token != token, "Cannot withdraw ERC20 tokens");
        uint256 balance = _token.balanceOf(address(this));
        _token.safeTransfer(owner(), balance);
    }

    /**
     * Admin can withdraw NFT Rewards
     *
     * @param _nftAddresses - NFT Contract addresses.
     * @param _tokenIds - NFT token ids.
     */

    function withdrawNFTs(address[] calldata _nftAddresses, uint256[] calldata _tokenIds) external onlyAdmin {
        require(_tokenIds.length > 0, "tokenIds length == 0");
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            address nftAddress = _nftAddresses[i];
            uint256 tokenId = _tokenIds[i];
            require(_nftToBundleId[nftAddress][tokenId] == 0, "Cannot withdraw from loaned bundles");
            IERC721(nftAddress).transferFrom(address(this), owner(), tokenId);
        }
    }

    function cancelOffer(
        Offer memory offer,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) external whenNotPaused {
        require(verify(offer.loanee, offer, sigR, sigS, sigV), "Signature data and Offer data do not match");
        require(offer.loanee == _msgSender(), "Only offer owner can cancel it");
        bytes32 offerHash = hashOffer((offer));
        if (!cancelledOffers[offerHash]) {
            cancelledOffers[offerHash] = true;
        }
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function pause() external whenNotPaused onlyAdmin {
        super._pause();
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */

    function unpause() external whenPaused onlyAdmin {
        super._unpause();
    }

    function emergencyWithdrawal(
        address[] calldata _nftAddresses,
        uint256[] calldata _nftIds,
        address to
    ) external onlyAdmin {
        require(_nftAddresses.length == _nftIds.length, "call data not of same length");
        require(to != address(0), "NFT cannot be transfer to Null Address");
        for (uint256 i = 0; i < _nftIds.length; i++) {
            address nftOwner = IERC721(_nftAddresses[i]).ownerOf(_nftIds[i]);
            require(address(this) == nftOwner, "Not owner of one or more NFTs");
        }
        for (uint256 i = 0; i < _nftIds.length; i++) {
            IERC721(_nftAddresses[i]).transferFrom(address(this), to, _nftIds[i]);
        }
        emit withdrawNfts(_msgSender(), to, _nftAddresses, _nftIds);
    }
}
