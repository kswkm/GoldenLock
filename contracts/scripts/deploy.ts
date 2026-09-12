import { network } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Verifier.sol이 zk-circuits/scripts/generate_verifier.sh로 실제 값으로 교체되기
  // 전까지는 항상 true를 반환하는 자리표시자다.
  const Verifier = await ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  console.log("Verifier deployed at:", await verifier.getAddress());

  const trustedRelayer = process.env.TRUSTED_RELAYER_ADDRESS || deployer.address;

  const GoldenLock = await ethers.getContractFactory("GoldenLock");
  const goldenLock = await GoldenLock.deploy(trustedRelayer);
  await goldenLock.waitForDeployment();
  console.log("GoldenLock deployed at:", await goldenLock.getAddress());
  console.log("trustedRelayer set to:", trustedRelayer);

  const tx = await goldenLock.registerHospital(deployer.address, await verifier.getAddress(), 10);
  await tx.wait();
  console.log("Test hospital registered:", deployer.address);

  console.log("\n=== relay-server/.env 와 frontend 설정에 반영할 값 ===");
  console.log("VERIFIER_ADDRESS =", await verifier.getAddress());
  console.log("GOLDEN_LOCK_ADDRESS =", await goldenLock.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
