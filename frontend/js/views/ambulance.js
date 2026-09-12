// ============================================================================
// views/ambulance.js — 구급대 콘솔
// ============================================================================
import { on, emit, getSocket } from "../socket.js";
import { readRequest, signRequestLock, signCancelRequest } from "../contract.js";
import { computeRequestHash } from "../zk.js";
import { ensureWalletAuthenticated } from "../auth.js";
import { KTAS_GRADES, GOLDEN_TIME_SECONDS, loadConfig } from "../config.js";
import { log } from "../state.js";

let cleanupFns = [];
let current = null; // { matchId, hospitalAddress, hospitalId, requestId, txHash, lockDeadline, status }
let tickHandle = null;

export function mount(root) {
  root.innerHTML = template();
  bindStaticControls(root);
  attachSocketListeners(root);
  renderMatchPanel(root);
}

export function unmount() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  if (tickHandle) clearInterval(tickHandle);
  current = null;
}

function template() {
  return `
  <div class="grid-2">
    <section class="panel">
      <h2>매칭 요청</h2>
      <p class="panel-sub">AI(KTAS)가 산출한 필요 병상/전문의 수로 relay-server에 매칭을 요청합니다. 지갑 서명 인증이 먼저 필요합니다.</p>

      <div class="row2">
        <div class="field">
          <label>ambulanceId</label>
          <input type="text" id="ambulanceId" value="ambulance-1" />
        </div>
        <div class="field">
          <label>ambulanceAddress <span class="faint">(연결된 지갑 주소와 일치해야 함)</span></label>
          <input type="text" id="ambulanceAddress" value="0x70997970C51812dc3A010C7d01b50e0d17dc79C8" />
        </div>
      </div>

      <div class="field">
        <label>AI 자동 산출 <span class="faint">(ai-engine /predict-ktas 실시간 호출 — 미탑재 시 규칙 기반 폴백)</span></label>
        <div class="row2">
          <input type="number" id="aiAge" placeholder="나이" value="45" min="0" max="120" />
          <select id="aiSex">
            <option value="M">남</option>
            <option value="F">여</option>
          </select>
        </div>
        <div class="row2" style="margin-top:8px;">
          <input type="number" id="aiHr" placeholder="심박수(HR)" value="88" />
          <input type="number" id="aiSpo2" placeholder="SpO2(%)" value="97" />
        </div>
        <input type="text" id="aiSymptom" placeholder="주호소 (예: 흉통, 호흡곤란)" value="가슴 통증 호소" style="margin-top:8px; width:100%;" />
        <button class="ghost-btn" id="aiPredictBtn" type="button" style="margin-top:8px;">AI로 KTAS/필요자원 자동 산출</button>
        <div id="aiResultBox" class="proof-box" style="margin-top:8px; display:none;"></div>
      </div>

      <div class="field">
        <label>KTAS 등급</label>
        <div class="segmented" id="ktasSeg">
          ${KTAS_GRADES.map((k, i) => `<button data-ktas="${k.value}" class="${i === 2 ? "active" : ""}">${k.value} · ${k.label}</button>`).join("")}
        </div>
      </div>

      <div class="row2">
        <div class="field">
          <label>requiredBeds <span class="faint">(ai-engine resource_mapper.py 산출값)</span></label>
          <input type="number" id="requiredBeds" value="2" min="0" />
        </div>
        <div class="field">
          <label>requiredSpecialists</label>
          <input type="number" id="requiredSpecialists" value="1" min="0" />
        </div>
      </div>

      <div class="field">
        <label>patientCaseId <span class="faint">(PII 아님 — 온체인엔 keccak256 기반 requestHash로만 커밋됨)</span></label>
        <input type="text" id="patientCaseId" value="case-001" />
      </div>

      <div class="row2">
        <div class="field">
          <label>lat</label>
          <input type="text" id="lat" value="37.5700" />
        </div>
        <div class="field">
          <label>lng</label>
          <input type="text" id="lng" value="126.9820" />
        </div>
      </div>
      <button class="ghost-btn" id="geoBtn" type="button">내 위치 사용</button>

      <div style="margin-top:16px;">
        <button class="primary" id="requestBtn" type="button">지갑 인증 후 매칭 요청</button>
      </div>
    </section>

    <section class="panel">
      <h2>락 상태</h2>
      <p class="panel-sub">골든타임(15분) 내 병원의 수용 확정이 필요합니다. 매칭이 잡히면 지갑 서명 팝업이 한 번 더 뜹니다 (가스비 없음 — requestAndLock을 relayer가 대신 제출하도록 사전 승인하는 서명입니다).</p>
      <div id="matchPanel"></div>
    </section>
  </div>`;
}

