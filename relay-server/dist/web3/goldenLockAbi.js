"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANCEL_REQUEST_TYPES = exports.FULFILL_REQUEST_TYPES = exports.REQUEST_LOCK_TYPES = exports.EIP712_DOMAIN_VERSION = exports.EIP712_DOMAIN_NAME = exports.GOLDEN_LOCK_ABI = void 0;
/**
 * GoldenLock.sol에서 relay-server가 실제로 호출/구독하는 함수·이벤트만 추린 최소 ABI.
 * v2: requestAndLock/fulfillRequest/cancelRequest는 EIP-712 서명 파라미터를 받는다
 * (relayer가 대납할 때만 필요 — 본인이 직접 호출할 때는 빈 bytes를 넘긴다).
 * 전체 ABI는 contracts/artifacts/contracts/GoldenLock.sol/GoldenLock.json 빌드 후
 * 그것을 import해서 이 파일을 대체해도 된다 (모노레포 빌드 파이프라인 연결 시).
 */
exports.GOLDEN_LOCK_ABI = [
    "function requestAndLock(address hospital, address ambulanceOperator, uint8 ktasLevel, uint256 requestHash, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[4] publicSignals, bytes ambulanceSignature) external returns (uint256 requestId)",
    "function fulfillRequest(uint256 requestId, bytes hospitalSignature) external",
    "function cancelRequest(uint256 requestId, bytes ambulanceSignature) external",
    "function expireIfOverdue(uint256 requestId) external",
    "function isRegisteredHospital(address hospital) view returns (bool)",
    "function availableSlots(address hospital) view returns (uint256)",
    "function totalSlots(address hospital) view returns (uint256)",
    "function lockedSlots(address hospital) view returns (uint256)",
    "function trustedRelayer() view returns (address)",
    "function requestCounter() view returns (uint256)",
    "function nonces(address actor) view returns (uint256)",
    "function getRequest(uint256 requestId) view returns (tuple(address ambulanceOperator, address hospital, uint8 ktasLevel, uint256 requestedAt, uint256 lockDeadline, uint8 status))",
    "event HospitalRegistered(address indexed hospital, address verifier, uint256 totalSlots)",
    "event RequestCreated(uint256 indexed requestId, address indexed ambulanceOperator, address indexed hospital, uint8 ktasLevel)",
    "event ResourceLocked(uint256 indexed requestId, address indexed hospital, uint256 deadline)",
    "event RequestFulfilled(uint256 indexed requestId)",
    "event RequestExpired(uint256 indexed requestId)",
    "event RequestCancelled(uint256 indexed requestId)",
];
/** 프론트엔드와 relay-server가 공유해야 하는 EIP-712 도메인/타입 정의. */
exports.EIP712_DOMAIN_NAME = "GoldenLock";
exports.EIP712_DOMAIN_VERSION = "1";
exports.REQUEST_LOCK_TYPES = {
    RequestLock: [
        { name: "hospital", type: "address" },
        { name: "ambulanceOperator", type: "address" },
        { name: "ktasLevel", type: "uint8" },
        { name: "requestHash", type: "uint256" },
        { name: "nonce", type: "uint256" },
    ],
};
exports.FULFILL_REQUEST_TYPES = {
    FulfillRequest: [
        { name: "requestId", type: "uint256" },
        { name: "nonce", type: "uint256" },
    ],
};
exports.CANCEL_REQUEST_TYPES = {
    CancelRequest: [
        { name: "requestId", type: "uint256" },
        { name: "nonce", type: "uint256" },
    ],
};
