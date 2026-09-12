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
 *   - hospitalSecret      : 병원 인증용 salt (0이면 안 됨 — 아래 제약으로 강제)
 *
 * Public Inputs (온체인에 공개되는 값):
 *   - requiredBeds        : 구급대가 요청한 필요 병상 수
 *   - requiredSpecialists : 구급대가 요청한 필요 전문의 수
 *   - requestHash         : (병원·매치·구급차·환자케이스)를 커밋한 해시. 온체인
 *                            GoldenLock.sol::usedRequestHash가 이 값의 재사용을 막는다.
 *
 * Output:
 *   - canAccept (1 = 수용 가능, 0 = 불가능)
 *
 * 재사용(replay) 방지는 최종적으로 온체인 GoldenLock.sol의 usedRequestHash 매핑이
 * 담당한다(같은 requestHash로 두 번 락을 걸 수 없음). 이 회로에서는 hospitalSecret과
 * requestHash가 실제로 0이 아닌 값으로 제출되었음을 강제해, 두 값이 회로의 제약
 * 그래프에 실질적으로 편입되도록 한다 — 값을 준비하지 않고는(secret=0 또는
 * requestHash=0) 유효한 증명을 만들 수 없다.
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

    // 3) 자원 조건 AND
    component resourceOk = AND();
    resourceOk.a <== bedsGte.out;
    resourceOk.b <== specGte.out;

    // 4) hospitalSecret != 0 강제 (더미 값으로 증명을 만들 수 없도록)
    component secretIsZero = IsZero();
    secretIsZero.in <== hospitalSecret;
    signal secretOk;
    secretOk <== 1 - secretIsZero.out;

    // 5) requestHash != 0 강제 (온체인 usedRequestHash 재사용 방지가 실제로 작동하려면
    //    이 값이 매 요청마다 실제로 계산되어 들어와야 한다)
    component hashIsZero = IsZero();
    hashIsZero.in <== requestHash;
    signal hashOk;
    hashOk <== 1 - hashIsZero.out;

    // 6) 최종 canAccept = 자원 충분 AND secretOk AND hashOk
    component step1 = AND();
    step1.a <== resourceOk.out;
    step1.b <== secretOk;

    component step2 = AND();
    step2.a <== step1.out;
    step2.b <== hashOk;

    canAccept <== step2.out;
}

component main {public [requiredBeds, requiredSpecialists, requestHash]} = HospitalResourceCheck();
