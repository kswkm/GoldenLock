// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GoldenLock
 * @notice 응급환자 골든타임 내에 구급차(Ambulance)와 병원(Hospital) 간
 *         의료 자원(병상/장비 슬롯)을 "원자적으로" 확약(lock)하는 컨트랙트.
 *
 *         - 병원은 실제 병상 수를 공개하지 않고, ZK-Proof로 "특정 자원 코드에 대해
 *           1개 이상 가용하다"는 사실만 증명한다 (submitAvailabilityProof).
 *         - 증명이 유효하면 온체인 availability 플래그가 true로 세팅된다.
 *         - 구급대는 AI(KTAS) 산출 자원 코드로 락을 요청한다 (requestLock).
 *           요청이 성공하면 해당 (hospital, resourceCode)의 availability는 즉시
 *           false로 내려가 "동시에 두 구급차가 같은 마지막 슬롯을 잡는" 상황을 방지한다.
 *         - 병원은 물리적으로 환자를 수용한 뒤 confirmAcceptance를 호출해 락을 확정한다.
 *         - 락은 LOCK_TTL 이후 만료되며, 누구나 expireLock을 호출해 상태를 정리할 수 있다
 *           (단, 만료된다고 availability가 자동 복구되진 않는다 — 병원이 최신 병상 수로
 *           새 ZK 증명을 다시 제출해야 재개방된다. 이는 락 만료 시점과 실제 병상 변동
 *           사이의 stale-state 악용을 막기 위한 설계다).
 *
 *         relay-server(Layer 2)가 병원/구급대를 대신해 가스비를 대납하는 메타트랜잭션을
 *         지원하기 위해 trustedRelayer 개념을 둔다.
 */
