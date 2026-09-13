"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchingService = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../types");
/**
 * MatchingService
 * ----------------
 * - 병원 레지스트리(오프체인, 인메모리)를 관리하며 소켓으로 들어오는
 *   가용성 방송(hasCapacity)을 반영한다.
 * - 구급대 요청이 오면 "지금 받을 수 있다고 방송한" 병원 중 가장 가까운 병원을 고른다.
 *   실제 자원 확약 여부는 병원의 ZK 증명 + GoldenLock.sol::requestAndLock으로만 확정된다
 *   (이 오프체인 매칭은 어느 병원에 먼저 물어볼지 정하는 라우팅일 뿐이다).
 * - 매칭 이후의 상태(락 요청/확정/만료 등)는 온체인 이벤트와 동기화되며
 *   relayer.ts가 실제 트랜잭션을 쏘고 그 결과를 여기 상태머신에 반영한다.
 *
 * 데모/해커톤 스코프이므로 인메모리로 구현. 프로덕션에서는 Redis 등으로 교체 권장.
 */
class MatchingService {
    constructor() {
        this.hospitals = new Map(); // key: hospitalId
        this.matches = new Map(); // key: matchId
    }
    // ── Hospital registry ──────────────────────────────────────
    upsertHospital(update, socketId) {
        const existing = this.hospitals.get(update.hospitalId);
        const entry = existing ?? {
            hospitalId: update.hospitalId,
            hospitalAddress: update.hospitalAddress,
            location: update.location,
            hasCapacity: false,
            socketId,
        };
        entry.hasCapacity = update.hasCapacity;
        entry.location = update.location;
        entry.hospitalAddress = update.hospitalAddress;
        if (socketId)
            entry.socketId = socketId;
        this.hospitals.set(update.hospitalId, entry);
        return entry;
    }
    removeHospitalSocket(socketId) {
        for (const hospital of this.hospitals.values()) {
            if (hospital.socketId === socketId)
                hospital.socketId = undefined;
        }
    }
    listHospitals() {
        return Array.from(this.hospitals.values());
    }
    // ── Matching ────────────────────────────────────────────────
    /** hasCapacity=true로 방송 중인 병원 중 하버사인 거리 기준으로 가장 가까운 병원을 찾는다. */
    findBestHospital(from) {
        let best = null;
        let bestDistance = Infinity;
        for (const hospital of this.hospitals.values()) {
            if (!hospital.hasCapacity)
                continue;
            const distance = haversineDistanceKm(from, hospital.location);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = hospital;
            }
        }
        return best;
    }
    createMatch(request, hospital) {
        const now = Date.now();
        const match = {
            matchId: (0, crypto_1.randomUUID)(),
            ambulanceId: request.ambulanceId,
            ambulanceAddress: request.ambulanceAddress,
            hospitalId: hospital.hospitalId,
            hospitalAddress: hospital.hospitalAddress,
            ktasGrade: request.ktasGrade,
            requiredBeds: request.requiredBeds,
            requiredSpecialists: request.requiredSpecialists,
            patientCaseId: request.patientCaseId,
            status: types_1.MatchStatus.MATCHED,
            createdAt: now,
            updatedAt: now,
        };
        this.matches.set(match.matchId, match);
        return match;
    }
    updateMatchStatus(matchId, status, patch) {
        const match = this.matches.get(matchId);
        if (!match)
            return undefined;
        Object.assign(match, patch, { status, updatedAt: Date.now() });
        return match;
    }
    /** 구급대가 서명한 RequestLock EIP-712 서명을 매치 레코드에 저장한다. */
    setAmbulanceAuthorization(matchId, signature) {
        return this.updateMatchStatus(matchId, types_1.MatchStatus.AUTHORIZED, { ambulanceAuthSignature: signature });
    }
    getMatch(matchId) {
        return this.matches.get(matchId);
    }
}
exports.MatchingService = MatchingService;
/** 두 위경도 좌표 간 대략적 거리(km) — 병원 배정용 근사치, 정밀 라우팅 아님 */
function haversineDistanceKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function toRad(deg) {
    return (deg * Math.PI) / 180;
}
