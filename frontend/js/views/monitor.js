// ============================================================================
// views/monitor.js — 관제 모니터 (읽기 전용)
// ============================================================================
import { readRequestCounter, readRequest, subscribeChainEvents } from "../contract.js";
import { REQUEST_STATUS_LABEL, loadConfig } from "../config.js";
import { log } from "../state.js";

let unsubscribeChain = null;
let pollHandle = null;

export function mount(root) {
  root.innerHTML = template();
  root.querySelector("#refreshBtn").addEventListener("click", () => refreshAll(root));
  refreshAll(root);

  try {
    unsubscribeChain = subscribeChainEvents((name, args) => {
      log("chain", `${name}(${args.map(String).join(", ")})`);
      refreshAll(root);
    });
  } catch (err) {
    log("error", `체인 이벤트 구독 실패: ${err.message}`);
  }

  pollHandle = setInterval(() => refreshAll(root), 8000);
}

export function unmount() {
  if (unsubscribeChain) unsubscribeChain();
  unsubscribeChain = null;
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

function template() {
  return `
  <div class="grid-2">
    <section class="panel">
      <h2>온체인 요청 현황</h2>
      <p class="panel-sub">GoldenLock.sol::requests 매핑을 requestCounter까지 순회해서 읽습니다.</p>
      <button class="ghost-btn" id="refreshBtn" type="button" style="margin-bottom:10px;">새로고침</button>
      <div id="requestTable"><p class="dim">불러오는 중...</p></div>
    </section>

    <section class="panel">
      <h2>병원 레지스트리 (오프체인 캐시)</h2>
      <p class="panel-sub">relay-server의 인메모리 매칭 서비스가 보고하는 최근 가용성 방송입니다.</p>
      <div id="hospitalTable"><p class="dim">불러오는 중...</p></div>
    </section>
  </div>`;
}

async function refreshAll(root) {
  await Promise.all([refreshRequests(root), refreshHospitals(root)]);
}

async function refreshRequests(root) {
  const el = root.querySelector("#requestTable");
  if (!el) return;
  try {
    const count = Number(await readRequestCounter());
    if (count < 1) {
      el.innerHTML = `<p class="dim">아직 생성된 요청이 없습니다.</p>`;
      return;
    }
    const rows = [];
    for (let id = 1; id <= count; id++) {
      const req = await readRequest(id);
      rows.push({ id, req });
    }
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>#</th><th>병원</th><th>구급대</th><th>KTAS</th><th>상태</th><th>골든타임 만료</th></tr></thead>
        <tbody>
          ${rows.map(({ id, req }) => {
            const status = REQUEST_STATUS_LABEL[Number(req.status)] || { text: "?", cls: "muted" };
            const deadline = new Date(Number(req.lockDeadline) * 1000).toLocaleTimeString("ko-KR", { hour12: false });
            return `<tr>
              <td>${id}</td>
              <td class="mono">${shorten(req.hospital)}</td>
              <td class="mono">${shorten(req.ambulanceOperator)}</td>
              <td>${req.ktasLevel}</td>
              <td><span class="badge ${status.cls}">${status.text}</span></td>
              <td class="mono">${deadline}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    el.innerHTML = `<p class="dim">조회 실패: ${err.message}</p>`;
  }
}

async function refreshHospitals(root) {
  const el = root.querySelector("#hospitalTable");
  if (!el) return;
  const { relayUrl } = loadConfig();
  try {
    const res = await fetch(`${relayUrl}/hospitals`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hospitals = await res.json();
    if (!hospitals.length) {
      el.innerHTML = `<p class="dim">등록된 병원이 없습니다.</p>`;
      return;
    }
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>병원</th><th>주소</th><th>위치</th><th>가용 여부</th></tr></thead>
        <tbody>
          ${hospitals.map((h) => `
            <tr>
              <td>${h.hospitalId}</td>
              <td class="mono">${shorten(h.hospitalAddress)}</td>
              <td class="mono">${h.location.lat.toFixed(3)}, ${h.location.lng.toFixed(3)}</td>
              <td>${h.hasCapacity ? `<span class="badge available">가능</span>` : `<span class="dim">불가</span>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    el.innerHTML = `<p class="dim">relay-server 조회 실패: ${err.message}</p>`;
  }
}

function shorten(addr) {
  if (!addr || addr.length < 10) return addr || "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
