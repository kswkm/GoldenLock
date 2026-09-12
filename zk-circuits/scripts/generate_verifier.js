/**
 * GoldenLock - zk-circuits/scripts/generate_verifier.js
 *
 * scripts/generate_verifier.sh 의 크로스플랫폼(Windows 포함) 이식.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CIRCUIT_NAME = "hospital_resource";
const BUILD_DIR = path.join(__dirname, "..", "build");
const OUT_CONTRACT = path.join(__dirname, "..", "..", "contracts", "contracts", "Verifier.sol");

function main() {
  const zkeyFinal = path.join(BUILD_DIR, `${CIRCUIT_NAME}_final.zkey`);
  if (!fs.existsSync(zkeyFinal)) {
    console.error(
      `❌ ${zkeyFinal} 이 없습니다. 먼저 "npm run compile"을 실행해 zkey를 만드세요.`
    );
    process.exit(1);
  }

  console.log("▶ Solidity Verifier 컨트랙트 생성 중...");
  console.log(`\n$ npx snarkjs zkey export solidityverifier ${zkeyFinal} ${OUT_CONTRACT}`);
  execFileSync("npx", ["snarkjs", "zkey", "export", "solidityverifier", zkeyFinal, OUT_CONTRACT], {
    stdio: "inherit",
    shell: true,
  });

  console.log(`\n✅ Verifier.sol 생성 완료 -> ${OUT_CONTRACT}`);
  console.log(
    "⚠ contracts/contracts/Verifier.sol 을 GoldenLock.sol의 IGroth16Verifier 인터페이스에 맞게 함수명 확인 필요"
  );
}

main();
