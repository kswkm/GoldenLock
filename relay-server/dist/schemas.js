"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseSchema = exports.confirmAcceptanceSchema = exports.authorizeLockSchema = exports.submitRequestProofSchema = exports.ambulanceMatchRequestSchema = exports.hospitalAvailabilityUpdateSchema = exports.hospitalJoinSchema = exports.authVerifySchema = exports.authRequestChallengeSchema = exports.ktasGradeSchema = exports.geoPointSchema = exports.addressSchema = void 0;
const zod_1 = require("zod");
/**
 * 모든 소켓 이벤트 페이로드는 여기 정의된 스키마로 검증한 뒤에만 처리한다.
 * matchSocket.ts는 이 스키마들 없이 raw 페이로드를 절대 신뢰하지 않는다.
 */
exports.addressSchema = zod_1.z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "유효한 이더리움 주소가 아닙니다");
exports.geoPointSchema = zod_1.z.object({
    lat: zod_1.z.number().min(-90).max(90),
    lng: zod_1.z.number().min(-180).max(180),
});
exports.ktasGradeSchema = zod_1.z.union([
    zod_1.z.literal(1),
    zod_1.z.literal(2),
    zod_1.z.literal(3),
    zod_1.z.literal(4),
    zod_1.z.literal(5),
]);
// ── 인증 ──────────────────────────────────────────────────────
exports.authRequestChallengeSchema = zod_1.z.object({
    address: exports.addressSchema,
});
exports.authVerifySchema = zod_1.z.object({
    address: exports.addressSchema,
    signature: zod_1.z.string().min(2),
});
// ── 병원 ──────────────────────────────────────────────────────
exports.hospitalJoinSchema = zod_1.z.object({
    hospitalId: zod_1.z.string().min(1).max(128),
    hospitalAddress: exports.addressSchema,
});
exports.hospitalAvailabilityUpdateSchema = zod_1.z.object({
    hospitalId: zod_1.z.string().min(1).max(128),
    hospitalAddress: exports.addressSchema,
    hasCapacity: zod_1.z.boolean(),
    location: exports.geoPointSchema,
});
// ── 구급대 ────────────────────────────────────────────────────
exports.ambulanceMatchRequestSchema = zod_1.z.object({
    ambulanceId: zod_1.z.string().min(1).max(128),
    ambulanceAddress: exports.addressSchema,
    ktasGrade: exports.ktasGradeSchema,
    requiredBeds: zod_1.z.number().int().min(0).max(1000),
    requiredSpecialists: zod_1.z.number().int().min(0).max(1000),
    patientCaseId: zod_1.z.string().min(1).max(256),
    location: exports.geoPointSchema,
});
// ── ZK 증명 제출 ──────────────────────────────────────────────
const proofPointSchema = zod_1.z.tuple([zod_1.z.string(), zod_1.z.string()]);
const proofSchema = zod_1.z.object({
    a: proofPointSchema,
    b: zod_1.z.tuple([proofPointSchema, proofPointSchema]),
    c: proofPointSchema,
});
const publicSignalsSchema = zod_1.z.tuple([zod_1.z.string(), zod_1.z.string(), zod_1.z.string(), zod_1.z.string()]);
const uuidLikeSchema = zod_1.z.string().uuid("matchId는 UUID 형식이어야 합니다");
const decimalStringSchema = zod_1.z.string().regex(/^\d+$/, "10진수 문자열이어야 합니다");
const hexSignatureSchema = zod_1.z.string().regex(/^0x[0-9a-fA-F]+$/, "0x로 시작하는 16진수 서명이어야 합니다");
exports.submitRequestProofSchema = zod_1.z.object({
    matchId: uuidLikeSchema,
    hospitalAddress: exports.addressSchema,
    requestHash: decimalStringSchema,
    proof: proofSchema,
    publicSignals: publicSignalsSchema,
});
// ── 구급대의 사전 승인 서명 (requestAndLock용 EIP-712 서명) ─────
exports.authorizeLockSchema = zod_1.z.object({
    matchId: uuidLikeSchema,
    ambulanceAddress: exports.addressSchema,
    signature: hexSignatureSchema,
});
// ── 병원의 수용 확정 (fulfillRequest용 EIP-712 서명) ────────────
exports.confirmAcceptanceSchema = zod_1.z.object({
    matchId: uuidLikeSchema,
    hospitalAddress: exports.addressSchema,
    signature: hexSignatureSchema,
});
// ── 이송 취소 (cancelRequest용 EIP-712 서명) ────────────────────
exports.releaseSchema = zod_1.z.object({
    matchId: uuidLikeSchema,
    ambulanceAddress: exports.addressSchema,
    signature: hexSignatureSchema,
});
