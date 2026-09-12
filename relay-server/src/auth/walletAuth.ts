import { verifyMessage } from "ethers";
import { randomBytes } from "crypto";

/**
 * WalletAuth
 * ----------
 * "지갑 서명으로 소켓 신원을 증명"하는 아주 작은 challenge/response 인증기.
 *
 * 왜 JWT/세션 로그인 대신 지갑 서명인가: 이 앱의 모든 행위자(구급대/병원)는 이미
 * 이더리움 주소로 식별되고, 그 주소의 개인키를 실제로 갖고 있다는 사실이 곧
 * "내가 이 병원/구급대다"라는 증명이다. 별도의 아이디/비밀번호나 세션 서버 없이,
 * 이미 갖고 있는 지갑으로 메시지 하나만 서명하면 된다 (가스비 없음, 트랜잭션 아님).
 *
 * 흐름:
 *   1) 클라이언트가 "auth:request-challenge" {address}를 보낸다.
 *   2) 서버가 nonce가 포함된 메시지를 만들어 "auth:challenge"로 돌려준다.
 *   3) 클라이언트가 지갑으로 그 메시지를 서명해 "auth:verify" {address, signature}를 보낸다.
 *   4) 서명이 address와 일치하면 이 소켓은 그 address로 인증된 것으로 기록된다.
 *
 * 세션은 소켓 연결(socket.id)에 귀속되며, 연결이 끊기면 즉시 무효화된다.
 * (프로덕션이라면 challenge/session을 Redis 등에 저장해 다중 인스턴스 간에도
 * 공유해야 한다. 데모 스코프에서는 인메모리로 충분하다.)
 */

const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 서명은 발급 후 2분 내에 제출해야 함
const SESSION_TTL_MS = 30 * 60 * 1000; // 인증 후 30분 지나면 재인증 필요

interface ChallengeRecord {
  address: string;
  nonce: string;
  issuedAt: number;
}

interface AuthenticatedSession {
  address: string;
  authenticatedAt: number;
}

export function buildChallengeMessage(address: string, nonce: string, issuedAt: number): string {
  return [
    "GoldenLock 접속 인증 서명 요청",
    `주소: ${address}`,
    `nonce: ${nonce}`,
    `발급시각(ms): ${issuedAt}`,
    "이 서명은 신원 확인용이며 어떤 트랜잭션도 발생시키지 않고 가스비가 들지 않습니다.",
  ].join("\n");
}

export class WalletAuth {
  private challenges = new Map<string, ChallengeRecord>(); // key: socketId
  private sessions = new Map<string, AuthenticatedSession>(); // key: socketId

  issueChallenge(socketId: string, address: string): { message: string; nonce: string; expiresAt: number } {
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = Date.now();
    this.challenges.set(socketId, { address: address.toLowerCase(), nonce, issuedAt });
    return { message: buildChallengeMessage(address, nonce, issuedAt), nonce, expiresAt: issuedAt + CHALLENGE_TTL_MS };
  }

  /** 서명을 검증하고 성공 시 이 소켓을 해당 address로 인증 처리한다. */
  verify(socketId: string, address: string, signature: string): boolean {
    const record = this.challenges.get(socketId);
    if (!record) return false;
    if (record.address !== address.toLowerCase()) return false;
    if (Date.now() - record.issuedAt > CHALLENGE_TTL_MS) {
      this.challenges.delete(socketId);
      return false;
    }

    const message = buildChallengeMessage(address, record.nonce, record.issuedAt);
    let recovered: string;
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      return false;
    }
    if (recovered.toLowerCase() !== address.toLowerCase()) return false;

    this.challenges.delete(socketId);
    this.sessions.set(socketId, { address: address.toLowerCase(), authenticatedAt: Date.now() });
    return true;
  }

  /** 이 소켓이 address를 실제로 소유함을 이미 증명했는지 확인 (세션 만료 포함). */
  isAuthenticatedAs(socketId: string, address: string): boolean {
    const session = this.sessions.get(socketId);
    if (!session) return false;
    if (Date.now() - session.authenticatedAt > SESSION_TTL_MS) {
      this.sessions.delete(socketId);
      return false;
    }
    return session.address === address.toLowerCase();
  }

  clear(socketId: string) {
    this.challenges.delete(socketId);
    this.sessions.delete(socketId);
  }
}
