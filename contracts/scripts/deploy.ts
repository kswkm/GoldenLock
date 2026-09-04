import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 배포 순서:
 *   1) Verifier 배포
 *      - zk-circuits/scripts/generate_verifier.sh 를 이미 돌려서
 *        contracts/contracts/Verifier.sol 이 존재하면 그것을 사용.
 *      - 운영 배포에서는 실제 Verifier.sol이 없으면 실패한다.
 *   2) GoldenLock 배포 (verifier 주소 + trustedRelayer 주소 주입)
 *   3) 배포 정보(json)를 relay-server / web-dashboard가 읽을 수 있도록 저장
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const isProduction = process.env.NODE_ENV === "production" || process.env.REQUIRE_REAL_VERIFIER === "true";
  const relayerAddress = process.env.RELAYER_ADDRESS || (!isProduction ? deployer.address : undefined);
  if (!relayerAddress || relayerAddress === ethers.ZeroAddress) {
    throw new Error("RELAYER_ADDRESS must be set to a non-zero address");
  }

  // 1) Verifier
  const verifierArtifactPath = path.join(__dirname, "../contracts/Verifier.sol");
  const useRealVerifier = fs.existsSync(verifierArtifactPath);
  if (isProduction && !useRealVerifier) {
    throw new Error("Production deployment requires contracts/Verifier.sol; MockVerifier is local-test only");
  }

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
