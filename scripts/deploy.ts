import { stringify } from "@connext/vector-utils";
import { Contract } from "@ethersproject/contracts";
import { keccak256 } from "@ethersproject/keccak256";
import { ethers } from "hardhat";

const transfers = ["Insurance", "Parameterized", "MessageTransfer"];

const MIN_GAS_LIMIT = ethers.BigNumber.from(500_000);

const hash = (input: string): string =>
  keccak256(`0x${input.replace(/^0x/, "")}`);

async function main() {
  const accounts = await ethers.getSigners();
  console.log(
    `Preparing to deploy transfers from ${
      accounts[0].address
    } (balance: ${ethers.utils.formatEther(await accounts[0].getBalance())})`
  );
  // Deploy all transfers
  const entries: { [key: string]: any } = {};
  for (const transfer of transfers) {
    const factory = await ethers.getContractFactory(transfer, accounts[0]);
    const deployTx = factory.getDeployTransaction();
    const tx = await accounts[0].sendTransaction({
      ...deployTx,
      gasLimit:
        deployTx.gasLimit &&
        ethers.BigNumber.from(deployTx.gasLimit).lt(MIN_GAS_LIMIT)
          ? MIN_GAS_LIMIT
          : undefined,
    });
    console.log(`Sent transaction to deploy ${transfer}, txHash: ${tx.hash}`);
    const receipt = await tx.wait();
    const address = Contract.getContractAddress(tx);
    const runtimeCodeHash = hash(await accounts[0].provider!.getCode(address));
    const creationCodeHash = hash(factory.bytecode);
    console.log(`Successfully deployed ${transfer}`);
    entries[transfer] = {
      address,
      runtimeCodeHash,
      creationCodeHash,
      txHash: tx.hash,
    };
  }
  console.log("Successfully deployed all transfers, update address-book with:");
  console.log(stringify(entries));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
