// ============================================================================
// zk.js  ("web-dashboard의 useZkProver 훅" — relayer.ts 주석에서 언급된 바로 그 부분)
//
// 회로: zk-circuits/circuits/hospital_resource.circom
//   private: availableBeds, availableSpecialists, hospitalSecret
//   public : requiredBeds, requiredSpecialists, requestHash
//   output : canAccept (1/0)
//
// ── 이 프로젝트에서 "네 값을 ZK로 확인한다"는 것의 실제 의미 ─────────────────
// 회로 자체는 병상 수 비교(+ secret/hash가 0이 아닌지)만 하고 주소/문자열을 직접
// 다루지 않는다. 대신 (병원·matchId·구급차·환자케이스)를 keccak256으로 커밋한
// 결과(requestHash)를 회로의 public input으로 넣고, 그 값 그대로를
// GoldenLock.sol::requestAndLock에 다시 넘긴다.
//
//   requestHash = keccak256(hospitalAddress, matchId, ambulanceAddress, patientCaseId) mod p
//
// 재사용(replay) 방지의 핵심은 회로가 아니라 **온체인 usedRequestHash 매핑**이다:
// 같은 requestHash로는 두 번 락을 걸 수 없다. 회로는 그 값이 실제로 계산되어
// 제출되었는지(0이 아닌지)만 강제한다(hospital_resource.circom 참고).
// 즉 "네 값을 ZK로 확인한다"는 건 네 값이 회로 안에서 직접 검증되는 게 아니라,
// 그 값의 해시가 온체인에서 소비 여부를 추적당한다는 뜻이다.
// ============================================================================
import { ethers } from "https://esm.sh/ethers@6.13.4";
import { fieldPrime } from "./contract.js";

const CIRCUIT_WASM = "./circuits/hospital_resource_js/hospital_resource.wasm";
const CIRCUIT_ZKEY = "./circuits/hospital_resource_final.zkey";
const CIRCUIT_VKEY = "./circuits/verification_key.json";

/**
 * 병원주소 · matchId · 구급차주소 · 환자케이스ID를 하나의 field element로 커밋.
 * relay-server가 patientRef를 만들 때 쓰는 keccak256 해시(relayer.ts::hashPatientRef)와
 * 같은 원리이되, 네 값을 모두 묶는다는 점이 다르다.
 */
export function computeRequestHash({ hospitalAddress, matchId, ambulanceAddress, patientCaseId }) {
  const packed = ethers.solidityPackedKeccak256(
    ["address", "string", "address", "string"],
    [hospitalAddress, matchId, ambulanceAddress, patientCaseId]
  );
  const asBigInt = BigInt(packed) % fieldPrime();
  return asBigInt.toString();
}

/**
 * 브라우저(SnarkJS)에서 Groth16 증명을 생성한다. 병원의 실제 병상/전문의 수는
 * 이 함수 호출 스코프를 벗어나지 않는다 — 네트워크로 전송되는 것은 proof뿐이다.
 *
 * @param {{availableBeds:number, availableSpecialists:number, hospitalSecret:string|number,
 *          requiredBeds:number, requiredSpecialists:number, requestHash:string}} input
 * @param {(stage:string)=>void} onStage
 */
export async function generateAvailabilityProof(input, onStage) {
  if (!window.snarkjs) throw new Error("snarkjs가 로드되지 않았습니다 (index.html의 CDN 스크립트 확인).");

  onStage && onStage("witness");
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(
    input,
    CIRCUIT_WASM,
    CIRCUIT_ZKEY
  );
  onStage && onStage("done");
  return { proof, publicSignals };
}

/** 제출 전 브라우저에서 스스로 검증 (선택 사항, 서버/온체인 검증을 대체하지 않음). */
export async function verifyProofLocally(proof, publicSignals) {
  const vkeyRes = await fetch(CIRCUIT_VKEY);
  if (!vkeyRes.ok) throw new Error("verification_key.json을 불러오지 못했습니다.");
  const vkey = await vkeyRes.json();
  return window.snarkjs.groth16.verify(vkey, publicSignals, proof);
}

/**
 * GoldenLock.sol::requestAndLock(..., a, b, c, publicSignals) 호출용으로
 * snarkjs가 만든 proof를 온체인 파라미터 순서로 정렬한다.
 *
 * publicSignals는 [canAccept, requiredBeds, requiredSpecialists, requestHash] 4개이며,
 * IGroth16Verifier.verifyProof / 병원별 hospitalVerifiers 구현체의 시그니처와 정확히
 * 일치한다 (contracts/contracts/interfaces/IGroth16Verifier.sol 참고).
 */
export function toContractCallArgs(proof) {
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]], // snarkjs는 [x,y] 순서가 뒤집혀 나오므로 스왑
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  return { a, b, c };
}
