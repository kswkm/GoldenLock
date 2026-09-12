// ============================================================================
// views/hospital.js — 병원 콘솔
//
// availableBeds / availableSpecialists / hospitalSecret 은 이 모듈의 클로저
// 변수에만 존재하며, socket이나 fetch로 어디에도 전송되지 않는다. 네트워크로
// 나가는 것은 SnarkJS가 만든 proof(a,b,c)와 publicSignals뿐이다.
//
// join/broadcast/증명 제출/수용 확정 모두 지갑 서명 인증(auth.js)이 선행되어야
// relay-server가 처리한다 — 아무나 matchId만 알고 병원 행세를 할 수 없다.
// ============================================================================
import { on, emit, getSocket } from "../socket.js";
import { computeRequestHash, generateAvailabilityProof, toContractCallArgs } from "../zk.js";
import { signFulfillRequest } from "../contract.js";
import { ensureWalletAuthenticated } from "../auth.js";
import { log } from "../state.js";

let cleanupFns = [];
let pendingMatch = null; // 소켓으로부터 받은 MatchRecord (matchId, ambulanceAddress, patientCaseId, requiredBeds, requiredSpecialists ...)
let lastProof = null;
let ambulanceAuthorized = false;

export function mount(root) {
  root.innerHTML = template();
  bindControls(root);
  attachSocketListeners(root);
  renderMatchSection(root);
}

export function unmount() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  pendingMatch = null;
  lastProof = null;
  ambulanceAuthorized = false;
}

function template() {
  return `
  <div class="grid-2">
    <section class="panel">
      <h2>병원 등록 / 가용성 방송</h2>
      <p class="panel-sub">오프체인 매칭 라우팅용 방송입니다. join/방송 모두 지갑 서명 인증이 필요하며, 온체인에 registerHospital로 등록된 주소여야 합니다.</p>

      <div class="row2">
        <div class="field">
          <label>hospitalId</label>
          <input type="text" id="hospitalId" value="hospital-1" />
        </div>
        <div class="field">
          <label>hospitalAddress <span class="faint">(연결된 지갑 주소와 일치해야 함)</span></label>
          <input type="text" id="hospitalAddress" value="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226" />
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>lat</label>
          <input type="text" id="hLat" value="37.5665" />
        </div>
        <div class="field">
          <label>lng</label>
          <input type="text" id="hLng" value="126.9780" />
        </div>
      </div>
      <div class="field checkbox-field">
        <label><input type="checkbox" id="hasCapacity" checked /> 지금 받을 수 있음 (hasCapacity)</label>
        <div class="field-hint">오프체인 라우팅 참고용일 뿐, 실제 슬롯 확약 여부는 온체인 totalSlots/lockedSlots가 결정합니다.</div>
      </div>
      <div class="actions" style="display:flex; gap:8px; margin-bottom:6px;">
        <button class="ghost-btn" id="joinBtn" type="button">지갑 인증 후 관제 룸 참가</button>
        <button class="ghost-btn" id="broadcastBtn" type="button">가용성 방송</button>
      </div>

      <hr style="border:none; border-top:1px dashed var(--line); margin:18px 0;" />

      <h2>비공개 자원 현황 <span class="badge available">브라우저 안에만 존재</span></h2>
      <p class="panel-sub">아래 세 값은 hospital_resource.circom의 private input이며 서버로 전송되지 않습니다.</p>
      <div class="row3">
        <div class="field">
          <label>availableBeds</label>
          <input type="number" id="availableBeds" value="8" />
        </div>
        <div class="field">
          <label>availableSpecialists</label>
          <input type="number" id="availableSpecialists" value="3" />
        </div>
        <div class="field">
          <label>hospitalSecret</label>
          <input type="text" id="hospitalSecret" value="123456789" />
          <div class="field-hint">0이면 증명이 만들어지지 않음(회로가 강제). 병원만 보관.</div>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>매칭 &amp; ZK 증명</h2>
      <p class="panel-sub">구급대 매칭이 오면 requestHash로 (병원·matchId·구급차·환자케이스)를 커밋한 뒤 증명을 생성합니다.</p>
      <div id="matchSection"></div>
    </section>
  </div>`;
}

