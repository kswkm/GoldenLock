// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IGroth16Verifier.sol";

/**
 * @title GoldenLock
 * @notice 응급환자 골든타임 내에 구급차(Ambulance)와 병원(Hospital) 간
 *         의료 자원(병상/전문의 슬롯)을 "원자적으로" 확약(lock)하는 컨트랙트.
 *
 *         - 병원은 컨소시엄에 등록되며, 병원마다 서로 다른 ZK 회로/검증키를
 *           쓸 수 있도록 개별 Verifier 주소(hospitalVerifiers)와 총 슬롯 수를 갖는다.
 *         - 병원은 실제 병상/전문의 수를 공개하지 않고, ZK-Proof로 "구급대가 요청한
 *           수량을 수용할 수 있다"는 사실만 증명한다 (hospital_resource.circom).
 *         - 구급대(또는 대리인)는 그 증명을 requestAndLock에 실어 자원을 락(확약)한다.
 *           요청이 성공하면 해당 병원의 슬롯이 즉시 1 소비되어 "동시에 두 구급차가
 *           같은 마지막 슬롯을 잡는" 상황을 방지한다.
 *         - requestHash는 (병원·매치·구급차·환자케이스)를 커밋한 값으로, 같은 증명이
 *           재사용(replay)되는 것을 막는다.
 *         - 병원은 환자를 실제로 수용한 뒤 fulfillRequest를 호출해 슬롯을 정리하고,
 *           구급대(또는 병원/오너)는 취소 시 cancelRequest를, 골든타임 초과 시 누구나
 *           expireIfOverdue를 호출할 수 있다.
 *
 *         relay-server(Layer 2)가 병원/구급대를 대신해 가스비를 대납하는 메타트랜잭션을
 *         지원하기 위해 trustedRelayer 개념을 둔다.
 *
 * @dev EIP-712 서명 검증 (v2): trustedRelayer가 탈취되거나 악의적이더라도 임의 주소를
 *      대리해 요청을 만들 수 없도록, "관계자 본인이 아닌 호출"에는 그 관계자의 EIP-712
 *      서명을 반드시 요구한다.
 *        - requestAndLock: msg.sender == ambulanceOperator 면 서명 불필요(본인 직접 호출).
 *          그 외에는 msg.sender == trustedRelayer 이면서 ambulanceOperator의 서명 필요.
 *        - fulfillRequest / cancelRequest도 동일한 패턴(각각 hospital / ambulanceOperator 서명).
 *      즉 relayer는 "서명을 검증해서 대신 제출해주는 우체부"일 뿐, 서명 없이는 아무
 *      행위자도 대리할 수 없다. 서명 자체의 재사용을 막기 위해 행위자별 nonce를 둔다.
 *      (owner()의 관리자 오버라이드는 운영 복구용 비상 경로로 그대로 남겨둔다 — 오너
 *      키는 이미 별도의 높은 신뢰 등급을 전제하므로 서명 요구 대상에서 제외했다.)
 */
