import { Server, Socket } from "socket.io";
import { MatchingService } from "../services/matchingService";
import { Relayer } from "../web3/relayer";
import { WalletAuth } from "../auth/walletAuth";
import { RateLimiter } from "../utils/rateLimiter";
import { MatchStatus } from "../types";
import {
  authRequestChallengeSchema,
  authVerifySchema,
  hospitalJoinSchema,
  hospitalAvailabilityUpdateSchema,
  ambulanceMatchRequestSchema,
  submitRequestProofSchema,
  authorizeLockSchema,
  confirmAcceptanceSchema,
  releaseSchema,
} from "../schemas";
import type { ZodSchema } from "zod";

/**
 * matchSocket
 * -----------
 * 구급차 ↔ 병원 초저지연 매칭 채널.
 *
 * 보안 모델 (v2):
 *   1) 스키마 검증 — 모든 인바운드 페이로드는 zod 스키마를 통과해야 처리된다.
 *   2) 지갑 서명 인증 — hospitalAddress/ambulanceAddress를 자처하는 모든 이벤트는
 *      먼저 "auth:request-challenge" → "auth:verify"로 그 주소의 개인키를 실제로
 *      갖고 있음을 증명해야 한다. 증명 없이는 그 주소로 어떤 행동도 할 수 없다
 *      (즉 matchId만 안다고 남의 병원/구급대 행세를 할 수 없다).
 *   3) 온체인 레지스트리 확인 — 병원 관련 이벤트는 추가로 GoldenLock.sol의
 *      isRegisteredHospital(address)까지 확인한다 (등록 안 된 주소는 아무리 서명이
 *      유효해도 "병원"으로 인정하지 않는다).
 *   4) 레이트 리밋 — 실제 트랜잭션(가스)을 유발하는 이벤트는 인증된 주소별로
 *      호출 빈도를 제한해 relayer의 가스 소모 남용을 완화한다.
 *   5) EIP-712 서명 — requestAndLock/fulfillRequest/cancelRequest 자체도
 *      GoldenLock.sol이 실제 행위자의 EIP-712 서명을 요구하므로, relay-server가
 *      전부 뚫려도 온체인에서 다시 한번 막힌다 (심층 방어).
 *
 * 이벤트 (client -> server)
 *   - "auth:request-challenge" / "auth:verify"   지갑 서명 인증
 *   - "hospital:join"                 병원 관제 단말 접속, 룸 등록 (인증 필요)
 *   - "hospital:update-availability"  "지금 받을 수 있음" 방송 (인증 필요, 오프체인 라우팅 참고용)
 *   - "ambulance:request-match"       구급대 매칭 요청 (인증 필요)
 *   - "ambulance:authorize-lock"      구급대가 RequestLock EIP-712 서명 제출 (인증 필요)
 *   - "hospital:submit-request-proof" 병원이 ZK 증명 제출 → requestAndLock 트리거 (인증+레이트리밋)
 *   - "hospital:confirm-acceptance"   병원이 수용 확정 → fulfillRequest 트리거 (인증+레이트리밋)
 *   - "match:release"                 구급대가 취소 → cancelRequest 트리거 (인증+레이트리밋)
 *
 * 이벤트 (server -> client)
 *   - "auth:challenge" / "auth:verified" / "auth:error"
 *   - "validation:error"             스키마 검증 실패
 *   - "hospital:availability-changed" / "match:found" / "match:authorized"
 *   - "match:lock-requested" / "match:lock-onchain" / "match:lock-confirmed"
 *   - "match:failed" / "match:released" / "match:lock-expired-onchain"
 */

const RELAYER_ACTION_WINDOW_MS = 60_000;
const RELAYER_ACTION_MAX_CALLS = 10;

