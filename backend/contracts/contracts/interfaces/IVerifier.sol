// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVerifier
 * @notice snarkjs로 Circom 회로(hospital_resource.circom)에서 생성되는
 *         Groth16 Verifier.sol의 표준 인터페이스.
 *
 *         zk-circuits/scripts/generate_verifier.sh 실행 시 실제 Verifier.sol이
 *         이 시그니처로 자동 생성되어 contracts/contracts/Verifier.sol에 배치됩니다.
 *         회로가 완성되기 전까지는 mocks/MockVerifier.sol로 대체해서 테스트/배포합니다.
 *
 *         public input 구성 (2개):
 *           input[0] = resourceCode  (예: 0x01 = ICU 병상, 0x02 = 외상소생실 ...)
 *           input[1] = isAvailable   (0 또는 1 — 병원이 해당 자원을 1개 이상 보유하는지 여부)
 *
 *         private input(회로 내부, 온체인 비노출):
 *           실제 병상 수, 임계값 등 민감한 원자재 정보
 */
interface IVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[2] calldata input
    ) external view returns (bool);
}
