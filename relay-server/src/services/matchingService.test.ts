import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MatchingService } from "./matchingService";
import { MatchStatus } from "../types";

function hospitalUpdate(overrides: Partial<Parameters<MatchingService["upsertHospital"]>[0]> = {}) {
  return {
    hospitalId: "hospital-1",
    hospitalAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226",
    hasCapacity: true,
    location: { lat: 37.5665, lng: 126.978 },
    ...overrides,
  };
}

function ambulanceRequest(overrides: Partial<Parameters<MatchingService["createMatch"]>[0]> = {}) {
  return {
    ambulanceId: "ambulance-1",
    ambulanceAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    ktasGrade: 3 as const,
    requiredBeds: 1,
    requiredSpecialists: 1,
    patientCaseId: "case-1",
    location: { lat: 37.57, lng: 126.982 },
    ...overrides,
  };
}

describe("MatchingService", () => {
  it("upsertHospital은 새 병원을 등록하고 다시 부르면 값을 갱신한다", () => {
    const svc = new MatchingService();
    const first = svc.upsertHospital(hospitalUpdate(), "socket-1");
    assert.equal(first.hasCapacity, true);

    const updated = svc.upsertHospital(hospitalUpdate({ hasCapacity: false }), "socket-1");
    assert.equal(updated.hasCapacity, false);
    assert.equal(svc.listHospitals().length, 1);
  });

  it("findBestHospital은 hasCapacity=false인 병원은 후보에서 제외한다", () => {
    const svc = new MatchingService();
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-far", hasCapacity: false, location: { lat: 37.5, lng: 127.0 } }));
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-near", hasCapacity: true, location: { lat: 37.566, lng: 126.977 } }));

    const best = svc.findBestHospital({ lat: 37.5665, lng: 126.978 });
    assert.ok(best);
    assert.equal(best?.hospitalId, "h-near");
  });

  it("findBestHospital은 여러 후보 중 실제로 더 가까운 병원을 고른다", () => {
    const svc = new MatchingService();
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-close", location: { lat: 37.567, lng: 126.979 } }));
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-far", location: { lat: 37.9, lng: 127.5 } }));

    const best = svc.findBestHospital({ lat: 37.5665, lng: 126.978 });
    assert.equal(best?.hospitalId, "h-close");
  });

  it("findBestHospital은 후보가 없으면 null을 반환한다", () => {
    const svc = new MatchingService();
    const best = svc.findBestHospital({ lat: 0, lng: 0 });
    assert.equal(best, null);
  });

  it("createMatch는 MATCHED 상태의 매치를 만들고 getMatch로 조회 가능해야 한다", () => {
    const svc = new MatchingService();
    const hospital = svc.upsertHospital(hospitalUpdate());
    const match = svc.createMatch(ambulanceRequest(), hospital);

    assert.equal(match.status, MatchStatus.MATCHED);
    assert.equal(match.hospitalId, hospital.hospitalId);
    const fetched = svc.getMatch(match.matchId);
    assert.equal(fetched?.matchId, match.matchId);
  });

  it("setAmbulanceAuthorization은 서명을 저장하고 상태를 AUTHORIZED로 바꾼다", () => {
    const svc = new MatchingService();
    const hospital = svc.upsertHospital(hospitalUpdate());
    const match = svc.createMatch(ambulanceRequest(), hospital);

    svc.setAmbulanceAuthorization(match.matchId, "0xdeadbeef");
    const updated = svc.getMatch(match.matchId);
    assert.equal(updated?.status, MatchStatus.AUTHORIZED);
    assert.equal(updated?.ambulanceAuthSignature, "0xdeadbeef");
  });

  it("updateMatchStatus는 존재하지 않는 matchId에 대해 undefined를 반환한다", () => {
    const svc = new MatchingService();
    const result = svc.updateMatchStatus("no-such-id", MatchStatus.FAILED);
    assert.equal(result, undefined);
  });

  it("removeHospitalSocket은 해당 소켓만 연결 해제로 표시한다", () => {
    const svc = new MatchingService();
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-1" }), "socket-A");
    svc.upsertHospital(hospitalUpdate({ hospitalId: "h-2" }), "socket-B");

    svc.removeHospitalSocket("socket-A");
    const hospitals = svc.listHospitals();
    assert.equal(hospitals.find((h) => h.hospitalId === "h-1")?.socketId, undefined);
    assert.equal(hospitals.find((h) => h.hospitalId === "h-2")?.socketId, "socket-B");
  });
});
