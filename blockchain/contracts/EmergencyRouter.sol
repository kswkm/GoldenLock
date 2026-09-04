// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

// SnarkJS에서 자동 생성해 줄 검증(Verifier) 컨트랙트의 인터페이스
interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b, 
        uint[2] calldata c,
        uint[2] calldata input // [can_accept, required_beds]
    ) external view returns (bool);
}

contract EmergencyRouter is Ownable {
    IVerifier public verifier;

    // 환자 요청 데이터 구조체
    struct PatientRequest {
        uint256 requestId;
        uint256 requiredBeds; // 요구 자원량 (예: 필요 병상 수)
        address acceptedHospital; // 수락한 병원 지갑 주소
        bool isResolved; // 처리 완료 여부
    }

    mapping(uint256 => PatientRequest) public requests;
    uint256 public nextRequestId;

    // 💡 에러를 해결하기 위해 추가된 생성자(Constructor) 부분입니다!
    // 배포하는 사람(msg.sender)을 이 컨트랙트의 주인(Owner)으로 설정합니다.
    constructor() Ownable(msg.sender) {}

    // 새로운 응급 환자 발생 시 (API/백엔드에서 호출)
    function createPatientRequest(uint256 _requiredBeds) external onlyOwner {
        requests[nextRequestId] = PatientRequest({
            requestId: nextRequestId,
            requiredBeds: _requiredBeds,
            acceptedHospital: address(0),
            isResolved: false
        });
        nextRequestId++;
    }

    // 병원이 영지식 증명(ZK Proof)을 제출하여 환자 수용을 승인할 때 호출
    function acceptPatient(
        uint256 _requestId,
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[2] calldata input // input[0] = 수용가능여부(1), input[1] = 요구자원량
    ) external {
        PatientRequest storage req = requests[_requestId];
        
        require(!req.isResolved, "This request is already resolved.");
        require(input[0] == 1, "Proof indicates hospital cannot accept.");
        require(input[1] == req.requiredBeds, "Resource mismatch with request.");

        // ZK Proof 검증 (가려진 병원 자원이 요구 자원보다 충분한지 검증)
        require(verifier.verifyProof(a, b, c, input), "Invalid Zero-Knowledge Proof!");

        // 검증 통과 시 해당 병원으로 환자 배정 및 요청 마감
        req.acceptedHospital = msg.sender;
        req.isResolved = true;
    }
}