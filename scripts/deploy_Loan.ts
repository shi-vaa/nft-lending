import { ethers, run } from "hardhat";
import { Loan, Loan__factory } from "../typechain";

async function deploy(testTokenAddress: string, NFTAddress: string) {
    const Loan = (await ethers.getContractFactory("Loan")) as Loan__factory;
    const loan = await Loan.deploy(
        [NFTAddress],
        testTokenAddress,
        process.env.TREASURY_ADDRESS as string,
        process.env.TREASURY_PERCENTAGE as string
    );
    console.log("Loan deployed at", loan.address);

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    await delay(20000);

    /**
     * Programmatic verification
     */
    try {
        console.log("Verifying the Loan Contract...");
        await run("verify:verify", {
            address: loan.address,
            constructorArguments: [
                [NFTAddress],
                testTokenAddress,
                process.env.TREASURY_ADDRESS as string,
                process.env.TREASURY_PERCENTAGE as string,
            ],
        });
    } catch (e: any) {
        console.error(`Error in verifying: ${e.message}`);
    }

    try {
        console.log("Setting Trusted Forwarder for Loan Contract...");
        if ((process.env.TRUSTED_FORWARDER_ADDRESS as string) != null) {
            const loanContract = Loan.attach(loan.address) as Loan;
            const receipt = await loanContract.setTrustedForwarder(
                process.env.TRUSTED_FORWARDER_ADDRESS as string
            );
            await receipt.wait();
            console.log("Trusted Forwarder set!");
        } else {
            console.error("Cannot setup trusted forwarder, please setup manually.");
        }
    } catch (e: any) {
        console.error(`Error in setting up trusted forwarder: ${e.message}`);
    }

    try {
        console.log("Whitelisting NFT Engine in the Loan Contract...");
        if (NFTAddress != null) {
            const loanContract = Loan.attach(loan.address) as Loan;
            const receipt = await loanContract.allowNFTContract(NFTAddress, true);
            await receipt.wait();
            console.log("NFT Engine Whitelisted!");
        } else {
            console.error("Cannot whitelist the NFT Engine, please setup manually.");
        }
    } catch (e: any) {
        console.error(`Error in whitelisting NFT Engine: ${e.message}`);
    }
    return loan.address;
}

if (require.main === module) {
    deploy(process.env.test_ERC20_ADDRESS as string, process.env.test_NFT_ENGINE_ADDRESS as string);
}

export { deploy };