export function registerMatchSocket(io: Server, matchingService: MatchingService, relayer: Relayer) {
  const walletAuth = new WalletAuth();
  const relayerActionLimiter = new RateLimiter(RELAYER_ACTION_MAX_CALLS, RELAYER_ACTION_WINDOW_MS);

  /** 스키마 검증 헬퍼 — 실패 시 "validation:error"를 emit하고 null을 반환한다. */
  function parseOrReject<T>(socket: Socket, event: string, schema: ZodSchema<T>, raw: unknown): T | null {
    const result = schema.safeParse(raw);
    if (!result.success) {
      socket.emit("validation:error", { event, issues: result.error.issues });
      return null;
    }
    return result.data;
  }

  /** address 소유 증명(인증) 여부 확인 — 실패 시 "auth:error"를 emit하고 false를 반환한다. */
  function requireAuth(socket: Socket, address: string, event: string): boolean {
    if (!walletAuth.isAuthenticatedAs(socket.id, address)) {
      socket.emit("auth:error", {
        event,
        reason: `${address} 주소로 인증되지 않았습니다. auth:request-challenge로 먼저 서명 인증하세요.`,
      });
      return false;
    }
    return true;
  }

  /** 실제 트랜잭션을 유발하는 이벤트의 레이트 리밋 — 초과 시 "match:failed"를 emit하고 false를 반환한다. */
  function requireWithinRateLimit(socket: Socket, key: string, matchId?: string): boolean {
    if (!relayerActionLimiter.tryConsume(key)) {
      socket.emit("match:failed", { reason: "rate-limited", matchId });
      return false;
    }
    return true;
  }

  io.on("connection", (socket: Socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── 지갑 서명 인증 ────────────────────────────────────────
    socket.on("auth:request-challenge", (raw: unknown) => {
      const data = parseOrReject(socket, "auth:request-challenge", authRequestChallengeSchema, raw);
      if (!data) return;
      const challenge = walletAuth.issueChallenge(socket.id, data.address);
      socket.emit("auth:challenge", challenge);
    });

    socket.on("auth:verify", (raw: unknown) => {
      const data = parseOrReject(socket, "auth:verify", authVerifySchema, raw);
      if (!data) return;
      const ok = walletAuth.verify(socket.id, data.address, data.signature);
      if (ok) {
        socket.emit("auth:verified", { address: data.address });
      } else {
        socket.emit("auth:error", { event: "auth:verify", reason: "서명이 유효하지 않거나 인증 요청이 만료되었습니다." });
      }
    });

    // ── 병원 관제 단말 ──────────────────────────────────────
    socket.on("hospital:join", async (raw: unknown) => {
      const data = parseOrReject(socket, "hospital:join", hospitalJoinSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.hospitalAddress, "hospital:join")) return;

      const registered = await safeIsRegisteredHospital(data.hospitalAddress);
      if (!registered) {
        socket.emit("auth:error", { event: "hospital:join", reason: "온체인에 등록되지 않은 병원 주소입니다." });
        return;
      }

      socket.join(roomForHospital(data.hospitalId));
      console.log(`[socket] hospital ${data.hospitalId} joined (${socket.id})`);
    });

    socket.on("hospital:update-availability", async (raw: unknown) => {
      const data = parseOrReject(socket, "hospital:update-availability", hospitalAvailabilityUpdateSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.hospitalAddress, "hospital:update-availability")) return;

      const registered = await safeIsRegisteredHospital(data.hospitalAddress);
      if (!registered) {
        socket.emit("auth:error", { event: "hospital:update-availability", reason: "온체인에 등록되지 않은 병원 주소입니다." });
        return;
      }

      const entry = matchingService.upsertHospital(data, socket.id);
      io.emit("hospital:availability-changed", entry);
    });

    // ── 구급대 단말 ──────────────────────────────────────────
    socket.on("ambulance:request-match", async (raw: unknown) => {
      const data = parseOrReject(socket, "ambulance:request-match", ambulanceMatchRequestSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.ambulanceAddress, "ambulance:request-match")) return;

      try {
        const hospital = matchingService.findBestHospital(data.location);
        if (!hospital) {
          socket.emit("match:failed", { reason: "no-hospital-available" });
          return;
        }

        const match = matchingService.createMatch(data, hospital);
        socket.join(roomForMatch(match.matchId));

        io.to(roomForHospital(hospital.hospitalId)).emit("match:found", match);
        socket.emit("match:found", match);
      } catch (err) {
        console.error("[socket] ambulance:request-match failed", err);
        socket.emit("match:failed", { reason: "internal-error" });
      }
    });

    // ── 구급대가 requestAndLock용 EIP-712 서명을 제출 ────────────
    socket.on("ambulance:authorize-lock", (raw: unknown) => {
      const data = parseOrReject(socket, "ambulance:authorize-lock", authorizeLockSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.ambulanceAddress, "ambulance:authorize-lock")) return;

      const match = matchingService.getMatch(data.matchId);
      if (!match || match.ambulanceAddress.toLowerCase() !== data.ambulanceAddress.toLowerCase()) {
        socket.emit("match:failed", { reason: "match-not-found-or-address-mismatch", matchId: data.matchId });
        return;
      }

      matchingService.setAmbulanceAuthorization(data.matchId, data.signature);
      io.to(roomForMatch(data.matchId)).emit("match:authorized", { matchId: data.matchId });
    });

    // ── 병원이 매치 전용 ZK 증명을 온체인에 제출 ────────────────
    socket.on("hospital:submit-request-proof", async (raw: unknown) => {
      const data = parseOrReject(socket, "hospital:submit-request-proof", submitRequestProofSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.hospitalAddress, "hospital:submit-request-proof")) return;

      const match = matchingService.getMatch(data.matchId);
      if (!match || match.hospitalAddress.toLowerCase() !== data.hospitalAddress.toLowerCase()) {
        socket.emit("match:failed", { reason: "match-not-found-or-hospital-mismatch", matchId: data.matchId });
        return;
      }
      if (!match.ambulanceAuthSignature) {
        socket.emit("match:failed", { reason: "ambulance-not-authorized-yet", matchId: data.matchId });
        return;
      }
      if (match.status !== MatchStatus.AUTHORIZED) {
        // 이미 처리 중이거나 끝난 매치 — 중복 제출(더블클릭/재시도) 방지.
        // await 전에 아래에서 즉시 LOCK_REQUESTED로 선점하므로, 동시에 들어온
        // 두 번째 호출은 이 분기에서 걸러져 relayer에 중복 트랜잭션을 보내지 않는다.
        socket.emit("match:failed", { reason: "already-submitted-or-not-authorized", matchId: data.matchId });
        return;
      }
      if (!requireWithinRateLimit(socket, `submit-proof:${data.hospitalAddress.toLowerCase()}`, data.matchId)) return;

      // await 이전(동기 구간)에 상태를 선점해 동시 중복 제출을 막는다.
      matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED);
      io.to(roomForMatch(match.matchId)).emit("match:lock-requested", { matchId: match.matchId });

      try {
        const { txHash, requestId } = await relayer.requestAndLock({
          hospitalAddress: match.hospitalAddress,
          ambulanceOperatorAddress: match.ambulanceAddress,
          ktasLevel: match.ktasGrade,
          requestHash: data.requestHash,
          proof: data.proof,
          publicSignals: data.publicSignals,
          ambulanceSignature: match.ambulanceAuthSignature,
        });

        matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED, { requestId, txHash });
        io.to(roomForMatch(match.matchId)).emit("match:lock-onchain", { matchId: match.matchId, requestId, txHash });
        console.log(`[relayer] request #${requestId} locked for match ${match.matchId} (tx: ${txHash})`);
      } catch (err) {
        console.error("[socket] submit-request-proof failed", err);
        // 서명 자체는 아직 유효할 수 있으므로(온체인 실패 시 nonce도 소비되지 않음)
        // AUTHORIZED로 되돌려 병원이 다시 제출할 수 있게 한다.
        matchingService.updateMatchStatus(match.matchId, MatchStatus.AUTHORIZED);
        io.to(roomForMatch(match.matchId)).emit("match:failed", {
          reason: "request-lock-tx-failed",
          matchId: match.matchId,
        });
      }
    });

    // ── 병원의 수용 확정 ─────────────────────────────────────
    socket.on("hospital:confirm-acceptance", async (raw: unknown) => {
      const data = parseOrReject(socket, "hospital:confirm-acceptance", confirmAcceptanceSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.hospitalAddress, "hospital:confirm-acceptance")) return;

      const match = matchingService.getMatch(data.matchId);
      if (!match || match.requestId === undefined || match.hospitalAddress.toLowerCase() !== data.hospitalAddress.toLowerCase()) {
        socket.emit("match:failed", { reason: "match-not-found-or-not-locked", matchId: data.matchId });
        return;
      }
      if (match.status !== MatchStatus.LOCK_REQUESTED) {
        socket.emit("match:failed", { reason: "already-confirmed-or-not-ready", matchId: data.matchId });
        return;
      }
      if (!requireWithinRateLimit(socket, `confirm:${data.hospitalAddress.toLowerCase()}`, data.matchId)) return;

      // await 이전에 상태를 선점해 더블클릭 등으로 인한 중복 확정 요청을 막는다.
      matchingService.updateMatchStatus(data.matchId, MatchStatus.LOCK_CONFIRMED);

      try {
        const txHash = await relayer.fulfillRequest(match.requestId, data.signature);
        matchingService.updateMatchStatus(data.matchId, MatchStatus.LOCK_CONFIRMED, { txHash });
        io.to(roomForMatch(data.matchId)).emit("match:lock-confirmed", { matchId: data.matchId, txHash });
      } catch (err) {
        console.error("[socket] confirm-acceptance failed", err);
        matchingService.updateMatchStatus(data.matchId, MatchStatus.LOCK_REQUESTED); // 재시도 가능하도록 되돌림
        socket.emit("match:failed", { reason: "confirm-tx-failed", matchId: data.matchId });
      }
    });

    // ── 이송 취소 / 완료 후 해제 ──────────────────────────────
    socket.on("match:release", async (raw: unknown) => {
      const data = parseOrReject(socket, "match:release", releaseSchema, raw);
      if (!data) return;
      if (!requireAuth(socket, data.ambulanceAddress, "match:release")) return;

      const match = matchingService.getMatch(data.matchId);
      if (!match || match.requestId === undefined || match.ambulanceAddress.toLowerCase() !== data.ambulanceAddress.toLowerCase()) {
        socket.emit("match:failed", { reason: "match-not-found-or-not-locked", matchId: data.matchId });
        return;
      }
      if (match.status !== MatchStatus.LOCK_REQUESTED) {
        socket.emit("match:failed", { reason: "already-released-or-not-ready", matchId: data.matchId });
        return;
      }
      if (!requireWithinRateLimit(socket, `release:${data.ambulanceAddress.toLowerCase()}`, data.matchId)) return;

      // await 이전에 상태를 선점해 중복 취소 요청을 막는다.
      matchingService.updateMatchStatus(data.matchId, MatchStatus.RELEASED);

      try {
        const txHash = await relayer.cancelRequest(match.requestId, data.signature);
        matchingService.updateMatchStatus(data.matchId, MatchStatus.RELEASED, { txHash });
        io.to(roomForMatch(data.matchId)).emit("match:released", { matchId: data.matchId, txHash });
      } catch (err) {
        console.error("[socket] release failed", err);
        matchingService.updateMatchStatus(data.matchId, MatchStatus.LOCK_REQUESTED); // 재시도 가능하도록 되돌림
        socket.emit("match:failed", { reason: "release-tx-failed", matchId: data.matchId });
      }
    });

    socket.on("disconnect", () => {
      walletAuth.clear(socket.id);
      matchingService.removeHospitalSocket(socket.id);
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  async function safeIsRegisteredHospital(address: string): Promise<boolean> {
    try {
      return await relayer.isRegisteredHospital(address);
    } catch (err) {
      console.error("[socket] isRegisteredHospital 조회 실패 — RPC 연결을 확인하세요.", err);
      return false;
    }
  }

  // 온체인에서 직접 만료/확정 이벤트가 발생한 경우(누군가 expireIfOverdue 호출 등)에도
  // 클라이언트에 알린다.
  relayer.onRequestExpired((requestId) => {
    io.emit("match:lock-expired-onchain", { requestId });
  });
}

function roomForHospital(hospitalId: string) {
  return `hospital:${hospitalId}`;
}

function roomForMatch(matchId: string) {
  return `match:${matchId}`;
}
