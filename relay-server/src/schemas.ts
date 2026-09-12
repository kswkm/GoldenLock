import { z } from "zod";

/**
 * 모든 소켓 이벤트 페이로드는 여기 정의된 스키마로 검증한 뒤에만 처리한다.
 * matchSocket.ts는 이 스키마들 없이 raw 페이로드를 절대 신뢰하지 않는다.
 */

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "유효한 이더리움 주소가 아닙니다");

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const ktasGradeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

// ── 인증 ──────────────────────────────────────────────────────
export const authRequestChallengeSchema = z.object({
  address: addressSchema,
});
export type AuthRequestChallengePayload = z.infer<typeof authRequestChallengeSchema>;

export const authVerifySchema = z.object({
  address: addressSchema,
  signature: z.string().min(2),
});
export type AuthVerifyPayload = z.infer<typeof authVerifySchema>;

// ── 병원 ──────────────────────────────────────────────────────
export const hospitalJoinSchema = z.object({
  hospitalId: z.string().min(1).max(128),
  hospitalAddress: addressSchema,
});
export type HospitalJoinPayload = z.infer<typeof hospitalJoinSchema>;

export const hospitalAvailabilityUpdateSchema = z.object({
  hospitalId: z.string().min(1).max(128),
  hospitalAddress: addressSchema,
  hasCapacity: z.boolean(),
  location: geoPointSchema,
});
export type HospitalAvailabilityUpdate = z.infer<typeof hospitalAvailabilityUpdateSchema>;

// ── 구급대 ────────────────────────────────────────────────────
export const ambulanceMatchRequestSchema = z.object({
  ambulanceId: z.string().min(1).max(128),
  ambulanceAddress: addressSchema,
  ktasGrade: ktasGradeSchema,
  requiredBeds: z.number().int().min(0).max(1000),
  requiredSpecialists: z.number().int().min(0).max(1000),
  patientCaseId: z.string().min(1).max(256),
  location: geoPointSchema,
});
export type AmbulanceMatchRequest = z.infer<typeof ambulanceMatchRequestSchema>;

// ── ZK 증명 제출 ──────────────────────────────────────────────
const proofPointSchema = z.tuple([z.string(), z.string()]);
const proofSchema = z.object({
  a: proofPointSchema,
  b: z.tuple([proofPointSchema, proofPointSchema]),
  c: proofPointSchema,
});
export type ProofArgs = z.infer<typeof proofSchema>;

const publicSignalsSchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);
export type PublicSignals = z.infer<typeof publicSignalsSchema>;

const uuidLikeSchema = z.string().uuid("matchId는 UUID 형식이어야 합니다");
const decimalStringSchema = z.string().regex(/^\d+$/, "10진수 문자열이어야 합니다");
const hexSignatureSchema = z.string().regex(/^0x[0-9a-fA-F]+$/, "0x로 시작하는 16진수 서명이어야 합니다");

export const submitRequestProofSchema = z.object({
  matchId: uuidLikeSchema,
  hospitalAddress: addressSchema,
  requestHash: decimalStringSchema,
  proof: proofSchema,
  publicSignals: publicSignalsSchema,
});
export type SubmitRequestProofPayload = z.infer<typeof submitRequestProofSchema>;

// ── 구급대의 사전 승인 서명 (requestAndLock용 EIP-712 서명) ─────
export const authorizeLockSchema = z.object({
  matchId: uuidLikeSchema,
  ambulanceAddress: addressSchema,
  signature: hexSignatureSchema,
});
export type AuthorizeLockPayload = z.infer<typeof authorizeLockSchema>;

// ── 병원의 수용 확정 (fulfillRequest용 EIP-712 서명) ────────────
export const confirmAcceptanceSchema = z.object({
  matchId: uuidLikeSchema,
  hospitalAddress: addressSchema,
  signature: hexSignatureSchema,
});
export type ConfirmAcceptancePayload = z.infer<typeof confirmAcceptanceSchema>;

// ── 이송 취소 (cancelRequest용 EIP-712 서명) ────────────────────
export const releaseSchema = z.object({
  matchId: uuidLikeSchema,
  ambulanceAddress: addressSchema,
  signature: hexSignatureSchema,
});
export type ReleasePayload = z.infer<typeof releaseSchema>;
