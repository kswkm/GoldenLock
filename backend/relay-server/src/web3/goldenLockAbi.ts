/**
 * GoldenLock.sol에서 relay-server가 실제로 호출/구독하는 함수·이벤트만 추린 최소 ABI.
 * 전체 ABI는 contracts/artifacts/contracts/GoldenLock.sol/GoldenLock.json 빌드 후
 * 그것을 import해서 이 파일을 대체해도 된다 (모노레포 빌드 파이프라인 연결 시).
 */
export const GOLDEN_LOCK_ABI = [
  "function submitAvailabilityProof(uint256 resourceCode, uint256 isAvailable, uint256[2] a, uint256[2][2] b, uint256[2] c) external",
  "function requestLock(address hospital, uint256 resourceCode, bytes32 patientRef, address requester) external returns (uint256 lockId)",
  "function confirmAcceptance(uint256 lockId) external",
  "function releaseLock(uint256 lockId) external",
  "function expireLock(uint256 lockId) external",
  "function availability(address hospital, uint256 resourceCode) view returns (bool)",
  "function getLock(uint256 lockId) view returns (tuple(address hospital, address requester, uint256 resourceCode, bytes32 patientRef, uint256 createdAt, uint256 expiresAt, uint8 status))",

  "event AvailabilityUpdated(address indexed hospital, uint256 indexed resourceCode, bool isAvailable)",
  "event LockRequested(uint256 indexed lockId, address indexed hospital, address indexed requester, uint256 resourceCode, bytes32 patientRef, uint256 expiresAt)",
  "event LockConfirmed(uint256 indexed lockId, address indexed hospital)",
  "event LockReleased(uint256 indexed lockId, address indexed releasedBy)",
  "event LockExpired(uint256 indexed lockId)",
] as const;