function bindControls(root) {
  root.querySelector("#joinBtn").addEventListener("click", async () => {
    const btn = root.querySelector("#joinBtn");
    const hospitalId = root.querySelector("#hospitalId").value.trim();
    const hospitalAddress = root.querySelector("#hospitalAddress").value.trim();
    btn.disabled = true;
    try {
      const authed = await ensureWalletAuthenticated();
      if (authed.toLowerCase() !== hospitalAddress.toLowerCase()) {
        log("error", `연결된 지갑(${authed})과 입력한 hospitalAddress가 다릅니다. 지갑 계정을 맞추거나 주소를 수정하세요.`);
        return;
      }
      emit("hospital:join", { hospitalId, hospitalAddress });
      log("relay", `hospital:join → ${hospitalId}`);
    } catch (err) {
      log("error", `인증 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector("#broadcastBtn").addEventListener("click", async () => {
    const btn = root.querySelector("#broadcastBtn");
    const hospitalAddress = root.querySelector("#hospitalAddress").value.trim();
    btn.disabled = true;
    try {
      await ensureWalletAuthenticated();
      const payload = {
        hospitalId: root.querySelector("#hospitalId").value.trim(),
        hospitalAddress,
        hasCapacity: root.querySelector("#hasCapacity").checked,
        location: {
          lat: Number(root.querySelector("#hLat").value),
          lng: Number(root.querySelector("#hLng").value),
        },
      };
      emit("hospital:update-availability", payload);
      log("relay", `가용성 방송 → hasCapacity=${payload.hasCapacity}`);
    } catch (err) {
      log("error", `인증 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

function attachSocketListeners(root) {
  if (!getSocket()) return;
  cleanupFns.push(
    on("match:found", (match) => {
      // 자기 병원으로 온 매칭만 반영 (hospitalId 기준)
      const myId = root.querySelector("#hospitalId").value.trim();
      if (match.hospitalId !== myId) return;
      pendingMatch = match;
      lastProof = null;
      ambulanceAuthorized = false;
      renderMatchSection(root);
      log("relay", `매칭 수신 → matchId=${match.matchId}`);
    })
  );
  cleanupFns.push(
    on("match:authorized", ({ matchId }) => {
      if (pendingMatch?.matchId !== matchId) return;
      ambulanceAuthorized = true;
      renderMatchSection(root);
      log("relay", `구급대 사전 승인 수신 → matchId=${matchId}`);
    })
  );
  cleanupFns.push(
    on("match:lock-onchain", ({ matchId, requestId, txHash }) => {
      if (pendingMatch?.matchId !== matchId) return;
      pendingMatch.requestId = requestId;
      pendingMatch.txHash = txHash;
      renderMatchSection(root);
      log("relay", `온체인 락 완료 → requestId=${requestId}`);
    })
  );
  cleanupFns.push(
    on("match:failed", ({ matchId, reason }) => {
      if (pendingMatch?.matchId && matchId && pendingMatch.matchId !== matchId) return;
      log("error", `매칭/증명 제출 실패: ${reason || "알 수 없음"}`);
    })
  );
}

function renderMatchSection(root) {
  const el = root.querySelector("#matchSection");
  if (!el) return;

  if (!pendingMatch) {
    el.innerHTML = `<p class="dim">대기 중 — 구급대 매칭을 기다리고 있습니다.</p>`;
    return;
  }

  const m = pendingMatch;
  el.innerHTML = `
    <table class="data">
      <tr><th>matchId</th><td class="mono">${m.matchId}</td></tr>
      <tr><th>구급차</th><td class="mono">${m.ambulanceAddress}</td></tr>
      <tr><th>환자케이스</th><td class="mono">${m.patientCaseId}</td></tr>
      <tr><th>KTAS</th><td>${m.ktasGrade}</td></tr>
      <tr><th>구급대 사전 승인</th><td>${ambulanceAuthorized ? '<span class="badge available">완료</span>' : '<span class="badge pending">대기중</span>'}</td></tr>
      <tr><th>requestId</th><td class="mono">${m.requestId ?? "대기중"}</td></tr>
    </table>

    <div class="row2" style="margin-top:14px;">
      <div class="field">
        <label>requiredBeds <span class="faint">(구급대 요청값, 필요 시 조정)</span></label>
        <input type="number" id="requiredBeds" value="${m.requiredBeds ?? 2}" />
      </div>
      <div class="field">
        <label>requiredSpecialists</label>
        <input type="number" id="requiredSpecialists" value="${m.requiredSpecialists ?? 1}" />
      </div>
    </div>

    <div class="field">
      <label>requestHash (자동 계산 — 병원주소·matchId·구급차주소·환자케이스 커밋)</label>
      <div class="proof-box" id="requestHashBox">아직 계산되지 않음</div>
    </div>

    <div class="zk-progress" id="zkProgress"></div>

    <div style="display:flex; gap:8px; margin-top:12px;">
      <button class="primary" id="genProofBtn" type="button">ZK 증명 생성</button>
      <button class="ghost-btn" id="submitProofBtn" type="button" disabled>온체인 제출 (Relayer)</button>
      <button class="ghost-btn" id="confirmBtn" type="button" ${m.requestId === undefined ? "disabled" : ""}>지갑 서명 후 환자 수용 확정</button>
    </div>
    ${!ambulanceAuthorized ? '<p class="dim" style="margin-top:8px;">구급대 사전 승인이 아직 도착하지 않았습니다 — 증명 생성은 가능하지만, 온체인 제출은 승인 도착 후에 가능합니다.</p>' : ""}

    <div class="field" style="margin-top:12px;">
      <label>생성된 proof / publicSignals</label>
      <div class="proof-box" id="proofBox">-</div>
    </div>
  `;

  el.querySelector("#genProofBtn").addEventListener("click", () => runProofGeneration(root));
  el.querySelector("#submitProofBtn").addEventListener("click", () => submitProof(root));
  el.querySelector("#confirmBtn").addEventListener("click", () => confirmAcceptance(root));
}

async function runProofGeneration(root) {
  const m = pendingMatch;
  // 폼 필드가 아니라 매치 레코드의 병원 주소를 써야 한다 — 이게 구급대가
  // ambulance:authorize-lock 시 서명한 바로 그 주소다. 폼 필드를 쓰면, 병원이
  // 방송 이후 이 입력란을 실수로 바꿨을 때 requestHash가 서명값과 어긋나
  // 온체인에서 "GoldenLock: invalid signature"로 조용히 실패한다.
  const hospitalAddress = m.hospitalAddress;
  const requiredBeds = Number(root.querySelector("#requiredBeds").value);
  const requiredSpecialists = Number(root.querySelector("#requiredSpecialists").value);

  const requestHash = computeRequestHash({
    hospitalAddress,
    matchId: m.matchId,
    ambulanceAddress: m.ambulanceAddress,
    patientCaseId: m.patientCaseId,
  });
  root.querySelector("#requestHashBox").textContent = requestHash;

  const currentFieldValue = root.querySelector("#hospitalAddress").value.trim();
  if (currentFieldValue && currentFieldValue.toLowerCase() !== hospitalAddress.toLowerCase()) {
    log(
      "error",
      `입력란의 hospitalAddress(${currentFieldValue})가 이 매치의 병원 주소(${hospitalAddress})와 다릅니다. ` +
        `이 매치는 매치 레코드의 주소로 증명을 생성합니다 — 다른 병원 계정으로 전환하려면 새로 join/방송하세요.`
    );
  }

  const input = {
    availableBeds: Number(root.querySelector("#availableBeds").value),
    availableSpecialists: Number(root.querySelector("#availableSpecialists").value),
    hospitalSecret: root.querySelector("#hospitalSecret").value.trim(),
    requiredBeds,
    requiredSpecialists,
    requestHash,
  };

  const progressEl = root.querySelector("#zkProgress");
  progressEl.innerHTML = stageHtml("witness", "회로 실행 + 증명 생성 중 (브라우저, SnarkJS)");

  try {
    const { proof, publicSignals } = await generateAvailabilityProof(input, () => {});
    lastProof = { proof, publicSignals, hospitalAddress, requestHash };

    progressEl.innerHTML = stageHtml("done", "증명 생성 완료");
    root.querySelector("#proofBox").textContent = JSON.stringify({ proof, publicSignals }, null, 2);
    root.querySelector("#submitProofBtn").disabled = false;
    log("zk", `증명 생성 완료 → canAccept=${publicSignals[0]}`);
  } catch (err) {
    progressEl.innerHTML = stageHtml("error", `증명 생성 실패: ${err.message}`);
    log("error", `ZK 증명 생성 실패: ${err.message} (circuits/ 아래 wasm·zkey 배치 확인)`);
  }
}

function stageHtml(state, text) {
  const cls = state === "done" ? "done" : state === "error" ? "" : "active";
  return `<div class="zk-stage ${cls}"><span class="mark"></span>${text}</div>`;
}

async function submitProof(root) {
  if (!lastProof || !pendingMatch) return;
  const { proof, publicSignals, hospitalAddress, requestHash } = lastProof;
  const { a, b, c } = toContractCallArgs(proof);
  const submitBtn = root.querySelector("#submitProofBtn");

  submitBtn.disabled = true;
  try {
    const authed = await ensureWalletAuthenticated();
    if (authed.toLowerCase() !== hospitalAddress.toLowerCase()) {
      log("error", `연결된 지갑(${authed})이 이 매치의 병원 주소(${hospitalAddress})와 다릅니다.`);
      return;
    }
    emit("hospital:submit-request-proof", {
      matchId: pendingMatch.matchId,
      hospitalAddress,
      requestHash,
      proof: { a, b, c },
      publicSignals,
    });
    log("relay", `hospital:submit-request-proof → matchId=${pendingMatch.matchId}, canAccept=${publicSignals[0]}`);
  } catch (err) {
    log("error", `인증 실패: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
  }
}

async function confirmAcceptance(root) {
  if (!pendingMatch?.matchId || pendingMatch.requestId === undefined) return;
  // 폼 필드가 아니라 매치 레코드의 병원 주소를 쓴다 — 온체인 req.hospital과 반드시
  // 일치해야 서명이 검증되므로, 사용자가 그 사이 입력란을 바꿨더라도 영향받지 않는다.
  const hospitalAddress = pendingMatch.hospitalAddress;
  const confirmBtn = root.querySelector("#confirmBtn");

  confirmBtn.disabled = true;
  try {
    const authed = await ensureWalletAuthenticated();
    if (authed.toLowerCase() !== hospitalAddress.toLowerCase()) {
      log("error", `연결된 지갑(${authed})이 이 매치의 병원 주소(${hospitalAddress})와 다릅니다.`);
      return;
    }
    const signature = await signFulfillRequest({ requestId: pendingMatch.requestId, hospitalAddress });
    emit("hospital:confirm-acceptance", { matchId: pendingMatch.matchId, hospitalAddress, signature });
    log("relay", `hospital:confirm-acceptance → matchId=${pendingMatch.matchId}`);
  } catch (err) {
    log("error", `수용 확정 서명 실패: ${err.message}`);
  } finally {
    confirmBtn.disabled = false;
  }
}
