import { Server, Socket } from "socket.io";
import { MatchingService } from "../services/matchingService";
import { Relayer } from "../web3/relayer";
import {
  AmbulanceMatchRequest,
  HospitalAvailabilityUpdate,
  MatchStatus,
  ResourceCode,
  TriageMatchRequest,
  AuthUser,
} from "../types";

const AI_API_URL = process.env.AI_API_URL || "http://127.0.0.1:5000/api/ai";
const ALLOW_DEMO_PROOF = process.env.ALLOW_DEMO_PROOF === "true";

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
    const user = socket.data.user as AuthUser;
    console.log(`[socket] connected: ${socket.id}`);

    // ── 병원 관제 단말 ──────────────────────────────────────
    socket.on("hospital:join", (hospitalId: string) => {
      if (!isRole(user, "hospital") || user.organizationId !== hospitalId) return socket.emit("match:failed", { reason: "forbidden" });
      socket.join(roomForHospital(hospitalId));
      console.log(`[socket] hospital ${hospitalId} joined (${socket.id})`);
    });

    socket.on("hospital:update-availability", async (update: HospitalAvailabilityUpdate) => {
      if (!isRole(user, "hospital") || user.organizationId !== update.hospitalId || user.walletAddress?.toLowerCase() !== update.hospitalAddress.toLowerCase()) return socket.emit("match:failed", { reason: "forbidden" });
      const entry = await matchingService.upsertHospital(update, socket.id);
      // 대시보드(병원/전체 관제 뷰)에 실시간 반영
      io.emit("hospital:availability-changed", entry);
    });

    // 병원 EMR/ZK 서비스는 이 이벤트를 받고 수용 가능 여부 및 ZK proof를 응답한다.
    // 현재 테스트 클라이언트는 MockVerifier용 zero proof를 사용한다.
    socket.on("hospital:capacity-request", () => undefined);

    /**
     * ⚠️ 데모/테스트 전용: 실제로는 web-dashboard의 useZkProver 훅이 브라우저에서
     * hospital_resource.circom 회로로 진짜 ZK 증명을 만들어 제출해야 한다.
     * zk-circuits가 아직 없는 단계이므로, MockVerifier가 항상 통과시키는
     * 더미 증명(all-zero)을 대신 제출해 온체인 availability를 true로 만든다.
     * 이게 없으면 requestLock()이 항상 "resource not available"로 실패한다.
     */
    socket.on(
      "hospital:submit-onchain-proof",
      async (payload: {
        hospitalAddress: string;
        resourceCode: number;
        isAvailable: 0 | 1;
        nonce?: number;
        signature?: string;
        proof?: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] };
      }) => {
        try {
          if (!isRole(user, "hospital") || user.walletAddress?.toLowerCase() !== payload.hospitalAddress.toLowerCase()) throw new Error("forbidden");
          const proof = payload.proof ?? zeroProof();
          if (payload.signature !== undefined && payload.nonce !== undefined) {
            await relayer.submitAvailabilityProofFor(
              payload.hospitalAddress,
              payload.resourceCode,
              payload.isAvailable,
              proof,
              payload.nonce,
              payload.signature
            );
          } else if (ALLOW_DEMO_PROOF) {
            await relayer.submitAvailabilityProof(payload.resourceCode, payload.isAvailable, proof);
          } else {
            throw new Error("hospital signature is required");
          }
          io.emit("hospital:onchain-proof-submitted", {
            resourceCode: payload.resourceCode,
            isAvailable: payload.isAvailable,
            hospitalAddress: payload.hospitalAddress,
          });
        } catch (err) {
          console.error("[socket] submit-onchain-proof failed", err);
          socket.emit("match:failed", { reason: "proof-submit-failed" });
        }
      }
    );

    // ── 구급대 단말 ──────────────────────────────────────────
    socket.on("ambulance:request-match", async (request: AmbulanceMatchRequest) => {
      try {
        if (!isRole(user, "ambulance") || user.walletAddress?.toLowerCase() !== request.ambulanceAddress.toLowerCase()) throw new Error("forbidden");
        const hospital = matchingService.findBestHospital(request.resourceCode, request.location);

        if (!hospital) {
          socket.emit("match:failed", { reason: "no-hospital-available", request });
          return;
        }

        const match = await matchingService.createMatch(request, hospital);
        socket.join(roomForMatch(match.matchId));

        // 병원 쪽에도 알림
        io.to(roomForHospital(hospital.hospitalId)).emit("match:found", match);
        socket.emit("match:found", match);

        // 온체인 락 요청 (relayer가 가스 대납)
        await matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED);
        io.to(roomForMatch(match.matchId)).emit("match:lock-requested", { matchId: match.matchId });

        const { txHash, lockId } = await relayer.requestLock({
          hospitalAddress: hospital.hospitalAddress,
          resourceCode: request.resourceCode,
          patientCaseId: request.patientCaseId,
          requesterAddress: request.ambulanceAddress,
        });

        const updated = await matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED, {
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

    // ── AI 분류 → 병원 ZK 수용 증명 → Atomic Lock ───────────
    socket.on("ambulance:request-triage-match", async (request: TriageMatchRequest) => {
      try {
        if (!isRole(user, "ambulance") || user.walletAddress?.toLowerCase() !== request.ambulanceAddress.toLowerCase()) throw new Error("forbidden");
        const prediction = await predictKtas(request);
        const resourceCode = parseResourceCode(prediction.resource_code);
        const matchRequest: AmbulanceMatchRequest = {
          ambulanceId: request.ambulanceId,
          ambulanceAddress: request.ambulanceAddress,
          patientCaseId: request.patientCaseId,
          location: request.location,
          ktasGrade: prediction.ktas_grade,
          resourceCode,
        };
        socket.emit("triage:completed", prediction);

        const hospital = matchingService.findBestHospital(resourceCode, request.location);
        if (!hospital) {
          socket.emit("match:failed", { reason: "no-hospital-available", request: matchRequest });
          return;
        }

        const capacity = await requestHospitalCapacity(io, hospital.hospitalId, {
          resourceCode,
          ambulanceId: request.ambulanceId,
          patientCaseId: request.patientCaseId,
        }, hospital.hospitalAddress, relayer);
        if (!capacity.isAvailable) {
          socket.emit("match:failed", { reason: "hospital-declined-capacity", hospitalId: hospital.hospitalId });
          return;
        }

        if (capacity.signature && capacity.nonce !== undefined) {
          await relayer.submitAvailabilityProofFor(
            hospital.hospitalAddress,
            resourceCode,
            1,
            capacity.proof,
            capacity.nonce,
            capacity.signature
          );
        } else if (ALLOW_DEMO_PROOF) {
          // MetaMask 서명 없이 로컬 데모를 바로 돌리기 위한 경로. 운영에서는 ALLOW_DEMO_PROOF=false 유지.
          await relayer.submitAvailabilityProof(resourceCode, 1, capacity.proof);
        } else {
          throw new Error("hospital capacity response is missing signature");
        }
        const match = await matchingService.createMatch(matchRequest, hospital);
        socket.join(roomForMatch(match.matchId));
        io.to(roomForHospital(hospital.hospitalId)).emit("match:found", match);
        socket.emit("match:found", match);

        await matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED);
        io.to(roomForMatch(match.matchId)).emit("match:lock-requested", { matchId: match.matchId });

        const { txHash, lockId } = await relayer.requestLock({
          hospitalAddress: hospital.hospitalAddress,
          resourceCode,
          patientCaseId: request.patientCaseId,
          requesterAddress: request.ambulanceAddress,
        });
        matchingService.updateMatchStatus(match.matchId, MatchStatus.LOCK_REQUESTED, { lockId, txHash });
        io.to(roomForMatch(match.matchId)).emit("match:lock-onchain", { matchId: match.matchId, lockId, txHash });
      } catch (err) {
        console.error("[socket] ambulance:request-triage-match failed", err);
        socket.emit("match:failed", { reason: "triage-or-lock-failed" });
      }
    });

    // ── 병원의 수용 확정 ─────────────────────────────────────
    socket.on("hospital:confirm-acceptance", async ({ matchId }: { matchId: string }) => {
      if (!isRole(user, "hospital") && !isRole(user, "operator")) return socket.emit("match:failed", { reason: "forbidden", matchId });
      const match = matchingService.getMatch(matchId);
      if (!match || match.lockId === undefined) {
        socket.emit("match:failed", { reason: "match-not-found-or-not-locked", matchId });
        return;
      }

      try {
        const txHash = await relayer.confirmAcceptance(match.lockId);
        await matchingService.updateMatchStatus(matchId, MatchStatus.LOCK_CONFIRMED, { txHash });
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
      if (!isRole(user, "operator") && user.walletAddress?.toLowerCase() !== match.ambulanceAddress.toLowerCase() && user.organizationId !== match.hospitalId) return socket.emit("match:failed", { reason: "forbidden", matchId });

      try {
        const txHash = await relayer.releaseLock(match.lockId);
        await matchingService.updateMatchStatus(matchId, MatchStatus.RELEASED, { txHash });
        io.to(roomForMatch(matchId)).emit("match:released", { matchId, txHash });
      } catch (err) {
        console.error("[socket] release failed", err);
      }
    });

    socket.on("disconnect", () => {
      void matchingService.removeHospitalSocket(socket.id);
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  // 온체인에서 직접 만료 이벤트가 발생한 경우(누군가 expireLock 호출)에도 클라이언트에 알림
  relayer.onLockExpired((lockId) => {
    io.emit("match:lock-expired-onchain", { lockId });
  });
}

function isRole(user: AuthUser, role: AuthUser["role"]): boolean {
  return user.role === role;
}

function roomForHospital(hospitalId: string) {
  return `hospital:${hospitalId}`;
}

function roomForMatch(matchId: string) {
  return `match:${matchId}`;
}

async function predictKtas(request: TriageMatchRequest): Promise<{ ktas_grade: 1 | 2 | 3 | 4 | 5; resource_code: string }> {
  const response = await fetch(`${AI_API_URL}/predict-ktas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vitals: request.vitals,
      symptom_text: request.symptom_text,
      meta: request.meta,
    }),
  });
  if (!response.ok) throw new Error(`AI prediction failed: ${await response.text()}`);
  return response.json() as Promise<{ ktas_grade: 1 | 2 | 3 | 4 | 5; resource_code: string }>;
}

function parseResourceCode(value: string): ResourceCode {
  const resourceCode = Number.parseInt(value, 16);
  if (!Object.values(ResourceCode).includes(resourceCode)) throw new Error(`Invalid AI resource code: ${value}`);
  return resourceCode as ResourceCode;
}

async function requestHospitalCapacity(
  io: Server,
  hospitalId: string,
  request: { resourceCode: ResourceCode; ambulanceId: string; patientCaseId: string },
  hospitalAddress: string,
  relayer: Relayer
): Promise<{ isAvailable: boolean; proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] }; nonce?: number; signature?: string }> {
  const nonce = await relayer.availabilityNonce(hospitalAddress);
  const responses = await io.to(roomForHospital(hospitalId)).timeout(10_000).emitWithAck("hospital:capacity-request", {
    ...request,
    hospitalAddress,
    nonce,
  });
  const response = responses[0] as {
    isAvailable?: boolean;
    proof?: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] };
    nonce?: number;
    signature?: string;
  } | undefined;
  if (!response?.isAvailable || !response.proof) return { isAvailable: false, proof: zeroProof() };
  return { isAvailable: true, proof: response.proof, nonce: response.nonce ?? nonce, signature: response.signature };
}

function zeroProof() {
  return {
    a: ["0", "0"] as [string, string],
    b: [["0", "0"], ["0", "0"]] as [[string, string], [string, string]],
    c: ["0", "0"] as [string, string],
  };
}
