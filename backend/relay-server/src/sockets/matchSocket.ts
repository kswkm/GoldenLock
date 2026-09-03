import { Server, Socket } from "socket.io";
import { MatchingService } from "../services/matchingService";
import { Relayer } from "../web3/relayer";
import { AmbulanceMatchRequest, HospitalAvailabilityUpdate, MatchStatus } from "../types";

/**
 * matchSocket
 * -----------
 * 구급차 ↔ 병원 초저지연 매칭 채널.
 *
 * 이벤트 (client -> server)
 *   - "hospital:join"              병원 관제 단말 접속, 룸 등록
 *   - "hospital:update-availability" 병원이 자원 가용성 변경 브로드캐스트 (오프체인, UI 반영용)
 *   - "ambulance:request-match"    구급대 매칭 요청 (AI가 산출한 KTAS/자원코드 포함)
 *   - "hospital:confirm-acceptance" 병원이 환자 수용을 확정 (온체인 confirmAcceptance 트리거)
 *   - "match:release"              이송 취소/완료 → 락 해제
 *
 * 이벤트 (server -> client)
 *   - "match:found"                매칭 성사, 병원/구급대 양쪽에 전달
 *   - "match:lock-requested"       온체인 락 요청 tx 제출됨 (pending)
 *   - "match:lock-confirmed"       병원 확정 tx 완료
 *   - "match:failed"               매칭 실패(가용 병원 없음 등)
 *   - "match:released"             락 해제 완료
 */
export function registerMatchSocket(io: Server, matchingService: MatchingService, relayer: Relayer) {
  io.on("connection", (socket: Socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── 병원 관제 단말 ──────────────────────────────────────
    socket.on("hospital:join", (hospitalId: string) => {
      socket.join(roomForHospital(hospitalId));
      console.log(`[socket] hospital ${hospitalId} joined (${socket.id})`);
    });

    socket.on("hospital:update-availability", (update: HospitalAvailabilityUpdate) => {
      const entry = matchingService.upsertHospital(update, socket.id);
      // 대시보드(병원/전체 관제 뷰)에 실시간 반영
      io.emit("hospital:availability-changed", entry);
    });

    // ── 구급대 단말 ──────────────────────────────────────────
    socket.on("ambulance:request-match", async (request: AmbulanceMatchRequest) => {
      try {
        const hospital = matchingService.findBestHospital(request.resourceCode, request.location);

        if (!hospital) {
          socket.emit("match:failed", { reason: "no-hospital-available", request });
          return;
        }

        const match = matchingService.createMatch(request, hospital);
        socket.join(roomForMatch(match.matchId));

        // 병원 쪽에도 알림
        io.to(roomForHospital(hospital.hospitalId)).emit("match:found", match);
        socket.emit("match:found", match);

        // 온체인 락 요청 (relayer가 가스 대납)
        matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED);
        io.to(roomForMatch(match.matchId)).emit("match:lock-requested", { matchId: match.matchId });

        const { txHash, lockId } = await relayer.requestLock({
          hospitalAddress: hospital.hospitalAddress,
          resourceCode: request.resourceCode,
          patientCaseId: request.patientCaseId,
          requesterAddress: request.ambulanceAddress,
        });

        const updated = matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED, {
          lockId,
          txHash,
        });

        io.to(roomForMatch(match.matchId)).emit("match:lock-onchain", { matchId: match.matchId, lockId, txHash });
        console.log(`[relayer] lock #${lockId} requested for match ${match.matchId} (tx: ${txHash})`);
        void updated;
      } catch (err) {
        console.error("[socket] ambulance:request-match failed", err);
        socket.emit("match:failed", { reason: "internal-error", request });
      }
    });

    // ── 병원의 수용 확정 ─────────────────────────────────────
    socket.on("hospital:confirm-acceptance", async ({ matchId }: { matchId: string }) => {
      const match = matchingService.getMatch(matchId);
      if (!match || match.lockId === undefined) {
        socket.emit("match:failed", { reason: "match-not-found-or-not-locked", matchId });
        return;
      }

      try {
        const txHash = await relayer.confirmAcceptance(match.lockId);
        matchingService.updateMatchStatus(matchId, MatchStatus.LOCK_CONFIRMED, { txHash });
        io.to(roomForMatch(matchId)).emit("match:lock-confirmed", { matchId, txHash });
      } catch (err) {
        console.error("[socket] confirm-acceptance failed", err);
        socket.emit("match:failed", { reason: "confirm-tx-failed", matchId });
      }
    });

    // ── 이송 취소 / 완료 후 해제 ──────────────────────────────
    socket.on("match:release", async ({ matchId }: { matchId: string }) => {
      const match = matchingService.getMatch(matchId);
      if (!match || match.lockId === undefined) return;

      try {
        const txHash = await relayer.releaseLock(match.lockId);
        matchingService.updateMatchStatus(matchId, MatchStatus.RELEASED, { txHash });
        io.to(roomForMatch(matchId)).emit("match:released", { matchId, txHash });
      } catch (err) {
        console.error("[socket] release failed", err);
      }
    });

    socket.on("disconnect", () => {
      matchingService.removeHospitalSocket(socket.id);
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  // 온체인에서 직접 만료 이벤트가 발생한 경우(누군가 expireLock 호출)에도 클라이언트에 알림
  relayer.onLockExpired((lockId) => {
    io.emit("match:lock-expired-onchain", { lockId });
  });
}

function roomForHospital(hospitalId: string) {
  return `hospital:${hospitalId}`;
}

function roomForMatch(matchId: string) {
  return `match:${matchId}`;
}
