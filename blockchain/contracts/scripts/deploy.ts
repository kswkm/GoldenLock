import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Verifier = await ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  console.log("Verifier deployed at:", await verifier.getAddress());

  const GoldenLock = await ethers.getContractFactory("GoldenLock");
  const goldenLock = await GoldenLock.deploy();
  await goldenLock.waitForDeployment();
  console.log("GoldenLock deployed at:", await goldenLock.getAddress());

  const tx = await goldenLock.registerHospital(
    deployer.address,
    await verifier.getAddress(),
    10
  );
  await tx.wait();
  console.log("Test hospital registered:", deployer.address);

  console.log("\n=== web-dashboard/src/lib/contracts.ts 에 반영할 값 ===");
  console.log("VERIFIER_ADDRESS =", await verifier.getAddress());
  console.log("GOLDENLOCK_ADDRESS =", await goldenLock.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
