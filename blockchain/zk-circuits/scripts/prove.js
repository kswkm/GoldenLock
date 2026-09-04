const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

async function main() {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, "../input.json")));

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(__dirname, "../build/hospital_resource_js/hospital_resource.wasm"),
    path.join(__dirname, "../build/hospital_resource_final.zkey")
  );

  console.log("=== Public Signals ===");
  console.log(publicSignals);

  const vKey = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../build/verification_key.json"))
  );
  const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  console.log("Proof valid:", isValid);

  const solidityCallData = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  console.log("=== Solidity Call Data (컨트랙트 호출용) ===");
  console.log(solidityCallData);
}

main().catch(console.error);
