import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addressSchema,
  ambulanceMatchRequestSchema,
  authVerifySchema,
  hospitalAvailabilityUpdateSchema,
  submitRequestProofSchema,
  authorizeLockSchema,
} from "./schemas";

const VALID_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_MATCH_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("addressSchema", () => {
  it("유효한 40자리 hex 주소를 통과시킨다", () => {
    assert.doesNotThrow(() => addressSchema.parse(VALID_ADDRESS));
  });

  it("0x 접두어가 없으면 거부한다", () => {
    assert.throws(() => addressSchema.parse(VALID_ADDRESS.slice(2)));
  });

  it("길이가 짧으면 거부한다", () => {
    assert.throws(() => addressSchema.parse("0x1234"));
  });
});

describe("ambulanceMatchRequestSchema", () => {
  const base = {
    ambulanceId: "ambulance-1",
    ambulanceAddress: VALID_ADDRESS,
    ktasGrade: 3,
    requiredBeds: 1,
    requiredSpecialists: 1,
    patientCaseId: "case-1",
    location: { lat: 37.5, lng: 127.0 },
  };

  it("유효한 페이로드를 통과시킨다", () => {
    const result = ambulanceMatchRequestSchema.safeParse(base);
    assert.equal(result.success, true);
  });

  it("ktasGrade가 1~5 범위를 벗어나면 거부한다", () => {
    const result = ambulanceMatchRequestSchema.safeParse({ ...base, ktasGrade: 6 });
    assert.equal(result.success, false);
  });

  it("위도가 범위를 벗어나면 거부한다", () => {
    const result = ambulanceMatchRequestSchema.safeParse({ ...base, location: { lat: 999, lng: 127.0 } });
    assert.equal(result.success, false);
  });

  it("requiredBeds가 음수이면 거부한다", () => {
    const result = ambulanceMatchRequestSchema.safeParse({ ...base, requiredBeds: -1 });
    assert.equal(result.success, false);
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const { ambulanceAddress, ...missing } = base;
    const result = ambulanceMatchRequestSchema.safeParse(missing);
    assert.equal(result.success, false);
  });
});

describe("hospitalAvailabilityUpdateSchema", () => {
  it("유효한 페이로드를 통과시킨다", () => {
    const result = hospitalAvailabilityUpdateSchema.safeParse({
      hospitalId: "hospital-1",
      hospitalAddress: VALID_ADDRESS,
      hasCapacity: true,
      location: { lat: 37.5, lng: 127.0 },
    });
    assert.equal(result.success, true);
  });

  it("hasCapacity가 boolean이 아니면 거부한다", () => {
    const result = hospitalAvailabilityUpdateSchema.safeParse({
      hospitalId: "hospital-1",
      hospitalAddress: VALID_ADDRESS,
      hasCapacity: "yes",
      location: { lat: 37.5, lng: 127.0 },
    });
    assert.equal(result.success, false);
  });
});

describe("authVerifySchema", () => {
  it("서명 문자열이 너무 짧으면 거부한다", () => {
    const result = authVerifySchema.safeParse({ address: VALID_ADDRESS, signature: "0" });
    assert.equal(result.success, false);
  });
});

describe("submitRequestProofSchema", () => {
  const validProof = {
    a: ["1", "2"],
    b: [
      ["1", "2"],
      ["3", "4"],
    ],
    c: ["5", "6"],
  };

  it("유효한 증명 제출 페이로드를 통과시킨다", () => {
    const result = submitRequestProofSchema.safeParse({
      matchId: VALID_MATCH_ID,
      hospitalAddress: VALID_ADDRESS,
      requestHash: "123456789",
      proof: validProof,
      publicSignals: ["1", "2", "1", "123456789"],
    });
    assert.equal(result.success, true);
  });

  it("matchId가 UUID 형식이 아니면 거부한다", () => {
    const result = submitRequestProofSchema.safeParse({
      matchId: "not-a-uuid",
      hospitalAddress: VALID_ADDRESS,
      requestHash: "123456789",
      proof: validProof,
      publicSignals: ["1", "2", "1", "123456789"],
    });
    assert.equal(result.success, false);
  });

  it("requestHash가 숫자 문자열이 아니면 거부한다", () => {
    const result = submitRequestProofSchema.safeParse({
      matchId: VALID_MATCH_ID,
      hospitalAddress: VALID_ADDRESS,
      requestHash: "not-a-number",
      proof: validProof,
      publicSignals: ["1", "2", "1", "123456789"],
    });
    assert.equal(result.success, false);
  });

  it("publicSignals가 4개가 아니면 거부한다", () => {
    const result = submitRequestProofSchema.safeParse({
      matchId: VALID_MATCH_ID,
      hospitalAddress: VALID_ADDRESS,
      requestHash: "123456789",
      proof: validProof,
      publicSignals: ["1", "2", "1"],
    });
    assert.equal(result.success, false);
  });
});

describe("authorizeLockSchema", () => {
  it("0x 접두어 없는 서명은 거부한다", () => {
    const result = authorizeLockSchema.safeParse({
      matchId: VALID_MATCH_ID,
      ambulanceAddress: VALID_ADDRESS,
      signature: "deadbeef",
    });
    assert.equal(result.success, false);
  });

  it("유효한 페이로드를 통과시킨다", () => {
    const result = authorizeLockSchema.safeParse({
      matchId: VALID_MATCH_ID,
      ambulanceAddress: VALID_ADDRESS,
      signature: "0xdeadbeef",
    });
    assert.equal(result.success, true);
  });
});