contract GoldenLock is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    // ──────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────

    enum RequestStatus {
        None, // 0: 존재하지 않음
        Locked, // 1: 구급대 요청으로 확약됨, 병원 확정 대기
        Fulfilled, // 2: 병원이 실제 환자 수용을 확정함
        Expired, // 3: 골든타임 초과로 만료됨
        Cancelled // 4: 구급대/오너가 취소함
    }

    struct EmergencyRequest {
        address ambulanceOperator; // 구급대(또는 그 대리인) 주소 — msg.sender가 아니라 명시적으로 기록
        address hospital;
        uint8 ktasLevel; // 1(최중증) ~ 5(경증), ai-engine KTAS 산출값
        uint256 requestedAt;
        uint256 lockDeadline; // 골든타임 내 미도착 시 자동 해제
        RequestStatus status;
    }

    // ──────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────

    /// @notice 락이 유효한 기본 시간 (병원 도착까지 골든타임 여유분)
    uint256 public constant GOLDEN_TIME_DURATION = 15 minutes;

    /// @dev 병원별 Verifier — 컨소시엄 참여 병원마다 다른 회로/키 허용
    mapping(address => IGroth16Verifier) public hospitalVerifiers;
    mapping(address => bool) public isRegisteredHospital;

    mapping(address => uint256) public lockedSlots;
    mapping(address => uint256) public totalSlots;

    uint256 public requestCounter;
    mapping(uint256 => EmergencyRequest) public requests;

    /// @dev 이미 사용된 requestHash 재사용 방지 (ZK proof replay 공격 차단)
    mapping(uint256 => bool) public usedRequestHash;

    /// @notice relay-server가 소유한 가스 대납 지갑. address(0)이면 대리 호출 비활성화.
    address public trustedRelayer;

    /// @dev 행위자별 EIP-712 서명 nonce (서명 재사용 방지). 서명이 성공적으로 소비될 때마다 +1.
    mapping(address => uint256) public nonces;

    // EIP-712 typehash — 각 대리 행위(요청/확정/취소)마다 별도 구조체
    bytes32 private constant REQUEST_LOCK_TYPEHASH =
        keccak256(
            "RequestLock(address hospital,address ambulanceOperator,uint8 ktasLevel,uint256 requestHash,uint256 nonce)"
        );
    bytes32 private constant FULFILL_REQUEST_TYPEHASH =
        keccak256("FulfillRequest(uint256 requestId,uint256 nonce)");
    bytes32 private constant CANCEL_REQUEST_TYPEHASH =
        keccak256("CancelRequest(uint256 requestId,uint256 nonce)");

    // ──────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────

    event HospitalRegistered(address indexed hospital, address verifier, uint256 totalSlots);
    event RequestCreated(
        uint256 indexed requestId,
        address indexed ambulanceOperator,
        address indexed hospital,
        uint8 ktasLevel
    );
    event ResourceLocked(uint256 indexed requestId, address indexed hospital, uint256 deadline);
    event RequestFulfilled(uint256 indexed requestId);
    event RequestExpired(uint256 indexed requestId);
    event RequestCancelled(uint256 indexed requestId);
    event RelayerUpdated(address indexed newRelayer);

    constructor(address _trustedRelayer) Ownable(msg.sender) EIP712("GoldenLock", "1") {
        trustedRelayer = _trustedRelayer;
    }

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

    /**
     * @notice 구급대(대리인 포함)가 특정 병원의 자원을 락(확약)한다.
     * @param hospital           대상 병원 주소
     * @param ambulanceOperator  실제 요청 주체(구급대) 주소. relayer가 대납할 때도
     *                           이 주소가 온체인 기록의 소유자가 된다.
     * @param ktasLevel          ai-engine이 산출한 KTAS 등급 (1~5)
     * @param requestHash        (병원·매치·구급차·환자케이스)를 커밋한 해시. replay 방지.
     * @param publicSignals      [canAccept, requiredBeds, requiredSpecialists, requestHash]
     * @param ambulanceSignature msg.sender != ambulanceOperator일 때만 필요한 EIP-712 서명.
     *                           본인이 직접 호출하는 경우 빈 bytes("")를 넘기면 된다.
     */
    function requestAndLock(
        address hospital,
        address ambulanceOperator,
        uint8 ktasLevel,
        uint256 requestHash,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata publicSignals,
        bytes calldata ambulanceSignature
    ) external nonReentrant returns (uint256 requestId) {
        if (msg.sender != ambulanceOperator) {
            require(msg.sender == trustedRelayer, "GoldenLock: unauthorized caller");
            bytes32 structHash = keccak256(
                abi.encode(
                    REQUEST_LOCK_TYPEHASH,
                    hospital,
                    ambulanceOperator,
                    ktasLevel,
                    requestHash,
                    nonces[ambulanceOperator]
                )
            );
            _verifyAndConsumeNonce(ambulanceOperator, structHash, ambulanceSignature);
        }

        require(isRegisteredHospital[hospital], "hospital not registered");
        require(ktasLevel >= 1 && ktasLevel <= 5, "invalid KTAS level");
        require(!usedRequestHash[requestHash], "requestHash already used (replay)");
        require(publicSignals[3] == requestHash, "requestHash mismatch with public signal");

        IGroth16Verifier verifier = hospitalVerifiers[hospital];
        bool proofValid = verifier.verifyProof(a, b, c, publicSignals);
        require(proofValid, "ZK proof invalid: resource not confirmed");
        require(publicSignals[0] == 1, "hospital cannot accept resource");

        require(lockedSlots[hospital] < totalSlots[hospital], "no slot capacity available");

        usedRequestHash[requestHash] = true;

        requestCounter++;
        requestId = requestCounter;

        requests[requestId] = EmergencyRequest({
            ambulanceOperator: ambulanceOperator,
            hospital: hospital,
            ktasLevel: ktasLevel,
            requestedAt: block.timestamp,
            lockDeadline: block.timestamp + GOLDEN_TIME_DURATION,
            status: RequestStatus.Locked
        });

        lockedSlots[hospital] += 1;

        emit RequestCreated(requestId, ambulanceOperator, hospital, ktasLevel);
        emit ResourceLocked(requestId, hospital, requests[requestId].lockDeadline);
    }

    // ───────────────────────── 도착 확정 ─────────────────────────

    /**
     * @notice 병원이 환자를 실제로 수용했음을 확정한다.
     * @param hospitalSignature msg.sender != req.hospital일 때만 필요한 EIP-712 서명.
     *                          병원이 직접 호출하는 경우 빈 bytes("")를 넘기면 된다.
     */
    function fulfillRequest(uint256 requestId, bytes calldata hospitalSignature) external nonReentrant {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");

        if (msg.sender != req.hospital) {
            require(msg.sender == trustedRelayer || msg.sender == owner(), "not authorized");
            if (msg.sender != owner()) {
                bytes32 structHash = keccak256(
                    abi.encode(FULFILL_REQUEST_TYPEHASH, requestId, nonces[req.hospital])
                );
                _verifyAndConsumeNonce(req.hospital, structHash, hospitalSignature);
            }
        }

        req.status = RequestStatus.Fulfilled;
        _releaseSlot(req.hospital);

        emit RequestFulfilled(requestId);
    }

    // ───────────────────────── 타임아웃 / 취소 ─────────────────────────

    /// @notice 골든타임이 지난 락을 누구나 정리할 수 있다(가스 보상 없는 하우스키핑).
    function expireIfOverdue(uint256 requestId) external {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");
        require(block.timestamp > req.lockDeadline, "not yet expired");

        req.status = RequestStatus.Expired;
        _releaseSlot(req.hospital);

        emit RequestExpired(requestId);
    }

    /**
     * @notice 이송 취소 시 구급대(본인/relayer) 또는 오너가 락을 정상 해제한다.
     * @param ambulanceSignature msg.sender != req.ambulanceOperator일 때만 필요한 EIP-712 서명.
     */
    function cancelRequest(uint256 requestId, bytes calldata ambulanceSignature) external {
        EmergencyRequest storage req = requests[requestId];
        require(req.status == RequestStatus.Locked, "not in locked state");

        if (msg.sender != req.ambulanceOperator) {
            require(msg.sender == trustedRelayer || msg.sender == owner(), "not authorized");
            if (msg.sender != owner()) {
                bytes32 structHash = keccak256(
                    abi.encode(CANCEL_REQUEST_TYPEHASH, requestId, nonces[req.ambulanceOperator])
                );
                _verifyAndConsumeNonce(req.ambulanceOperator, structHash, ambulanceSignature);
            }
        }

        req.status = RequestStatus.Cancelled;
        _releaseSlot(req.hospital);

        emit RequestCancelled(requestId);
    }

    function _releaseSlot(address hospital) internal {
        if (lockedSlots[hospital] > 0) {
            lockedSlots[hospital] -= 1;
        }
    }

    /// @dev EIP-712 서명을 검증하고, 성공 시 서명자의 nonce를 소비(+1)한다.
    ///      실패 시 revert하므로 잘못된/재사용된 서명으로는 상태 변경이 일어나지 않는다.
    function _verifyAndConsumeNonce(
        address expectedSigner,
        bytes32 structHash,
        bytes calldata signature
    ) internal {
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        require(recovered == expectedSigner, "GoldenLock: invalid signature");
        nonces[expectedSigner] += 1;
    }

    // ───────────────────────── Admin ─────────────────────────

    function setTrustedRelayer(address _relayer) external onlyOwner {
        trustedRelayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    // ───────────────────────── 조회 ─────────────────────────

    function getRequest(uint256 requestId) external view returns (EmergencyRequest memory) {
        return requests[requestId];
    }

    function isRequestActive(uint256 requestId) external view returns (bool) {
        EmergencyRequest storage req = requests[requestId];
        return req.status == RequestStatus.Locked && block.timestamp <= req.lockDeadline;
    }

    function availableSlots(address hospital) external view returns (uint256) {
        if (lockedSlots[hospital] >= totalSlots[hospital]) return 0;
        return totalSlots[hospital] - lockedSlots[hospital];
    }
}
