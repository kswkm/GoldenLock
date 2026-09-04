// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IVerifier.sol";

/**
 * @title MockVerifier
 * @notice zk-circuits 팀의 실제 Groth16 Verifier.sol이 나오기 전까지
 *         GoldenLock.sol / relay-server를 독립적으로 개발·테스트하기 위한 더미 검증기.
 *
 *         proof(a, b, c) 값은 무시하고, input[1](isAvailable)이 1이면 true를 반환합니다.
 *         즉 "증명이 올바르게 생성되었다면 통과한다"는 happy-path만 시뮬레이션합니다.
 *
 *         ⚠️ 프로덕션/실제 배포 전 반드시 zk-circuits에서 생성된 진짜 Verifier.sol로 교체할 것.
 */
contract MockVerifier is IVerifier {
    /// @notice 데모 중 강제로 실패 케이스를 재현하고 싶을 때 사용하는 전역 스위치
    bool public forceInvalid;

    function setForceInvalid(bool _forceInvalid) external {
        forceInvalid = _forceInvalid;
    }

    /// @dev IVerifier.verifyProof가 view로 선언되어 있으므로 이 함수도 반드시 view를
    ///      유지해야 한다 (view -> non-payable로의 오버라이드는 Solidity에서 금지됨).
    ///      따라서 여기서는 이벤트를 emit하지 않고 순수 계산만 수행한다.
    function verifyProof(
        uint256[2] calldata, /* a */
        uint256[2][2] calldata, /* b */
        uint256[2] calldata, /* c */
        uint256[2] calldata input
    ) external view override returns (bool) {
        return !forceInvalid && input[1] == 1;
    }
}