function bindStaticControls(root) {
  root.querySelectorAll("#ktasSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("#ktasSeg button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  root.querySelector("#geoBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return log("error", "이 브라우저는 위치 정보를 지원하지 않습니다.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        root.querySelector("#lat").value = pos.coords.latitude.toFixed(6);
        root.querySelector("#lng").value = pos.coords.longitude.toFixed(6);
      },
      (err) => log("error", `위치 조회 실패: ${err.message}`)
    );
  });

  root.querySelector("#requestBtn").addEventListener("click", () => requestMatch(root));
  root.querySelector("#aiPredictBtn").addEventListener("click", () => runAiPredict(root));
}

/**
 * ai-engine/api/routes.py::/predict-ktas 호출.
 * ecg/spo2/hr는 시계열 스키마(services/dataset.py::CSVKTASDataset)를 맞추기 위해
 * 단일 값을 500 길이로 반복한다 (scripts/convert_triagegeist.py의 repeat_series와 동일 방식).
 * 실제 ECG 파형이 없으므로 ecg는 0으로 채운다.
 */
async function runAiPredict(root) {
  const btn = root.querySelector("#aiPredictBtn");
  const resultBox = root.querySelector("#aiResultBox");
  const { aiEngineUrl } = loadConfig();

  const repeat = (v, len = 500) => Array(len).fill(v);
  const payload = {
    vitals: {
      ecg: repeat(0),
      spo2: repeat(Number(root.querySelector("#aiSpo2").value) || 97),
      hr: repeat(Number(root.querySelector("#aiHr").value) || 80),
    },
    symptom_text: root.querySelector("#aiSymptom").value.trim(),
    meta: {
      age: Number(root.querySelector("#aiAge").value) || 40,
      sex: root.querySelector("#aiSex").value,
      history: [],
    },
  };

  btn.disabled = true;
  resultBox.style.display = "block";
  resultBox.textContent = "ai-engine 호출 중...";

  try {
    const res = await fetch(`${aiEngineUrl}/predict-ktas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();

    // KTAS 세그먼트 버튼 반영
    root.querySelectorAll("#ktasSeg button").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.ktas) === result.ktas_grade);
    });
    root.querySelector("#requiredBeds").value = result.required_beds;
    root.querySelector("#requiredSpecialists").value = result.required_specialists;

    const sourceLabel = result.source === "ai_model" ? "AI 모델" : "규칙 기반 폴백";
    resultBox.textContent = JSON.stringify(result, null, 2);
    log(
      result.source === "ai_model" ? "chain" : "error",
      `AI 산출 결과: KTAS ${result.ktas_grade} (${sourceLabel}, confidence=${result.confidence})${result.warning ? " — " + result.warning : ""}`
    );
  } catch (err) {
    resultBox.textContent = `호출 실패: ${err.message}`;
    log("error", `ai-engine 호출 실패: ${err.message} (ai-engine이 켜져 있는지, 설정의 AI Engine URL을 확인하세요)`);
  } finally {
    btn.disabled = false;
  }
}

async function requestMatch(root) {
  const ktasBtn = root.querySelector("#ktasSeg button.active");
  const ambulanceAddress = root.querySelector("#ambulanceAddress").value.trim();
  const payload = {
    ambulanceId: root.querySelector("#ambulanceId").value.trim(),
    ambulanceAddress,
    ktasGrade: Number(ktasBtn?.dataset.ktas || 3),
    requiredBeds: Number(root.querySelector("#requiredBeds").value),
    requiredSpecialists: Number(root.querySelector("#requiredSpecialists").value),
    patientCaseId: root.querySelector("#patientCaseId").value.trim(),
    location: {
      lat: Number(root.querySelector("#lat").value),
      lng: Number(root.querySelector("#lng").value),
    },
  };

  const btn = root.querySelector("#requestBtn");
  btn.disabled = true;
  try {
    const authed = await ensureWalletAuthenticated();
    if (authed.toLowerCase() !== ambulanceAddress.toLowerCase()) {
      log("error", `연결된 지갑(${authed})과 입력한 ambulanceAddress가 다릅니다. 지갑 계정을 맞추거나 주소를 수정하세요.`);
      return;
    }

    current = { status: "SEARCHING" };
    renderMatchPanel(root);
    emit("ambulance:request-match", payload);
    log("relay", `매칭 요청 전송 → KTAS=${payload.ktasGrade}, beds=${payload.requiredBeds}, specialists=${payload.requiredSpecialists}`);
  } catch (err) {
    log("error", `매칭 요청 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

function attachSocketListeners(root) {
  if (!getSocket()) return;

  const handlers = [
    ["match:found", (m) => onMatchFound(root, m)],
    ["match:authorized", ({ matchId }) => { if (current?.matchId === matchId) { current.status = "AUTHORIZED"; refresh(); } }],
    ["match:lock-requested", ({ matchId }) => { if (current?.matchId === matchId) { current.status = "LOCK_REQUESTED"; refresh(); } }],
    ["match:lock-onchain", async ({ matchId, requestId, txHash }) => {
      if (current?.matchId !== matchId) return;
      current.requestId = requestId;
      current.txHash = txHash;
      try {
        const req = await readRequest(requestId);
        current.lockDeadline = Number(req.lockDeadline) * 1000;
      } catch (err) {
        log("error", `온체인 요청 조회 실패: ${err.message}`);
      }
      startCountdown();
      refresh();
    }],
    ["match:lock-confirmed", ({ matchId }) => { if (current?.matchId === matchId) { current.status = "LOCK_CONFIRMED"; refresh(); } }],
    ["match:released", ({ matchId }) => { if (current?.matchId === matchId) { current.status = "RELEASED"; refresh(); } }],
    ["match:failed", (payload) => {
      if (payload?.matchId && current?.matchId && payload.matchId !== current.matchId) return;
      current = { status: "FAILED", reason: payload?.reason };
      refresh();
    }],
    ["match:lock-expired-onchain", ({ requestId }) => { if (current?.requestId === requestId) { current.status = "EXPIRED"; refresh(); } }],
  ];

  handlers.forEach(([evt, cb]) => cleanupFns.push(on(evt, cb)));
}

/**
 * 매칭이 잡히면 구급대가 즉시 RequestLock(hospital, ambulanceOperator, ktasLevel,
 * requestHash, nonce)에 대한 EIP-712 서명을 만들어 서버에 사전 승인으로 제출한다.
 * 이 서명이 있어야 나중에 병원이 ZK 증명을 제출했을 때 relayer가 requestAndLock을
 * 대납할 수 있다 (GoldenLock.sol이 서명 없는 대리 호출을 거부하기 때문).
 */
async function onMatchFound(root, match) {
  current = { ...current, ...match };
  refresh();

  try {
    // 병원과 동일한 방식으로 requestHash를 독립적으로 계산 — zk.js의 computeRequestHash와 동일 로직
    const requestHash = computeRequestHash({
      hospitalAddress: match.hospitalAddress,
      matchId: match.matchId,
      ambulanceAddress: match.ambulanceAddress,
      patientCaseId: match.patientCaseId,
    });

    const signature = await signRequestLock({
      hospital: match.hospitalAddress,
      ambulanceOperator: match.ambulanceAddress,
      ktasLevel: match.ktasGrade,
      requestHash,
    });

    emit("ambulance:authorize-lock", {
      matchId: match.matchId,
      ambulanceAddress: match.ambulanceAddress,
      signature,
    });
    log("chain", `RequestLock 사전 승인 서명 제출 → matchId=${match.matchId}`);
  } catch (err) {
    log("error", `사전 승인 서명 실패: ${err.message}`);
    if (current?.matchId === match.matchId) {
      current.status = "FAILED";
      current.reason = "authorize-signature-failed";
      refresh();
    }
  }
}

function startCountdown() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => refresh(), 1000);
}

function refresh() {
  const root = document.getElementById("viewRoot");
  if (root && root.querySelector("#matchPanel")) renderMatchPanel(root);
}

function renderMatchPanel(root) {
  const el = root.querySelector("#matchPanel");
  if (!el) return;

  if (!current) {
    el.innerHTML = `<p class="dim">아직 매칭 요청이 없습니다.</p>`;
    return;
  }

  if (current.status === "FAILED") {
    el.innerHTML = `<span class="badge critical">매칭 실패</span> <span class="dim">${current.reason || ""}</span>`;
    return;
  }

  const steps = ["SEARCHING", "MATCHED", "AUTHORIZED", "LOCK_REQUESTED", "LOCK_CONFIRMED"];
  const activeIdx = steps.indexOf(current.status === "RELEASED" || current.status === "EXPIRED" ? "LOCK_CONFIRMED" : current.status);

  let countdownHtml = "";
  if (current.lockDeadline) {
    const remain = Math.max(0, Math.floor((current.lockDeadline - Date.now()) / 1000));
    const mm = String(Math.floor(remain / 60)).padStart(2, "0");
    const ss = String(remain % 60).padStart(2, "0");
    const cls = remain < 60 ? "critical" : remain < GOLDEN_TIME_SECONDS / 3 ? "warn" : "";
    countdownHtml = `
      <div class="countdown">
        <span class="value ${cls}">${mm}:${ss}</span>
        <span class="meta">골든타임 남음 · requestId <b>#${current.requestId ?? "-"}</b></span>
      </div>`;
  }

  el.innerHTML = `
    <div class="stepper">
      ${steps.map((s, i) => `
        <div class="step ${i < activeIdx ? "done" : i === activeIdx ? "active" : ""}">
          <span class="bullet"></span><span class="label">${stepLabel(s)}</span>
        </div>
        ${i < steps.length - 1 ? '<span class="step-line"></span>' : ""}
      `).join("")}
    </div>
    ${countdownHtml}
    <table class="data" style="margin-top:14px;">
      <tr><th>matchId</th><td class="mono">${current.matchId || "-"}</td></tr>
      <tr><th>병원</th><td class="mono">${current.hospitalAddress || "-"}</td></tr>
      <tr><th>requestId</th><td class="mono">${current.requestId ?? "-"}</td></tr>
      <tr><th>tx</th><td class="mono">${current.txHash || "-"}</td></tr>
      <tr><th>상태</th><td>${current.status || "-"}</td></tr>
    </table>
    ${current.matchId ? `<button class="danger" style="margin-top:12px;" id="releaseBtn">이송 취소 / 락 해제</button>` : ""}
  `;

  const releaseBtn = el.querySelector("#releaseBtn");
  if (releaseBtn) {
    releaseBtn.addEventListener("click", () => releaseLock(root));
  }
}

async function releaseLock(root) {
  if (!current?.matchId) return;
  const releaseBtn = root.querySelector("#releaseBtn");
  if (releaseBtn) releaseBtn.disabled = true;

  try {
    await ensureWalletAuthenticated();
    let signature = "0x";
    if (current.requestId !== undefined) {
      signature = await signCancelRequest({
        requestId: current.requestId,
        ambulanceOperator: current.ambulanceAddress,
      });
    }
    emit("match:release", {
      matchId: current.matchId,
      ambulanceAddress: current.ambulanceAddress,
      signature,
    });
    log("relay", `락 해제 요청 → matchId=${current.matchId}`);
  } catch (err) {
    log("error", `락 해제 서명 실패: ${err.message}`);
  } finally {
    if (releaseBtn) releaseBtn.disabled = false;
  }
}

function stepLabel(s) {
  return { SEARCHING: "탐색중", MATCHED: "매칭됨", AUTHORIZED: "사전승인됨", LOCK_REQUESTED: "락 요청됨", LOCK_CONFIRMED: "수용 확정" }[s] || s;
}
