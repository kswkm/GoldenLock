// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input // [canAccept, requiredBeds, requiredSpecialists] 등 public signal 개수에 맞춤
    ) external view returns (bool);
}

/// @notice zk-circuits/scripts/generate_verifier.sh 실행 시 이 파일이
///         SnarkJS 생성 실제 Verifier로 자동 교체됩니다. 그 전까지는 통합 테스트용 mock.
contract Verifier is IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external pure override returns (bool) {
        a; b; c; input;
        return true;
    }
}
