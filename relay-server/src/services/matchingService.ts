import { randomUUID } from "crypto";
import {
  AmbulanceMatchRequest,
  GeoPoint,
  HospitalAvailabilityUpdate,
  HospitalRegistryEntry,
  MatchRecord,
  MatchStatus,
  ResourceCode,
} from "../types";
import { MatchingStore } from "../storage/postgresStore";

/**
 * MatchingService
 * ----------------
 * - 병원 레지스트리(오프체인, 인메모리)를 관리하며 소켓으로 들어오는
 *   가용성 업데이트를 반영한다.
 * - 구급대 요청이 오면 "요청 자원코드를 보유 + 가장 가까운" 병원을 골라 매칭한다.
 * - 매칭 이후의 상태(락 요청/확정/만료 등)는 온체인 이벤트와 동기화되며
 *   relayer.ts가 실제 트랜잭션을 쏘고 그 결과를 여기 상태머신에 반영한다.
 *
 * 데모/해커톤 스코프이므로 인메모리로 구현. 프로덕션에서는 Redis 등으로 교체 권장.
 */
export class MatchingService {
  private hospitals = new Map<string, HospitalRegistryEntry>(); // key: hospitalId
  private matches = new Map<string, MatchRecord>(); // key: matchId

  constructor(private readonly store: MatchingStore) {
  }

  async initialize(): Promise<void> {
    const state = await this.store.load();
    for (const hospital of state.hospitals) this.hospitals.set(hospital.hospitalId, hospital);
    for (const match of state.matches) this.matches.set(match.matchId, match);
  }

  // ── Hospital registry ──────────────────────────────────────

  async upsertHospital(update: HospitalAvailabilityUpdate, socketId?: string): Promise<HospitalRegistryEntry> {
    const existing = this.hospitals.get(update.hospitalId);
    const entry: HospitalRegistryEntry = existing ?? {
      hospitalId: update.hospitalId,
      hospitalAddress: update.hospitalAddress,
      location: update.location,
      availability: {},
      socketId,
    };

    entry.availability[update.resourceCode] = update.isAvailable;
    entry.location = update.location;
    entry.hospitalAddress = update.hospitalAddress;
    if (socketId) entry.socketId = socketId;

    this.hospitals.set(update.hospitalId, entry);
    await this.persistState();
    return entry;
  }

  async removeHospitalSocket(socketId: string): Promise<void> {
    for (const hospital of this.hospitals.values()) {
      if (hospital.socketId === socketId) hospital.socketId = undefined;
    }
    await this.persistState();
  }

  listHospitals(): HospitalRegistryEntry[] {
    return Array.from(this.hospitals.values());
  }

  // ── Matching ────────────────────────────────────────────────

  /**
   * 요청된 resourceCode를 보유한 병원 중, 하버사인 거리 기준으로 가장 가까운 병원을 찾는다.
   */
  findBestHospital(resourceCode: ResourceCode, from: GeoPoint): HospitalRegistryEntry | null {
    let best: HospitalRegistryEntry | null = null;
    let bestDistance = Infinity;

    for (const hospital of this.hospitals.values()) {
      if (!hospital.availability[resourceCode]) continue;
      const distance = haversineDistanceKm(from, hospital.location);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = hospital;
      }
    }

    return best;
  }

  async createMatch(request: AmbulanceMatchRequest, hospital: HospitalRegistryEntry): Promise<MatchRecord> {
    const now = Date.now();
    const match: MatchRecord = {
      matchId: randomUUID(),
      ambulanceId: request.ambulanceId,
      ambulanceAddress: request.ambulanceAddress,
      hospitalId: hospital.hospitalId,
      hospitalAddress: hospital.hospitalAddress,
      resourceCode: request.resourceCode,
      ktasGrade: request.ktasGrade,
      patientCaseId: request.patientCaseId,
      status: MatchStatus.MATCHED,
      createdAt: now,
      updatedAt: now,
    };
    this.matches.set(match.matchId, match);
    await this.persistState();
    return match;
  }

  async updateMatchStatus(matchId: string, status: MatchStatus, patch?: Partial<MatchRecord>): Promise<MatchRecord | undefined> {
    const match = this.matches.get(matchId);
    if (!match) return undefined;
    Object.assign(match, patch, { status, updatedAt: Date.now() });
    await this.persistState();
    return match;
  }

  getMatch(matchId: string): MatchRecord | undefined {
    return this.matches.get(matchId);
  }

  private async persistState(): Promise<void> {
    await this.store.save(this.listHospitals(), Array.from(this.matches.values()));
  }
}

/** 두 위경도 좌표 간 대략적 거리(km) — 병원 배정용 근사치, 정밀 라우팅 아님 */
function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
