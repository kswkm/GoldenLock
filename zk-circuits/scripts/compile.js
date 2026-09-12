/**
 * GoldenLock - zk-circuits/scripts/compile.js
 *
 * scripts/compile.sh 의 크로스플랫폼(특히 Windows) 이식. bash가 없는 환경(기본 Windows
 * PowerShell/cmd.exe)에서도 그대로 동작하도록 셸 스크립트 대신 순수 Node.js로 작성했다.
 * 실제 CLI 명령어(circom/snarkjs 인자)는 원본 compile.sh와 동일하다.
 *
 * ⚠️ 이 스크립트는 `circom` 컴파일러 본체가 시스템 PATH에 별도로 설치돼 있어야 한다.
 *    circom은 npm 패키지가 아니라 별도 배포되는 실행 파일이다:
 *      - Windows: https://github.com/iden3/circom/releases 에서 circom-windows-amd64.exe를
 *        받아 PATH에 등록된 폴더에 circom.exe로 저장 (또는 `cargo install --git
 *        https://github.com/iden3/circom.git`)
 *      - macOS/Linux: 동일 릴리스 페이지의 바이너리 또는 cargo install
 *    snarkjs는 이미 devDependency로 설치되어 있어 npx로 바로 실행된다.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CIRCUIT_NAME = "hospital_resource";
const BUILD_DIR = path.join(__dirname, "..", "build");
const CIRCUITS_DIR = path.join(__dirname, "..", "circuits");
const NODE_MODULES_DIR = path.join(__dirname, "..", "node_modules");

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  // shell:true 로 실행해야 Windows에서 .cmd 확장자(npx.cmd 등)까지 정확히 찾는다.
  execFileSync(command, args, { stdio: "inherit", shell: true });
}

function circomInstalledOrExit() {
  try {
    execFileSync("circom", ["--version"], { stdio: "ignore", shell: true });
  } catch {
    console.error(
      [
        "",
        "❌ 'circom' 실행 파일을 찾을 수 없습니다.",
        "   circom은 npm 패키지가 아니라 별도로 설치해야 하는 컴파일러입니다.",
        "   - Windows/macOS/Linux 공통: https://github.com/iden3/circom/releases 에서",
        "     자신의 OS용 바이너리를 받아 PATH에 등록하세요.",
        "   - 또는 Rust가 있다면: cargo install --git https://github.com/iden3/circom.git",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
}

function main() {
  circomInstalledOrExit();
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  console.log("▶ [1/3] Circom 컴파일 (R1CS / WASM / SYM 생성)");
  run("circom", [
    path.join(CIRCUITS_DIR, `${CIRCUIT_NAME}.circom`),
    "--r1cs",
    "--wasm",
    "--sym",
    "-l",
    NODE_MODULES_DIR,
    "-o",
    BUILD_DIR,
  ]);

  const potFinal = path.join(BUILD_DIR, "pot14_final.ptau");
  console.log("▶ [2/3] Powers of Tau (최초 1회만 필요 — 이미 있으면 스킵)");
  if (!fs.existsSync(potFinal)) {
    const pot0 = path.join(BUILD_DIR, "pot14_0000.ptau");
    const pot1 = path.join(BUILD_DIR, "pot14_0001.ptau");
    run("npx", ["snarkjs", "powersoftau", "new", "bn128", "14", pot0, "-v"]);
    run("npx", [
      "snarkjs",
      "powersoftau",
      "contribute",
      pot0,
      pot1,
      "--name=GoldenLock_contribution",
      "-v",
      "-e=goldenlock_random_entropy",
    ]);
    run("npx", ["snarkjs", "powersoftau", "prepare", "phase2", pot1, potFinal, "-v"]);
  } else {
    console.log(`  (이미 존재 → 건너뜀: ${potFinal})`);
  }

  console.log("▶ [3/3] Groth16 zkey 생성");
  const r1cs = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);
  const zkey0 = path.join(BUILD_DIR, `${CIRCUIT_NAME}_0000.zkey`);
  const zkeyFinal = path.join(BUILD_DIR, `${CIRCUIT_NAME}_final.zkey`);
  const vkey = path.join(BUILD_DIR, "verification_key.json");

  run("npx", ["snarkjs", "groth16", "setup", r1cs, potFinal, zkey0]);
  run("npx", [
    "snarkjs",
    "zkey",
    "contribute",
    zkey0,
    zkeyFinal,
    "--name=GoldenLock_zkey_contribution",
    "-v",
    "-e=goldenlock_more_entropy",
  ]);
  run("npx", ["snarkjs", "zkey", "export", "verificationkey", zkeyFinal, vkey]);

  console.log(`\n✅ 컴파일 완료: ${BUILD_DIR}`);
}

main();
