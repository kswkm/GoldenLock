// ============================================================================
// app.js — 부트스트랩: 탭 라우팅 + 연결(지갑/릴레이/체인) 관리
// ============================================================================
import { loadConfig, saveConfig } from "./config.js";
import { connectSocket, on } from "./socket.js";
import { connectWallet, initReadProvider, readRequestCounter } from "./contract.js";
import { resetAuth } from "./auth.js";
import { log } from "./state.js";

import * as ambulanceView from "./views/ambulance.js";
import * as hospitalView from "./views/hospital.js";
import * as monitorView from "./views/monitor.js";

const VIEWS = { ambulance: ambulanceView, hospital: hospitalView, monitor: monitorView };
let activeView = null;
let activeName = null;

function switchView(name) {
  const root = document.getElementById("viewRoot");
  if (activeView && activeView.unmount) activeView.unmount();
  activeName = name;
  activeView = VIEWS[name];
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  activeView.mount(root);
}

function setLed(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("on", !!on);
}

async function connectRelay(cfg) {
  connectSocket(cfg.relayUrl, {
    onConnect: () => {
      resetAuth();
      setLed("relayLed", true);
      log("relay", `연결됨 → ${cfg.relayUrl}`);
    },
    onDisconnect: () => {
      resetAuth();
      setLed("relayLed", false);
      log("relay", "연결 끊김");
    },
    onError: (err) => {
      setLed("relayLed", false);
      log("error", `relay 연결 오류: ${err.message}`);
    },
  });

  on("auth:error", (err) => log("error", `인증 오류 (${err.event || "auth"}): ${err.reason}`));
  on("validation:error", (err) => log("error", `요청 형식 오류 (${err.event}): 입력값을 확인하세요.`));

  // 헬스체크로 relayer 주소도 같이 확인
  try {
    const res = await fetch(`${cfg.relayUrl}/health`);
    if (res.ok) {
      const data = await res.json();
      log("relay", `relayer 주소: ${data.relayer}`);
    }
  } catch {
    // 소켓 연결 결과로 이미 로그가 남으므로 조용히 무시
  }
}

async function connectChain(cfg) {
  try {
    initReadProvider(cfg.rpcUrl, cfg.contractAddress);
    if (cfg.contractAddress) {
      await readRequestCounter(); // 연결/주소 유효성 프로브
      setLed("chainLed", true);
      log("chain", `RPC 연결됨 → ${cfg.rpcUrl}`);
    } else {
      setLed("chainLed", false);
      log("error", "GoldenLock 컨트랙트 주소가 비어 있습니다. 상단 '설정'에서 입력하세요.");
    }
  } catch (err) {
    setLed("chainLed", false);
    log("error", `RPC/컨트랙트 연결 실패: ${err.message}`);
  }
}

function wireSettingsPanel() {
  const panel = document.getElementById("settingsPanel");
  document.getElementById("settingsBtn").addEventListener("click", () => panel.classList.toggle("hidden"));

  const cfg = loadConfig();
  document.getElementById("cfgRelayUrl").value = cfg.relayUrl;
  document.getElementById("cfgRpcUrl").value = cfg.rpcUrl;
  document.getElementById("cfgContractAddr").value = cfg.contractAddress;
  document.getElementById("cfgAiEngineUrl").value = cfg.aiEngineUrl;

  document.getElementById("cfgSaveBtn").addEventListener("click", async () => {
    const next = saveConfig({
      relayUrl: document.getElementById("cfgRelayUrl").value.trim() || loadConfig().relayUrl,
      rpcUrl: document.getElementById("cfgRpcUrl").value.trim() || loadConfig().rpcUrl,
      contractAddress: document.getElementById("cfgContractAddr").value.trim(),
      aiEngineUrl: document.getElementById("cfgAiEngineUrl").value.trim() || loadConfig().aiEngineUrl,
    });
    panel.classList.add("hidden");
    await connectRelay(next);
    await connectChain(next);
  });
}

function wireWalletButton() {
  document.getElementById("walletBtn").addEventListener("click", async () => {
    try {
      const { address } = await connectWallet();
      const btn = document.getElementById("walletBtn");
      btn.textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
      btn.classList.add("connected");
      log("chain", `지갑 연결됨 → ${address}`);
    } catch (err) {
      log("error", `지갑 연결 실패: ${err.message}`);
    }
  });
}

function wireModeSelect() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

async function boot() {
  wireSettingsPanel();
  wireWalletButton();
  wireModeSelect();

  const cfg = loadConfig();
  await connectRelay(cfg);
  await connectChain(cfg);

  switchView("ambulance");
}

boot();