contract GoldenLock {
    using ECDSA for bytes32;
    // ──────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────

    enum LockStatus {
        None, // 0: 존재하지 않음
        Locked, // 1: 구급대 요청으로 확약됨, 병원 확정 대기
        Confirmed, // 2: 병원이 실제 환자 수용을 확정함
        Released, // 3: 정상 종료(이송 취소/완료 후 해제)
        Expired // 4: TTL 초과로 만료됨
    }

    struct Lock {
        address hospital;
        address requester; // 구급대(또는 그 대리인) 주소
        uint256 resourceCode; // KTAS -> 자원코드 매핑 값 (예: 0x01 = ICU)
        bytes32 patientRef; // PII 없는 환자 참조 해시 (예: keccak256(caseId))
        uint256 createdAt;
        uint256 expiresAt;
        LockStatus status;
    }

    // ──────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────

    /// @notice 락이 유효한 기본 시간 (병원 도착까지 골든타임 여유분)
    uint256 public constant LOCK_TTL = 15 minutes;

    IVerifier public verifier;
    address public admin;
    address public trustedRelayer;

    /// @dev hospital => resourceCode => 최신 ZK 증명으로 확인된 가용 여부
    mapping(address => mapping(uint256 => bool)) public availability;

    /// @dev hospital => resourceCode => 마지막 증명 갱신 시각 (신선도 체크용)
    mapping(address => mapping(uint256 => uint256)) public lastProofAt;
    mapping(address => uint256) public availabilityNonces;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant AVAILABILITY_TYPEHASH = keccak256(
        "Availability(address hospital,uint256 resourceCode,uint256 isAvailable,uint256 nonce)"
    );

    uint256 public nextLockId = 1;
    mapping(uint256 => Lock) public locks;

    // ──────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────

    event AvailabilityUpdated(address indexed hospital, uint256 indexed resourceCode, bool isAvailable);
    event LockRequested(
        uint256 indexed lockId,
        address indexed hospital,
        address indexed requester,
        uint256 resourceCode,
        bytes32 patientRef,
        uint256 expiresAt
    );
    event LockConfirmed(uint256 indexed lockId, address indexed hospital);
    event LockReleased(uint256 indexed lockId, address indexed releasedBy);
    event LockExpired(uint256 indexed lockId);
    event RelayerUpdated(address indexed newRelayer);

    // ──────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "GoldenLock: not admin");
        _;
    }

    /// @dev actor 본인이거나, 가스를 대납하는 trustedRelayer만 대리 실행 가능
    modifier onlySelfOrRelayer(address actor) {
        require(msg.sender == actor || msg.sender == trustedRelayer, "GoldenLock: unauthorized caller");
        _;
    }

    // ──────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────

    constructor(address _verifier, address _trustedRelayer) {
        require(_verifier != address(0), "GoldenLock: zero verifier");
        verifier = IVerifier(_verifier);
        admin = msg.sender;
        trustedRelayer = _trustedRelayer;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("GoldenLock")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ──────────────────────────────────────────────────────────
    // Hospital: availability via ZK proof
    // ──────────────────────────────────────────────────────────

    /**
     * @notice 병원이 특정 자원 코드에 대한 가용성을 ZK 증명으로 갱신한다.
     * @param resourceCode KTAS 등급이 매핑된 자원 코드 (ai-engine의 resource_mapper.py 산출값)
     * @param isAvailable  회로의 public output (0 또는 1)
     */
    function submitAvailabilityProof(
        uint256 resourceCode,
        uint256 isAvailable,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        require(isAvailable == 0 || isAvailable == 1, "GoldenLock: invalid signal");

        uint256[2] memory input = [resourceCode, isAvailable];
        bool valid = verifier.verifyProof(a, b, c, input);
        require(valid, "GoldenLock: invalid ZK proof");

        // 참고: 병원을 대신해 relayer가 트랜잭션을 대납하는 경우
        //       실제 hospital 주소는 relay-server가 서명 검증 후 별도 파라미터로
        //       전달하는 구조로 확장 가능 (여기서는 msg.sender == hospital 가정,
        //       relayer 사용 시 hospital의 서명을 받아 다른 오버로드를 쓰는 것을 권장).
        address hospital = msg.sender == trustedRelayer ? admin : msg.sender;

        availability[hospital][resourceCode] = (isAvailable == 1);
        lastProofAt[hospital][resourceCode] = block.timestamp;

        emit AvailabilityUpdated(hospital, resourceCode, isAvailable == 1);
    }

    /**
     * @notice 병원이 EIP-712로 서명한 가용성 증명을 trustedRelayer가 대납한다.
     */
    function submitAvailabilityProofFor(
        address hospital,
        uint256 resourceCode,
        uint256 isAvailable,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 nonce,
        bytes calldata signature
    ) external onlyTrustedRelayer {
        require(hospital != address(0), "GoldenLock: zero hospital");
        require(nonce == availabilityNonces[hospital], "GoldenLock: invalid nonce");
        bytes32 structHash = keccak256(abi.encode(AVAILABILITY_TYPEHASH, hospital, resourceCode, isAvailable, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(digest.recover(signature) == hospital, "GoldenLock: invalid hospital signature");
        availabilityNonces[hospital] = nonce + 1;
        _submitAvailabilityProof(hospital, resourceCode, isAvailable, a, b, c);
    }

    modifier onlyTrustedRelayer() {
        require(msg.sender == trustedRelayer, "GoldenLock: not relayer");
        _;
    }

    function _submitAvailabilityProof(
        address hospital,
        uint256 resourceCode,
        uint256 isAvailable,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) internal {
        require(isAvailable == 0 || isAvailable == 1, "GoldenLock: invalid signal");
        uint256[2] memory input = [resourceCode, isAvailable];
        require(verifier.verifyProof(a, b, c, input), "GoldenLock: invalid ZK proof");
        availability[hospital][resourceCode] = (isAvailable == 1);
        lastProofAt[hospital][resourceCode] = block.timestamp;
        emit AvailabilityUpdated(hospital, resourceCode, isAvailable == 1);
    }

    // ──────────────────────────────────────────────────────────
    // Ambulance: request / hospital: confirm / either: release
    // ──────────────────────────────────────────────────────────

    /**
     * @notice 구급대가 특정 병원의 자원을 락(확약)한다. 성공 시 해당 자원의
     *         availability는 즉시 false로 내려가 이중 확약을 원천 차단한다.
     */
    function requestLock(
        address hospital,
        uint256 resourceCode,
        bytes32 patientRef,
        address requester
    ) external onlySelfOrRelayer(requester) returns (uint256 lockId) {
        require(availability[hospital][resourceCode], "GoldenLock: resource not available");

        // atomic: 가용 플래그를 즉시 소비 → 같은 슬롯 이중 락 방지
        availability[hospital][resourceCode] = false;

        lockId = nextLockId++;
        locks[lockId] = Lock({
            hospital: hospital,
            requester: requester,
            resourceCode: resourceCode,
            patientRef: patientRef,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + LOCK_TTL,
            status: LockStatus.Locked
        });

        emit LockRequested(lockId, hospital, requester, resourceCode, patientRef, block.timestamp + LOCK_TTL);
    }

    /**
     * @notice 병원이 환자를 실제로 수용했음을 확정한다. 만료된 락은 확정 불가.
     */
    function confirmAcceptance(uint256 lockId) external {
        Lock storage lock = locks[lockId];
        require(lock.status == LockStatus.Locked, "GoldenLock: lock not active");
        require(msg.sender == lock.hospital || msg.sender == trustedRelayer, "GoldenLock: not hospital");
        require(block.timestamp <= lock.expiresAt, "GoldenLock: lock expired");

        lock.status = LockStatus.Confirmed;
        emit LockConfirmed(lockId, lock.hospital);
    }

    /**
     * @notice 이송 취소 등으로 락을 정상 해제한다. 병원/요청자/relayer만 가능.
     */
    function releaseLock(uint256 lockId) external {
        Lock storage lock = locks[lockId];
        require(
            lock.status == LockStatus.Locked || lock.status == LockStatus.Confirmed,
            "GoldenLock: nothing to release"
        );
        require(
            msg.sender == lock.hospital || msg.sender == lock.requester || msg.sender == trustedRelayer,
            "GoldenLock: unauthorized"
        );

        lock.status = LockStatus.Released;
        emit LockReleased(lockId, msg.sender);
    }

    /**
     * @notice TTL이 지난 락을 누구나 정리할 수 있다(가스 보상 없는 하우스키핑).
     *         availability는 자동 복구하지 않는다 (설계 의도는 파일 상단 NatSpec 참고).
     */
    function expireLock(uint256 lockId) external {
        Lock storage lock = locks[lockId];
        require(lock.status == LockStatus.Locked, "GoldenLock: lock not active");
        require(block.timestamp > lock.expiresAt, "GoldenLock: lock not yet expired");

        lock.status = LockStatus.Expired;
        emit LockExpired(lockId);
    }

    // ──────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────

    function setTrustedRelayer(address _relayer) external onlyAdmin {
        trustedRelayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function setVerifier(address _verifier) external onlyAdmin {
        require(_verifier != address(0), "GoldenLock: zero verifier");
        verifier = IVerifier(_verifier);
    }

    // ──────────────────────────────────────────────────────────
    // View helpers
    // ──────────────────────────────────────────────────────────

    function getLock(uint256 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }

    function isLockActive(uint256 lockId) external view returns (bool) {
        Lock storage lock = locks[lockId];
        return lock.status == LockStatus.Locked && block.timestamp <= lock.expiresAt;
    }
}
