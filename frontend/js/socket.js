// ============================================================================
// socket.js — relay-server/src/sockets/matchSocket.ts 의 이벤트 계약을
// 그대로 따르는 얇은 래퍼.
// ============================================================================
import { io } from "https://esm.sh/socket.io-client@4.7.5";

let socket = null;

export function connectSocket(url, { onConnect, onDisconnect, onError } = {}) {
  if (socket) socket.disconnect();

  socket = io(url, {
    transports: ["websocket", "polling"],
    extraHeaders: { "ngrok-skip-browser-warning": "true" },
  });

  socket.on("connect", () => onConnect && onConnect());
  socket.on("disconnect", () => onDisconnect && onDisconnect());
  socket.on("connect_error", (err) => onError && onError(err));

  return socket;
}

export function getSocket() {
  return socket;
}

export function emit(event, payload) {
  if (!socket || !socket.connected) throw new Error("relay-server에 연결되어 있지 않습니다.");
  socket.emit(event, payload);
}

export function on(event, cb) {
  if (!socket) throw new Error("소켓이 아직 초기화되지 않았습니다.");
  socket.on(event, cb);
  return () => socket.off(event, cb);
}

export function once(event, cb) {
  if (!socket) throw new Error("소켓이 아직 초기화되지 않았습니다.");
  socket.once(event, cb);
  return () => socket.off(event, cb);
}

/**
 * "요청 emit → 응답 이벤트 1회 대기" 패턴을 Promise로 감싼다.
 * auth:request-challenge/auth:challenge, auth:verify/auth:verified 같은
 * request-response 쌍에 사용한다. successEvent/errorEvent 중 먼저 온 쪽으로 resolve/reject된다.
 */
export function emitAndWait(requestEvent, payload, successEvent, errorEvent, timeoutMs = 10000, matchError = () => true) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offSuccess();
      offError();
      fn(value);
    };

    const offSuccess = once(successEvent, (data) => finish(resolve, data));
    const offError = on(errorEvent, (err) => {
      if (!matchError(err)) return; // 이 요청과 무관한 에러는 무시하고 계속 기다린다
      finish(reject, new Error(err?.reason || `${errorEvent} 이벤트 수신`));
    });

    timer = setTimeout(() => finish(reject, new Error(`${requestEvent} 응답 시간 초과`)), timeoutMs);

    try {
      emit(requestEvent, payload);
    } catch (err) {
      finish(reject, err);
    }
  });
}

// matchSocket.ts 가 server -> client로 emit하는 모든 이벤트명
export const SERVER_EVENTS = [
  "auth:challenge",
  "auth:verified",
  "auth:error",
  "validation:error",
  "hospital:availability-changed",
  "match:found",
  "match:authorized",
  "match:lock-requested",
  "match:lock-onchain",
  "match:lock-confirmed",
  "match:released",
  "match:failed",
  "match:lock-expired-onchain",
];
