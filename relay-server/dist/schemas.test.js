"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const schemas_1 = require("./schemas");
const VALID_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_MATCH_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
(0, node_test_1.describe)("addressSchema", () => {
    (0, node_test_1.it)("유효한 40자리 hex 주소를 통과시킨다", () => {
        strict_1.default.doesNotThrow(() => schemas_1.addressSchema.parse(VALID_ADDRESS));
    });
    (0, node_test_1.it)("0x 접두어가 없으면 거부한다", () => {
        strict_1.default.throws(() => schemas_1.addressSchema.parse(VALID_ADDRESS.slice(2)));
    });
    (0, node_test_1.it)("길이가 짧으면 거부한다", () => {
        strict_1.default.throws(() => schemas_1.addressSchema.parse("0x1234"));
    });
});
(0, node_test_1.describe)("ambulanceMatchRequestSchema", () => {
    const base = {
        ambulanceId: "ambulance-1",
        ambulanceAddress: VALID_ADDRESS,
        ktasGrade: 3,
        requiredBeds: 1,
        requiredSpecialists: 1,
        patientCaseId: "case-1",
        location: { lat: 37.5, lng: 127.0 },
    };
    (0, node_test_1.it)("유효한 페이로드를 통과시킨다", () => {
        const result = schemas_1.ambulanceMatchRequestSchema.safeParse(base);
        strict_1.default.equal(result.success, true);
    });
    (0, node_test_1.it)("ktasGrade가 1~5 범위를 벗어나면 거부한다", () => {
        const result = schemas_1.ambulanceMatchRequestSchema.safeParse({ ...base, ktasGrade: 6 });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("위도가 범위를 벗어나면 거부한다", () => {
        const result = schemas_1.ambulanceMatchRequestSchema.safeParse({ ...base, location: { lat: 999, lng: 127.0 } });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("requiredBeds가 음수이면 거부한다", () => {
        const result = schemas_1.ambulanceMatchRequestSchema.safeParse({ ...base, requiredBeds: -1 });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("필수 필드가 빠지면 거부한다", () => {
        const { ambulanceAddress, ...missing } = base;
        const result = schemas_1.ambulanceMatchRequestSchema.safeParse(missing);
        strict_1.default.equal(result.success, false);
    });
});
(0, node_test_1.describe)("hospitalAvailabilityUpdateSchema", () => {
    (0, node_test_1.it)("유효한 페이로드를 통과시킨다", () => {
        const result = schemas_1.hospitalAvailabilityUpdateSchema.safeParse({
            hospitalId: "hospital-1",
            hospitalAddress: VALID_ADDRESS,
            hasCapacity: true,
            location: { lat: 37.5, lng: 127.0 },
        });
        strict_1.default.equal(result.success, true);
    });
    (0, node_test_1.it)("hasCapacity가 boolean이 아니면 거부한다", () => {
        const result = schemas_1.hospitalAvailabilityUpdateSchema.safeParse({
            hospitalId: "hospital-1",
            hospitalAddress: VALID_ADDRESS,
            hasCapacity: "yes",
            location: { lat: 37.5, lng: 127.0 },
        });
        strict_1.default.equal(result.success, false);
    });
});
(0, node_test_1.describe)("authVerifySchema", () => {
    (0, node_test_1.it)("서명 문자열이 너무 짧으면 거부한다", () => {
        const result = schemas_1.authVerifySchema.safeParse({ address: VALID_ADDRESS, signature: "0" });
        strict_1.default.equal(result.success, false);
    });
});
(0, node_test_1.describe)("submitRequestProofSchema", () => {
    const validProof = {
        a: ["1", "2"],
        b: [
            ["1", "2"],
            ["3", "4"],
        ],
        c: ["5", "6"],
    };
    (0, node_test_1.it)("유효한 증명 제출 페이로드를 통과시킨다", () => {
        const result = schemas_1.submitRequestProofSchema.safeParse({
            matchId: VALID_MATCH_ID,
            hospitalAddress: VALID_ADDRESS,
            requestHash: "123456789",
            proof: validProof,
            publicSignals: ["1", "2", "1", "123456789"],
        });
        strict_1.default.equal(result.success, true);
    });
    (0, node_test_1.it)("matchId가 UUID 형식이 아니면 거부한다", () => {
        const result = schemas_1.submitRequestProofSchema.safeParse({
            matchId: "not-a-uuid",
            hospitalAddress: VALID_ADDRESS,
            requestHash: "123456789",
            proof: validProof,
            publicSignals: ["1", "2", "1", "123456789"],
        });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("requestHash가 숫자 문자열이 아니면 거부한다", () => {
        const result = schemas_1.submitRequestProofSchema.safeParse({
            matchId: VALID_MATCH_ID,
            hospitalAddress: VALID_ADDRESS,
            requestHash: "not-a-number",
            proof: validProof,
            publicSignals: ["1", "2", "1", "123456789"],
        });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("publicSignals가 4개가 아니면 거부한다", () => {
        const result = schemas_1.submitRequestProofSchema.safeParse({
            matchId: VALID_MATCH_ID,
            hospitalAddress: VALID_ADDRESS,
            requestHash: "123456789",
            proof: validProof,
            publicSignals: ["1", "2", "1"],
        });
        strict_1.default.equal(result.success, false);
    });
});
(0, node_test_1.describe)("authorizeLockSchema", () => {
    (0, node_test_1.it)("0x 접두어 없는 서명은 거부한다", () => {
        const result = schemas_1.authorizeLockSchema.safeParse({
            matchId: VALID_MATCH_ID,
            ambulanceAddress: VALID_ADDRESS,
            signature: "deadbeef",
        });
        strict_1.default.equal(result.success, false);
    });
    (0, node_test_1.it)("유효한 페이로드를 통과시킨다", () => {
        const result = schemas_1.authorizeLockSchema.safeParse({
            matchId: VALID_MATCH_ID,
            ambulanceAddress: VALID_ADDRESS,
            signature: "0xdeadbeef",
        });
        strict_1.default.equal(result.success, true);
    });
});
