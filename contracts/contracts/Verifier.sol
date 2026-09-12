// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IGroth16Verifier.sol";

/**
 * @title MockVerifier
 * @notice zk-circuits에서 생성된 실제 Verifier.sol이 나오기 전까지
 *         GoldenLock.sol / relay-server를 독립적으로 개발·테스트하기 위한 더미 검증기.
 *
 *         proof(a, b, c) 값은 무시하고, input[0](canAccept)이 1이면 true를 반환한다.
 *         즉 "증명이 올바르게 생성되었다면 통과한다"는 happy-path만 시뮬레이션한다.
 *
 * ⚠️ 프로덕션/실제 배포 전 반드시 zk-circuits에서 생성된 진짜 Verifier로 교체할 것.
 */
contract MockVerifier is IGroth16Verifier {
    /// @notice 데모 중 강제로 실패 케이스를 재현하고 싶을 때 사용하는 전역 스위치
    bool public forceInvalid;

    event MockVerifyCalled(uint256 canAccept, uint256 requiredBeds, uint256 requiredSpecialists, bool result);

    function setForceInvalid(bool _forceInvalid) external {
        forceInvalid = _forceInvalid;
    }

    function verifyProof(
        uint256[2] calldata, /* a */
        uint256[2][2] calldata, /* b */
        uint256[2] calldata, /* c */
        uint256[4] calldata input
    ) external override returns (bool) {
        bool result = !forceInvalid && input[0] == 1;
        emit MockVerifyCalled(input[0], input[1], input[2], result);
        return result;
    }
}
