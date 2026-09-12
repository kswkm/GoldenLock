// ============================================================================
// config.js — 연결 설정 + 도메인 코드 테이블
// relay-server/src/types.ts 및 contracts/contracts/GoldenLock.sol 과 값 체계를 동일하게 맞춘다.
// ============================================================================

const DEFAULTS = {
  relayUrl: "http://localhost:4000",
  rpcUrl: "http://127.0.0.1:8545",
  contractAddress: "", // 배포 후 contracts/ 배포 로그의 GoldenLock 주소를 입력
  aiEngineUrl: "http://localhost:8000", // ai-engine/main.py 기본 포트
};

const LS_KEY = "goldenlock:config";

export function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  localStorage.setItem(LS_KEY, JSON.stringify(merged));
  return merged;
}

// relay-server/src/types.ts::KtasGrade 와 동일 (1: 소생 ~ 5: 비응급)
export const KTAS_GRADES = [
  { value: 1, label: "소생" },
  { value: 2, label: "긴급" },
  { value: 3, label: "응급" },
  { value: 4, label: "준응급" },
  { value: 5, label: "비응급" },
];

// GoldenLock.sol::RequestStatus 와 동일 (0: None, 1: Locked, 2: Fulfilled, 3: Expired, 4: Cancelled)
export const REQUEST_STATUS_LABEL = {
  0: { text: "없음", cls: "muted" },
  1: { text: "락 진행중", cls: "pending" },
  2: { text: "수용 확정", cls: "confirmed" },
  3: { text: "만료됨", cls: "critical" },
  4: { text: "취소됨", cls: "muted" },
};

export const GOLDEN_TIME_SECONDS = 15 * 60; // GoldenLock.sol::GOLDEN_TIME_DURATION
