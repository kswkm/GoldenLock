// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Verifier.sol";

/**
 * @title GoldenLock
 * @notice 구급대 KTAS 자원 요청 -> ZK Proof(hospital_resource.circom) 검증
 *         -> 자원 원자적 확약(Lock) -> 도착/타임아웃 시 해제(Release)
 */
contract GoldenLock is Ownable, ReentrancyGuard {
    enum RequestStatus {
        None,
        Pending,
        Locked,
        Fulfilled,
        Expired,
        Cancelled
    }

    struct EmergencyRequest {
        address ambulanceOperator;
        address hospital;
        uint8 ktasLevel;       // 1(최중증) ~ 5(경증)
        uint256 requestedAt;
        uint256 lockDeadline;  // 골든타임 내 미도착 시 자동 해제
        RequestStatus status;
    }

    /// @dev 병원별 Verifier — 컨소시엄 참여 병원마다 다른 회로/키 허용
    mapping(address => IGroth16Verifier) public hospitalVerifiers;
    mapping(address => bool) public isRegisteredHospital;

    uint256 public requestCounter;
    mapping(uint256 => EmergencyRequest) public requests;

    /// @dev 이미 사용된 requestHash 재사용 방지 (ZK proof replay 공격 차단)
    mapping(uint256 => bool) public usedRequestHash;

    mapping(address => uint256) public lockedSlots;
    mapping(address => uint256) public totalSlots;

    uint256 public constant DEFAULT_LOCK_DURATION = 20 minutes;

    event HospitalRegistered(address indexed hospital, address verifier, uint256 totalSlots);
    event RequestCreated(uint256 indexed requestId, address indexed ambulance, address indexed hospital, uint8 ktasLevel);
    event ResourceLocked(uint256 indexed requestId, address indexed hospital, uint256 deadline);
    event RequestFulfilled(uint256 indexed requestId);
    event RequestExpired(uint256 indexed requestId);
    event RequestCancelled(uint256 indexed requestId);

    constructor() Ownable(msg.sender) {}

    // ───────────────────────── 병원 등록 ─────────────────────────

    function registerHospital(
        address hospital,
        address verifierAddress,
        uint256 slotCapacity
    ) external onlyOwner {
        require(hospital != address(0), "invalid hospital");
        require(verifierAddress != address(0), "invalid verifier");

        isRegisteredHospital[hospital] = true;
        hospitalVerifiers[hospital] = IGroth16Verifier(verifierAddress);
        totalSlots[hospital] = slotCapacity;

        emit HospitalRegistered(hospital, verifierAddress, slotCapacity);
    }

    // ───────────────────────── 요청 생성 + ZK 검증 + Lock ─────────────────────────

    function requestAndLock(
        address hospital,
        uint8 ktasLevel,
        uint256 requestHash,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata publicSignals
    ) external nonReentrant returns (uint256 requestId) {
        require(isRegisteredHospital[hospital], "hospital not registered");
        require(ktasLevel >= 1 && ktasLevel <= 5, "invalid KTAS level");
        require(!usedRequestHash[requestHash], "requestHash already used (replay)");

        IGroth16Verifier verifier = hospitalVerifiers[hospital];
        bool proofValid = verifier.verifyProof(a, b, c, publicSignals);
        require(proofValid, "ZK proof invalid: resource not confirmed");
        require(publicSignals[0] == 1, "hospital cannot accept resource");

        require(lockedSlots[hospital] < totalSlots[hospital], "no slot capacity available");

        usedRequestHash[requestHash] = true;

        requestCounter++;
        requestId = requestCounter;

        requests[requestId] = EmergencyRequest({
            ambulanceOperator: msg.sender,
            hospital: hospital,
            ktasLevel: ktasLevel,
            requestedAt: block.timestamp,
            lockDeadline: block.timestamp + DEFAULT_LOCK_DURATION,
            status: RequestStatus.Locked
        });

        lockedSlots[hospital] += 1;

        emit RequestCreated(requestId, msg.sender, hospital, ktasLevel);
        emit ResourceLocked(requestId, hospital, requests[requestId].lockDeadline);
    }

    // ───────────────────────── 도착 확정 ─────────────────────────

    function fulfillRequest(uint256 requestId) external nonReentrant {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");
        require(
            msg.sender == req.hospital || msg.sender == req.ambulanceOperator || msg.sender == owner(),
            "not authorized"
        );

        req.status = RequestStatus.Fulfilled;
        _releaseSlot(req.hospital);

        emit RequestFulfilled(requestId);
    }

    // ───────────────────────── 타임아웃 / 취소 ─────────────────────────

    function expireIfOverdue(uint256 requestId) external {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");
        require(block.timestamp > req.lockDeadline, "not yet expired");

        req.status = RequestStatus.Expired;
        _releaseSlot(req.hospital);

        emit RequestExpired(requestId);
    }

    function cancelRequest(uint256 requestId) external {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");
        require(msg.sender == req.ambulanceOperator || msg.sender == owner(), "not authorized");

        req.status = RequestStatus.Cancelled;
        _releaseSlot(req.hospital);

        emit RequestCancelled(requestId);
    }

    function _releaseSlot(address hospital) internal {
        if (lockedSlots[hospital] > 0) {
            lockedSlots[hospital] -= 1;
        }
    }

    // ───────────────────────── 조회 ─────────────────────────

    function getRequest(uint256 requestId) external view returns (EmergencyRequest memory) {
        return requests[requestId];
    }
}
