import { ethers, network } from "hardhat";
import { Signer, BigNumber } from "ethers";
const sigUtil = require("@metamask/eth-sig-util");
import {
    test,
    test__factory,
    Loan,
    Loan__factory,
    testNFTEngine__factory,
    testNFTEngine,
} from "../typechain";
import { expect } from "chai";
import { string } from "hardhat/internal/core/params/argumentTypes";
import { before } from "mocha";

describe("Loaning Tests", async () => {
    let owner: Signer,
        accounts1: Signer,
        accounts2: Signer,
        accounts3: Signer,
        accounts4: Signer,
        accounts5: Signer,
        accounts6: Signer,
        testFactory: test__factory,
        test: test,
        loanFactory: Loan__factory,
        loan: Loan,
        testEngine: testNFTEngine__factory,
        vox: testNFTEngine,
        nftAddresses: string[],
        nullAddress: string;

    before(async () => {
        [owner, accounts1, accounts2, accounts3, accounts4, accounts5] = await ethers.getSigners();
        testEngine = (await ethers.getContractFactory("testNFTEngine")) as testNFTEngine__factory;
        vox = await testEngine.deploy("testNFT", "VOX");
        testFactory = (await ethers.getContractFactory("test")) as test__factory;
        test = await testFactory.deploy(300000000, "test Token", "test");
        loanFactory = (await ethers.getContractFactory("Loan")) as Loan__factory;
        loan = await loanFactory.deploy([], test.address, await accounts5.getAddress(), 100);
        accounts6 = new ethers.Wallet(
            "c0bbcfa11e989db401daadb9a01ee46e7d337a740388f4ef41ed0ab8a18a1ff9",
            ethers.provider
        );
        vox.addToWhitelist(loan.address);
        nullAddress = ethers.utils.getAddress("0x0000000000000000000000000000000000000000");
    });
    describe("Access Tests", async () => {
        it("owner should be able to add allowed NFT", async () => {
            expect(loan.allowNFTContract(test.address, true));
        });
        it("only owner should be able to add allowed NFT", async () => {
            expect(loan.connect(accounts1).allowNFTContract(test.address, true)).to.be.revertedWith(
                "Caller does not have Admin Access"
            );
        });
    });

    // ERC721: owner query for nonexistent token
    //ERC721: transfer caller is not owner nor approved
    //Contract Address is not whitelisted'

    describe("Functionality Tests", async () => {
        let nftIds: BigNumber[], loanId: BigNumber, loanId3: BigNumber;
        before(async () => {
            const nftOwner = await accounts1.getAddress();
            expect(loan.allowNFTContract(vox.address, true));
            const hash = "some-hash";
            nftIds = [];
            nftAddresses = [];
            const hashes = [];
            const iterations = 10;
            for (var i = 1; i <= iterations; i++) {
                const hash = `ipfs-hash-user1-${i}`;
                hashes.push(hash);
                const nftId = await vox.callStatic.issueToken(nftOwner, hash);
                await vox.issueToken(nftOwner, hash);
                await vox.connect(accounts1).approve(loan.address, nftId);
                nftIds.push(nftId);
                nftAddresses.push(vox.address);
            }
        });
        it("only nft owner can create loanable bundle", async () => {
            await expect(
                loan
                    .connect(accounts2)
                    .createLoanableItem(
                        nftAddresses,
                        nftIds,
                        1000,
                        30,
                        604800,
                        await accounts3.getAddress(),
                        0
                    )
            ).to.be.revertedWith("Sender is not the owner of given NFT");
        });
        it("should not be able to create loan with timePeriod less than minimum Loan Period", async () => {
            await expect(
                loan
                    .connect(accounts1)
                    .createLoanableItem(nftAddresses, nftIds, 1000, 30, 100, await accounts3.getAddress(), 0)
            ).to.be.revertedWith("Incorrect loan time period specified");
        });
        it("should not be able to create loan with timePeriod greater than maximum Loan Period", async () => {
            await expect(
                loan
                    .connect(accounts1)
                    .createLoanableItem(
                        nftAddresses,
                        nftIds,
                        1000,
                        30,
                        605800,
                        await accounts3.getAddress(),
                        0
                    )
            ).to.be.revertedWith("Incorrect loan time period specified");
        });
        it("loaner Should be able to list loan item", async () => {
            const ownerAddress = await accounts1.getAddress();
            loanId = await loan
                .connect(accounts1)
                .callStatic.createLoanableItem(nftAddresses, nftIds, 1000, 13, 604800, nullAddress, 0);
            await expect(
                loan
                    .connect(accounts1)
                    .createLoanableItem(nftAddresses, nftIds, 1000, 13, 604800, nullAddress, 0)
            )
                .to.emit(loan, "LoanableItemCreated")
                .withArgs(loanId, ownerAddress, nftAddresses, nftIds, 1000, 13, 604800, nullAddress, 0);
        });
        it("should not be able to withdraw bundled nft's", async () => {
            await expect(loan.connect(owner).withdrawNFTs(nftAddresses, nftIds)).to.be.revertedWith(
                "Cannot withdraw from loaned bundles"
            );
        });
        describe("Loaning, Rewarding Listed Loan Items", async () => {
            let nftIds2: BigNumber[],
                nftIds3: BigNumber[],
                nftIds4: BigNumber[],
                ownerAddress: string,
                account2Address: string,
                account1Address: string,
                account3Address: string,
                loanId2: BigNumber,
                loanId3: BigNumber;
            const createLoanableItemParams = async (
                account: Signer,
                _nftIds: BigNumber[],
                upfrontFee: BigNumber,
                percentageRewards: BigNumber,
                timePeriod: BigNumber
            ) => {
                // nftAddresses = [];
                // for (var i = 0; i < nftIds2.length; i++) {
                //     nftAddresses.push(vox.address);
                // }
                const _loanId = await loan
                    .connect(account)
                    .callStatic.createLoanableItem(
                        nftAddresses,
                        _nftIds,
                        upfrontFee,
                        percentageRewards,
                        timePeriod,
                        nullAddress,
                        0
                    );
                expect(
                    loan
                        .connect(account)
                        .createLoanableItem(
                            nftAddresses,
                            _nftIds,
                            upfrontFee,
                            percentageRewards,
                            timePeriod,
                            nullAddress,
                            0
                        )
                )
                    .to.emit(loan, "LoanableItemCreated")
                    .withArgs(
                        _loanId,
                        await account.getAddress(),
                        nftAddresses,
                        _nftIds,
                        upfrontFee,
                        percentageRewards,
                        timePeriod,
                        nullAddress,
                        0
                    );
                return _loanId;
            };
            before(async () => {
                const iterations = 10;
                ownerAddress = await owner.getAddress();
                account1Address = await accounts1.getAddress();
                account2Address = await accounts2.getAddress();
                account3Address = await accounts3.getAddress();
                await test.connect(owner).transfer(account2Address, 1000);
                await test.connect(accounts2).approve(loan.address, 1000);
                await owner.sendTransaction({
                    to: await accounts6.getAddress(),
                    value: ethers.utils.parseEther("1.0"), // Sends exactly 1.0 ether
                });
                await test.connect(owner).transfer(await accounts5.getAddress(), 1000);
                await test.connect(accounts5).approve(loan.address, 1000);
                await test.connect(owner).approve(loan.address, 1000);
                nftIds2 = [];
                nftIds3 = [];
                nftIds4 = [];
                for (var i = 1; i <= iterations; i++) {
                    var hash = `ipfs-hash-user1-${i + 20}`;
                    var nftId = await vox.callStatic.issueToken(account3Address, hash);
                    await vox.issueToken(account3Address, hash);
                    await vox.connect(accounts3).approve(loan.address, nftId);
                    nftIds2.push(nftId);
                }
                for (var i = 1; i <= iterations; i++) {
                    var hash = `ipfs-hash-user1-${i + 60}`;
                    var nftId = await vox.callStatic.issueToken(ownerAddress, hash);
                    await vox.issueToken(ownerAddress, hash);
                    await vox.connect(owner).approve(loan.address, nftId);
                    nftIds3.push(nftId);
                }
                for (var i = 1; i <= iterations; i++) {
                    var hash = `ipfs-hash-user1-${i + 1000}`;
                    var nftId = await vox.callStatic.issueToken(await accounts4.getAddress(), hash);
                    await vox.issueToken(await accounts4.getAddress(), hash);
                    await vox.connect(accounts4).approve(loan.address, nftId);
                    nftIds4.push(nftId);
                }
            });
            it("loaner can create a reservable loan Item", async () => {
                loanId2 = await loan
                    .connect(accounts3)
                    .callStatic.createLoanableItem(
                        nftAddresses,
                        nftIds2,
                        100,
                        13,
                        60480,
                        await accounts4.getAddress(),
                        1
                    );
                await expect(
                    loan
                        .connect(accounts3)
                        .createLoanableItem(
                            nftAddresses,
                            nftIds2,
                            100,
                            13,
                            60480,
                            await accounts4.getAddress(),
                            1
                        )
                )
                    .to.emit(loan, "LoanableItemCreated")
                    .withArgs(
                        loanId2,
                        account3Address,
                        nftAddresses,
                        nftIds2,
                        100,
                        13,
                        60480,
                        await accounts4.getAddress(),
                        1
                    );
            });
            it("update reserve on an inactive loan", async () => {
                await loan.connect(accounts3).reserveLoanItem(loanId2, await accounts5.getAddress());
                const reservedTo = (await loan.loanItems(loanId2)).reservedTo.toString();
                expect(reservedTo).to.be.equal(await accounts5.getAddress());
            });
            it("Reserved loan cannot be issued to other loaner", async () => {
                await expect(loan.connect(accounts2).loanItem(loanId2)).to.be.revertedWith(
                    "Private loan can only be issued to reserved user"
                );
            });
            it("should be able to loan reserved loan ", async () => {
                await test.connect(owner).transfer(await accounts5.getAddress(), 1000);
                await test.connect(accounts5).approve(loan.address, 1000);
                await loan.connect(accounts5).loanItem(loanId2);
                expect((await loan.loanItems(loanId2)).loanee).to.be.equal(await accounts5.getAddress());
            });
            it("Should not update reservedTo on an active loan", async () => {
                await expect(
                    loan.connect(accounts3).reserveLoanItem(loanId2, await accounts5.getAddress())
                ).to.be.revertedWith("Cannot reserve an active loan item");
            });
            it("revert on nft use for second loan bundle", async () => {
                expect(
                    loan
                        .connect(accounts1)
                        .createLoanableItem(nftAddresses, nftIds, 1000, 30, 604800, nullAddress, 0)
                ).to.be.revertedWith("Loan Bundle exits with the given NFT");
            });
            it("nfts should be locked/non transferable after listing loan item", async () => {
                for (var i = 0; i < nftIds.length; i++) {
                    expect(
                        vox
                            .connect(accounts1)
                            .transferFrom(account1Address, account2Address, nftIds[i].toBigInt())
                    ).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
                }
            });
            it("loan contract should be the owner of locked nfts", async () => {
                for (var i = 0; i < nftIds.length; i++) {
                    expect(await vox.ownerOf(nftIds[i].toBigInt())).to.be.equal(loan.address);
                }
            });
            it("loanee should be able to loan item", async () => {
                await expect(loan.connect(accounts2).loanItem(loanId)).to.emit(loan, "LoanIssued");
                const loanItem = await loan.loanItems(loanId);
                expect(loanItem.loanee).to.be.equal(account2Address);
            });
            it("should not allow to issue an active loan", async () => {
                expect(loan.connect(accounts3).loanItem(loanId)).to.be.revertedWith(
                    "Loan Item is already loaned"
                );
            });
            it("check if deployer has access", async () => {
                var ret = await loan.hasAccessToNFT(vox.address, nftIds[0], await owner.getAddress());
                expect(ret).to.equal(false);
            });
            it("check if account1 has access", async () => {
                var ret = await loan
                    .connect(accounts1)
                    .hasAccessToNFT(vox.address, nftIds[0], await accounts1.getAddress());
                expect(ret).to.equal(false);
            });
            it("check if loanee has access", async () => {
                var ret = await loan
                    .connect(accounts1)
                    .hasAccessToNFT(vox.address, nftIds[0], await accounts2.getAddress());
                expect(ret).to.equal(true);
                var ret = await loan
                    .connect(accounts1)
                    .hasAccessToNFT(vox.address, nftIds[0], await accounts1.getAddress());
                expect(ret).to.equal(false);
            });
            it("only admin should be able to add rewards on NFTs", async () => {
                await expect(loan.connect(accounts1).addERC20Rewards(loanId, 100)).to.be.revertedWith(
                    "Caller does not have Admin Access"
                );
            });
            it("owner should be able to add ERC20 rewards", async () => {
                await expect(loan.connect(owner).addERC20Rewards(loanId, 100))
                    .to.emit(loan, "ERC20RewardsAdded")
                    .withArgs(loanId, 100);
                expect((await test.balanceOf(loan.address)).toNumber()).to.be.equal(100);
            });
            it("bundled NFT should not be added NFT rewards", async () => {
                await expect(
                    loan.connect(owner).addNFTRewards(loanId, nftAddresses, nftIds)
                ).to.be.revertedWith("Bundled NFT cannot be added as rewards");
            });
            it("owner should  be able to add NFT rewards", async () => {
                await expect(loan.connect(owner).addNFTRewards(loanId, nftAddresses, nftIds3))
                    .to.emit(loan, "NFTRewardsAdded")
                    .withArgs(loanId, nftAddresses, nftIds3);
                for (var i = 0; i < nftIds3.length; i++) {
                    expect((await vox.ownerOf(nftIds3[i])).toString()).to.be.equal(loan.address.toString());
                }
            });
            it("should not be able to withdraw rewarded nft's", async () => {
                await expect(loan.connect(owner).withdrawNFTs(nftAddresses, nftIds3)).to.be.revertedWith(
                    "Cannot withdraw from loaned bundles"
                );
            });
            it("should be able to withdraw nft's which are not bundled", async () => {
                const vox1 = await testEngine.deploy("testNFT", "VOX");
                var _hashes = [];
                var _nftIds = [];
                var _nftAddresses = [];
                for (var i = 1; i <= 10; i++) {
                    const hash = `ipfs-hash-user1-${i}`;
                    _hashes.push(hash);
                    const nftId = await vox1.callStatic.issueToken(loan.address, hash);
                    await vox1.issueToken(loan.address, hash);
                    _nftIds.push(nftId);
                    _nftAddresses.push(vox1.address);
                }
                await loan.connect(owner).withdrawNFTs(_nftAddresses, _nftIds);
                for (var i = 0; i < _nftIds.length; i++) {
                    var nftOwner = await vox1.ownerOf(_nftIds[i]);
                    expect(nftOwner).to.be.equal(ownerAddress);
                }
            });
            it("should be able to withdraw erc20 other than test", async () => {
                const test1 = await testFactory.deploy(300000000, "test Token", "test");
                await test1.connect(owner).transfer(loan.address, 100);
                const balance = await (await test1.balanceOf(ownerAddress)).toBigInt();
                await loan.connect(owner).withdrawERC20(test1.address);
                expect((await test1.balanceOf(ownerAddress)).toBigInt()).to.be.equal(balance + BigInt(100));
            });
            it("shouldnot be able to withdraw test tokens", async () => {
                expect(loan.connect(owner).withdrawERC20(test.address)).to.be.revertedWith(
                    "Cannot withdraw test tokens"
                );
            });
            it("loaner can claim rewards", async () => {
                await expect(loan.connect(owner).addERC20Rewards(loanId, 10))
                    .to.emit(loan, "ERC20RewardsAdded")
                    .withArgs(loanId, 10);
                await expect(loan.connect(accounts1).claimERC20Rewards(loanId)).to.emit(
                    loan,
                    "ERC20RewardsClaimed"
                );
                const totalRewards = await (await loan.loanItems(loanId)).totalRewards;
                expect(totalRewards.toNumber()).to.be.equal(110);
                expect((await test.balanceOf(account1Address)).toNumber()).to.be.equal(1004);
                expect((await test.balanceOf(account2Address)).toNumber()).to.be.equal(0);
            });
            it("loaner cannot claim nft rewards during active loan period", async () => {
                await expect(loan.connect(accounts1).claimNFTRewards(loanId)).to.be.revertedWith(
                    "Loan period is still active"
                );
            });
            it("loanee can claim rewards", async () => {
                await expect(loan.connect(owner).addERC20Rewards(loanId, 10))
                    .to.emit(loan, "ERC20RewardsAdded")
                    .withArgs(loanId, 10);
                await expect(loan.connect(accounts2).claimERC20Rewards(loanId)).to.emit(
                    loan,
                    "ERC20RewardsClaimed"
                );
                const totalRewards = await (await loan.loanItems(loanId)).totalRewards;
                expect(totalRewards.toNumber()).to.be.equal(120);
                expect((await test.balanceOf(account1Address)).toNumber()).to.be.equal(1004);
                expect((await test.balanceOf(account2Address)).toNumber()).to.be.equal(105);
                await expect(loan.connect(accounts1).claimERC20Rewards(loanId)).to.emit(
                    loan,
                    "ERC20RewardsClaimed"
                );
                expect((await test.balanceOf(account1Address)).toNumber()).to.be.equal(1005);
            });
            it("Testing pending rewards and contract balances", async () => {
                for (var i = 1; i < 100; i++) {
                    await test.approve(loan.address, BigNumber.from(99000000 * i));
                    await expect(loan.connect(owner).addERC20Rewards(loanId, BigNumber.from(99000000 * i)))
                        .to.emit(loan, "ERC20RewardsAdded")
                        .withArgs(loanId, BigNumber.from(99000000 * i));
                    await expect(loan.connect(accounts1).claimERC20Rewards(loanId)).to.emit(
                        loan,
                        "ERC20RewardsClaimed"
                    );
                    await expect(loan.connect(accounts2).claimERC20Rewards(loanId)).to.emit(
                        loan,
                        "ERC20RewardsClaimed"
                    );
                    const totalRewards = (await loan.loanItems(loanId)).totalRewards;
                    const loanerClaimedRewards = (
                        await loan.loanItems(loanId)
                    ).loanerClaimedRewards.toNumber();
                    const loaneeClaimedRewards = (
                        await loan.loanItems(loanId)
                    ).loaneeClaimedRewards.toNumber();
                    expect((await test.balanceOf(loan.address)).toNumber()).to.be.equal(
                        totalRewards.toNumber() - loanerClaimedRewards - loaneeClaimedRewards
                    );
                }
            });
            it("loaner cannot claim NFTs over active loan period", async () => {
                expect(loan.connect(accounts1).claimNFTs(loanId)).to.be.revertedWith(
                    "Loan period is still active"
                );
            });
            it("loaner can claim NFTs after active loan period", async () => {
                for (var i = 0; i < nftIds.length; i++) {
                    expect((await vox.ownerOf(nftIds[i])).toString()).to.be.equal(loan.address);
                }
                await network.provider.send("evm_increaseTime", [604800]);
                await network.provider.send("evm_mine");
                await expect(loan.connect(accounts1).claimNFTs(loanId)).to.emit(loan, "NFTsClaimed");
                for (var i = 0; i < nftIds.length; i++) {
                    var nftOwner = await vox.ownerOf(nftIds[i]);
                    expect(nftOwner).to.be.equal(account1Address);
                }
            });
            it("loaner or loanne can claim NFT rewards", async () => {
                await expect(loan.connect(accounts2).claimNFTRewards(loanId)).to.be.revertedWith(
                    "Only Loaner can claim NFT rewards"
                );
            });
            it("loaner can claim NFT rewards", async () => {
                await expect(loan.connect(accounts1).claimNFTRewards(loanId)).to.emit(
                    loan,
                    "NFTRewardsClaimed"
                );
                for (var i = 0; i < nftIds3.length; i++) {
                    expect((await vox.ownerOf(nftIds3[i])).toString()).to.be.equal(
                        account1Address.toString()
                    );
                }
            });
            it("loaner cannot loan inactive loan", async () => {
                expect(loan.connect(accounts2).loanItem(loanId)).to.be.revertedWith(
                    "Loan Item is already loaned"
                );
                expect(loan.connect(owner).addERC20Rewards(loanId, 100)).to.be.revertedWith(
                    "Inactive loan item"
                );
            });
            describe("offers", async () => {
                let name = "Loan";
                let chainId;
                let version = "1";
                let r: string;
                let s: string;
                let v: number;
                const domainType = [
                    {
                        name: "name",
                        type: "string",
                    },
                    {
                        name: "version",
                        type: "string",
                    },
                    {
                        name: "verifyingContract",
                        type: "address",
                    },
                    {
                        name: "salt",
                        type: "bytes32",
                    },
                ];
                const offerType = [
                    {
                        name: "loanId",
                        type: "uint256",
                    },
                    {
                        name: "loanee",
                        type: "address",
                    },
                    {
                        name: "upfrontFee",
                        type: "uint256",
                    },
                    {
                        name: "percentageRewards",
                        type: "uint8",
                    },
                    {
                        name: "timePeriod",
                        type: "uint256",
                    },
                    {
                        name: "claimer",
                        type: "bool",
                    },
                ];

                const dataToSign = (message: {}, domainData: {}) => {
                    return {
                        types: {
                            EIP712Domain: domainType,
                            Offer: offerType,
                        },
                        domain: domainData,
                        primaryType: "Offer",
                        message: message,
                    };
                };
                const sigFunc = (message: {}, domainData: {}) => {
                    return sigUtil.signTypedData({
                        privateKey: Buffer.from(
                            "8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
                            "hex"
                        ),
                        data: dataToSign(message, domainData),
                        version: sigUtil.SignTypedDataVersion.V3,
                    });
                };
                let domainData: {};
                before(async () => {
                    loanId3 = await loan
                        .connect(accounts4)
                        .callStatic.createLoanableItem(
                            nftAddresses,
                            nftIds4,
                            100,
                            13,
                            60480,
                            await accounts5.getAddress(),
                            1
                        );
                    await expect(
                        loan
                            .connect(accounts4)
                            .createLoanableItem(
                                nftAddresses,
                                nftIds4,
                                100,
                                13,
                                60480,
                                await accounts5.getAddress(),
                                1
                            )
                    )
                        .to.emit(loan, "LoanableItemCreated")
                        .withArgs(
                            loanId3,
                            await accounts4.getAddress(),
                            nftAddresses,
                            nftIds4,
                            100,
                            13,
                            60480,
                            await accounts5.getAddress(),
                            1
                        );
                    chainId = (await loan.getChainId()).toString();
                    domainData = {
                        name: name,
                        version: version,
                        verifyingContract: loan.address,
                        salt: "0x" + parseInt(chainId).toString(16).padStart(64, "0"),
                    };
                });
                it("cancel offer", async () => {
                    var message1 = {
                        loanId: loanId3.toNumber(),
                        loanee: await accounts5.getAddress(),
                        upfrontFee: 200,
                        percentageRewards: 30,
                        timePeriod: 60471,
                        claimer: true,
                    };
                    const signature = sigFunc(message1, domainData);
                    r = signature.slice(0, 66);
                    s = "0x".concat(signature.slice(66, 130));
                    let V = "0x".concat(signature.slice(130, 132));
                    v = parseInt(V);

                    if (![27, 28].includes(v)) v += 27;
                    var offer = {
                        loanId: loanId3,
                        loanee: await accounts5.getAddress(),
                        upfrontFee: BigNumber.from(200),
                        percentageRewards: 30,
                        timePeriod: BigNumber.from(60471),
                        claimer: true,
                    };
                    await loan.connect(accounts5).cancelOffer(offer, r, s, v);
                    await expect(loan.connect(accounts4).issueLoan(offer, r, s, v)).to.be.revertedWith(
                        "This offer has been cancelled"
                    );
                });
                it("can sign messages and verify", async () => {
                    let message = {
                        loanId: loanId3.toNumber(),
                        loanee: await accounts5.getAddress(),
                        upfrontFee: 200,
                        percentageRewards: 30,
                        timePeriod: 60470,
                        claimer: false,
                    };
                    const signature = sigFunc(message, domainData);
                    r = signature.slice(0, 66);
                    s = "0x".concat(signature.slice(66, 130));
                    let V = "0x".concat(signature.slice(130, 132));
                    v = parseInt(V);

                    if (![27, 28].includes(v)) v += 27;

                    // loanItem.push({"nftAddresses":nftAddresses})

                    let offer = {
                        loanId: loanId3,
                        loanee: await accounts5.getAddress(),
                        upfrontFee: BigNumber.from(200),
                        percentageRewards: 30,
                        timePeriod: BigNumber.from(60470),
                        claimer: false,
                    };
                    await loan.connect(accounts4).issueLoan(offer, r, s, v);

                    expect((await loan.loanItems(loanId3)).upfrontFee).to.equal(200);
                    expect((await loan.loanItems(loanId3)).percentageRewards).to.equal(30);
                    expect((await loan.loanItems(loanId3)).timePeriod).to.equal(60470);
                    expect((await loan.loanItems(loanId3)).claimer).to.equal(1);
                    expect((await loan.loanItems(loanId3)).loanee).to.be.equal(await accounts5.getAddress());
                    expect(
                        await loan.hasAccessToNFT(nftAddresses[0], nftIds4[0], await accounts5.getAddress())
                    ).to.be.equal(true);
                    expect(
                        await loan.hasAccessToNFT(nftAddresses[0], nftIds4[0], await accounts4.getAddress())
                    ).to.be.equal(false);
                });
            });

            it("Checking pause and unpause funtionality", async () => {
                var pauseResult = await loan.connect(owner).pause();
                await expect(pauseResult).to.emit(loan, "Paused");

                var unPauseResult = await loan.connect(owner).unpause();
                await expect(unPauseResult).to.emit(loan, "Unpaused");
            });

            it("Emergency withdrawal nfts from contracts", async () => {
                const vox1 = await testEngine.deploy("testNFT", "VOX");
                var _hashes = [];
                var _nftIds = [];
                var _nftAddresses = [];
                for (var i = 1; i <= 10; i++) {
                    const hash = `ipfs-hash-user1-${i}`;
                    _hashes.push(hash);
                    const nftId = await vox1.callStatic.issueToken(loan.address, hash);
                    await vox1.issueToken(loan.address, hash);
                    _nftIds.push(nftId);
                    _nftAddresses.push(vox1.address);
                }

                var emergencywhithdrwalResult = await loan
                    .connect(owner)
                    .emergencyWithdrawal(_nftAddresses, _nftIds, await accounts6.getAddress());
                await expect(emergencywhithdrwalResult).to.emit(loan, "withdrawNfts");
            });
        });
    });
});
