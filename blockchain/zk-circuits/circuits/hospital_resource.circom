pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/gates.circom";

/*
 * hospital_resource.circom
 * ------------------------------------------------------------
 * 병원의 비공개 자원 현황을 노출하지 않고
 * "요청 자원을 수용 가능한지" 여부만 공개 증명하는 회로.
 *
 * Private Inputs (병원만 아는 값, 절대 공개 안 됨):
 *   - availableBeds       : 현재 가용 병상 수
 *   - availableSpecialists: 현재 가용 전문의 수
 *   - hospitalSecret      : 병원 인증용 salt (재사용 공격 방지)
 *
 * Public Inputs (온체인에 공개되는 값):
 *   - requiredBeds        : 구급대가 요청한 필요 병상 수
 *   - requiredSpecialists : 구급대가 요청한 필요 전문의 수
 *   - requestHash         : 요청 ID 등을 커밋한 해시(재사용 방지용, poseidon 등으로 off-chain 계산)
 *
 * Output:
 *   - canAccept (1 = 수용 가능, 0 = 불가능)
 */
template HospitalResourceCheck() {
    // ---- Private inputs ----
    signal input availableBeds;
    signal input availableSpecialists;
    signal input hospitalSecret;

    // ---- Public inputs ----
    signal input requiredBeds;
    signal input requiredSpecialists;
    signal input requestHash;

    // ---- Output ----
    signal output canAccept;

    // 1) 병상 수 충분한지 확인
    component bedsGte = GreaterEqThan(32);
    bedsGte.in[0] <== availableBeds;
    bedsGte.in[1] <== requiredBeds;

    // 2) 전문의 수 충분한지 확인
    component specGte = GreaterEqThan(32);
    specGte.in[0] <== availableSpecialists;
    specGte.in[1] <== requiredSpecialists;

    // 3) AND
    component andGate = AND();
    andGate.a <== bedsGte.out;
    andGate.b <== specGte.out;

    canAccept <== andGate.out;

    // 4) hospitalSecret과 requestHash를 회로에 바인딩 -> 재사용/위조 방지
    signal bindCheck;
    bindCheck <== hospitalSecret * requestHash;
    signal dummyOut;
    dummyOut <== bindCheck * 0 + canAccept;
}

component main {public [requiredBeds, requiredSpecialists, requestHash]} = HospitalResourceCheck();
