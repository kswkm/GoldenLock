/**
 * relay-server 전역에서 쓰이는 도메인 타입.
 * ai-engine의 KTAS 결과 / resource_mapper.py 산출 코드와 스키마를 맞춘다.
 */

/** ai-engine/app/services/resource_mapper.py 의 매핑 결과와 동일한 값 체계 */
export enum ResourceCode {
  ICU_BED = 0x01, // 중증(소생) - 중환자실
  TRAUMA_BAY = 0x02, // 중증(외상) - 외상소생실
  ISOLATION_ROOM = 0x03, // 감염 의심 - 음압격리병상
  GENERAL_BED = 0x04, // 응급(비중증) - 일반 응급병상
  OBSERVATION = 0x05, // 준응급 - 관찰실
}

export type KtasGrade = 1 | 2 | 3 | 4 | 5; // 1: 소생 ~ 5: 비응급

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 구급대원 단말이 emit하는 매칭 요청 페이로드 */
export interface AmbulanceMatchRequest {
  ambulanceId: string;
  ambulanceAddress: string; // 온체인 requester 주소 (락 요청 주체)
  ktasGrade: KtasGrade;
  resourceCode: ResourceCode;
  patientCaseId: string; // 온체인에는 해시로만 올라감 (PII 비노출)
  location: GeoPoint;
}

/** 병원 관제 단말이 emit하는 가용성 업데이트 (오프체인 브로드캐스트용, 온체인 반영은 별도 ZK 제출) */
export interface HospitalAvailabilityUpdate {
  hospitalId: string;
  hospitalAddress: string;
  resourceCode: ResourceCode;
  isAvailable: boolean;
  location: GeoPoint;
}

export enum MatchStatus {
  SEARCHING = "SEARCHING",
  MATCHED = "MATCHED",
  LOCK_REQUESTED = "LOCK_REQUESTED",
  LOCK_CONFIRMED = "LOCK_CONFIRMED",
  RELEASED = "RELEASED",
  EXPIRED = "EXPIRED",
  FAILED = "FAILED",
}

export interface MatchRecord {
  matchId: string;
  ambulanceId: string;
  ambulanceAddress: string;
  hospitalId: string;
  hospitalAddress: string;
  resourceCode: ResourceCode;
  ktasGrade: KtasGrade;
  patientCaseId: string;
  status: MatchStatus;
  lockId?: number;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HospitalRegistryEntry {
  hospitalId: string;
  hospitalAddress: string;
  location: GeoPoint;
  availability: Partial<Record<ResourceCode, boolean>>;
  socketId?: string;
}
