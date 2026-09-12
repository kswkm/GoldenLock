// ============================================================================
// auth.js — relay-server의 지갑 서명 인증(challenge/response)을 처리한다.
//
// hospitalAddress/ambulanceAddress를 자처하는 모든 소켓 이벤트는 서버가 이 인증을
// 요구한다(relay-server/src/sockets/matchSocket.ts::requireAuth). 인증은 이 소켓
// 연결(socket.id)에 귀속되므로, 재연결되면 다시 인증해야 한다.
// ============================================================================
import { emitAndWait } from "./socket.js";
import { connectWallet, getSignerAddress, signChallengeMessage } from "./contract.js";
import { log } from "./state.js";

let authenticatedAddress = null; // 현재 소켓 연결에서 인증된 주소 (소문자 비교용 원본 그대로 저장)

/** 소켓이 재연결되면 반드시 다시 인증해야 하므로, app.js가 재연결 시 이 함수를 호출한다. */
export function resetAuth() {
  authenticatedAddress = null;
}

function sameAddress(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * 지갑이 연결되어 있지 않으면 연결부터 하고, address로 아직 인증되지 않았다면
 * challenge/response를 수행한다. 이미 그 address로 인증되어 있으면 곧바로 반환한다.
 * @returns {Promise<string>} 인증된 주소
 */
export async function ensureWalletAuthenticated() {
  let address = await getSignerAddress();
  if (!address) {
    const connected = await connectWallet();
    address = connected.address;
  }

  if (sameAddress(authenticatedAddress, address)) {
    return address;
  }

  const challenge = await emitAndWait(
    "auth:request-challenge",
    { address },
    "auth:challenge",
    "auth:error",
    10000,
    (err) => err?.event === "auth:request-challenge"
  );

  const signature = await signChallengeMessage(challenge.message);

  await emitAndWait(
    "auth:verify",
    { address, signature },
    "auth:verified",
    "auth:error",
    10000,
    (err) => err?.event === "auth:verify"
  );

  authenticatedAddress = address;
  log("chain", `지갑 서명 인증 완료 → ${address}`);
  return address;
}

/** 특정 주소로 이미 인증되어 있는지 (재확인 없이) 동기적으로 조회. */
export function isAuthenticatedAs(address) {
  return sameAddress(authenticatedAddress, address);
}
