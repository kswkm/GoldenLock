/**
 * relay-server 전역에서 쓰이는 도메인 타입.
 * 소켓 페이로드 형태(AmbulanceMatchRequest, HospitalAvailabilityUpdate,
 * SubmitRequestProofPayload 등)는 schemas.ts의 zod 스키마에서 추론되어 재사용된다 —
 * 검증 로직과 타입 정의가 어긋나지 않도록(single source of truth) 하기 위함이다.
 */
import {
  AmbulanceMatchRequest,
  HospitalAvailabilityUpdate,
  ProofArgs,
  PublicSignals,
  SubmitRequestProofPayload,
} from "./schemas";

export type {
  AmbulanceMatchRequest,
  HospitalAvailabilityUpdate,
  ProofArgs,
  PublicSignals,
  SubmitRequestProofPayload,
};

export type KtasGrade = 1 | 2 | 3 | 4 | 5; // 1: 소생 ~ 5: 비응급

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** ai-engine/services/resource_mapper.py 산출값과 동일한 필드명 */
export interface RequiredResource {
  requiredBeds: number;
  requiredSpecialists: number;
}

export enum MatchStatus {
  SEARCHING = "SEARCHING",
  MATCHED = "MATCHED",
  AUTHORIZED = "AUTHORIZED", // 구급대가 requestAndLock용 EIP-712 서명을 제출함
  LOCK_REQUESTED = "LOCK_REQUESTED",
  LOCK_CONFIRMED = "LOCK_CONFIRMED",
  RELEASED = "RELEASED",
  EXPIRED = "EXPIRED",
  FAILED = "FAILED",
}

export interface MatchRecord extends RequiredResource {
  matchId: string;
  ambulanceId: string;
  ambulanceAddress: string;
  hospitalId: string;
  hospitalAddress: string;
  ktasGrade: KtasGrade;
  patientCaseId: string;
  status: MatchStatus;
  requestId?: number; // GoldenLock.sol의 requestId
  txHash?: string;
  /** 구급대가 서명한 RequestLock EIP-712 서명. relayer.requestAndLock 호출 시 필요. */
  ambulanceAuthSignature?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HospitalRegistryEntry {
  hospitalId: string;
  hospitalAddress: string;
  location: GeoPoint;
  hasCapacity: boolean;
  socketId?: string;
}
