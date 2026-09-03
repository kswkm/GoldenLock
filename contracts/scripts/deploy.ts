import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 배포 순서:
 *   1) Verifier 배포
 *      - zk-circuits/scripts/generate_verifier.sh 를 이미 돌려서
 *        contracts/contracts/Verifier.sol 이 존재하면 그것을 사용.
 *      - 아직 없다면(초기 개발 단계) MockVerifier로 대체.
 *   2) GoldenLock 배포 (verifier 주소 + trustedRelayer 주소 주입)
 *   3) 배포 정보(json)를 relay-server / web-dashboard가 읽을 수 있도록 저장
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const relayerAddress = process.env.RELAYER_ADDRESS || deployer.address;

  // 1) Verifier
  const verifierArtifactPath = path.join(__dirname, "../contracts/Verifier.sol");
  const useRealVerifier = fs.existsSync(verifierArtifactPath);

  const verifierFactory = await ethers.getContractFactory(useRealVerifier ? "Verifier" : "MockVerifier");
  const verifier = await verifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`${useRealVerifier ? "Verifier" : "MockVerifier"} deployed at: ${verifierAddress}`);

  // 2) GoldenLock
  const GoldenLock = await ethers.getContractFactory("GoldenLock");
  const goldenLock = await GoldenLock.deploy(verifierAddress, relayerAddress);
  await goldenLock.waitForDeployment();
  const goldenLockAddress = await goldenLock.getAddress();
  console.log(`GoldenLock deployed at: ${goldenLockAddress}`);
  console.log(`Trusted relayer set to: ${relayerAddress}`);

  // 3) 배포 정보 저장 (relay-server/web-dashboard 공유용)
  const deployment = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    goldenLock: goldenLockAddress,
    verifier: verifierAddress,
    verifierType: useRealVerifier ? "Verifier" : "MockVerifier",
    trustedRelayer: relayerAddress,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${deployment.network || "unknown"}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Deployment info written to: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
