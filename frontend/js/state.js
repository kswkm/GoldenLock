// ============================================================================
// state.js — 아주 작은 pub/sub 스토어. 프레임워크 없이 뷰 간 상태를 공유한다.
// ============================================================================

const listeners = new Set();

export const store = {
  wallet: { connected: false, address: null },
  relay: { connected: false, relayerAddress: null },
  chain: { connected: false, contractAddress: null, network: null },
  hospitals: [], // relay-server GET /hospitals 결과 캐시
  matches: new Map(), // matchId -> MatchRecord (소켓 이벤트로 채워짐)
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(store);
}

// ── 이벤트 로그 트레이 ──────────────────────────────────────────────────────
const logBody = () => document.getElementById("logBody");
const logCount = () => document.getElementById("logCount");
let count = 0;

/**
 * @param {"chain"|"relay"|"zk"|"error"} src
 */
export function log(src, msg) {
  count += 1;
  const el = logBody();
  const counter = logCount();
  if (counter) counter.textContent = String(count);
  if (!el) return;

  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  const line = document.createElement("div");
  line.className = `log-line src-${src}`;
  line.innerHTML =
    `<span class="t">${time}</span>` +
    `<span class="src">${src}</span>` +
    `<span class="msg"></span>`;
  line.querySelector(".msg").textContent = typeof msg === "string" ? msg : JSON.stringify(msg);
  el.prepend(line);

  while (el.childElementCount > 300) el.removeChild(el.lastChild);
}

document.addEventListener("DOMContentLoaded", () => {
  const clearBtn = document.getElementById("logClearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const el = logBody();
      if (el) el.innerHTML = "";
      count = 0;
      const counter = logCount();
      if (counter) counter.textContent = "0";
    });
  }
});
