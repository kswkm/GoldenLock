// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IGroth16Verifier
 * @notice zk-circuits/circuits/hospital_resource.circom 에서 snarkjs로 생성되는
 *         Groth16 Verifier.sol의 표준 인터페이스.
 *
 *         zk-circuits/scripts/generate_verifier.sh 실행 시 실제 Verifier.sol이
 *         이 시그니처로 자동 생성되어 contracts/contracts/Verifier.sol에 배치된다.
 *         회로가 교체되기 전까지는 mocks/MockVerifier.sol(또는 자리표시자
 *         Verifier.sol)로 대체해서 테스트/배포한다.
 *
 *         public signal 구성 (4개, circom이 output을 맨 앞에 배치한다):
 *           input[0] = canAccept            (0 또는 1 — 회로 output)
 *           input[1] = requiredBeds         (구급대가 요청한 필요 병상 수)
 *           input[2] = requiredSpecialists  (구급대가 요청한 필요 전문의 수)
 *           input[3] = requestHash          (병원·매치·구급차·환자케이스 커밋 해시, replay 방지)
 *
 *         private input(회로 내부, 온체인 비노출):
 *           availableBeds, availableSpecialists, hospitalSecret
 *
 *         병원마다 서로 다른 회로/키를 쓸 수 있도록 GoldenLock.sol은 병원별로
 *         이 인터페이스의 별도 구현체 주소를 등록한다 (hospitalVerifiers).
 */
interface IGroth16Verifier {
    /// @dev 의도적으로 `view`를 지정하지 않는다. 실제 SnarkJS 생성 Verifier는 보통
    ///      `pure`/`view`로 구현되지만(더 엄격한 mutability라 문제 없음), MockVerifier처럼
    ///      디버깅용 이벤트를 emit하는(=state-changing) 구현도 허용하기 위함이다.
    ///      Solidity는 `view` 인터페이스 함수를 state-changing 함수로 override하는 것을
    ///      금지하므로(TypeError: changes state mutability from "view" to "non-payable"),
    ///      여기서 mutability를 명시하지 않아야 두 종류의 구현체가 모두 컴파일된다.
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata input
    ) external returns (bool);
}
