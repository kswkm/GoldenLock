import { expect } from "chai";
import { network } from "hardhat";

describe("GoldenLock", function () {
  async function setup() {
    const { ethers } = await network.connect();
    const [owner, ambulance, hospital] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory("Verifier");
    const verifier = await Verifier.deploy();

    const GoldenLock = await ethers.getContractFactory("GoldenLock");
    const goldenLock = await GoldenLock.deploy();

    await goldenLock.registerHospital(hospital.address, await verifier.getAddress(), 3);

    return { ethers, owner, ambulance, hospital, verifier, goldenLock };
  }

  const dummyProof = {
    a: [0n, 0n] as [bigint, bigint],
    b: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
    c: [0n, 0n] as [bigint, bigint],
  };

  it("등록된 병원에 유효한 proof로 요청 시 Lock이 걸려야 한다", async function () {
    const { ambulance, hospital, goldenLock } = await setup();

    const publicSignals: [bigint, bigint, bigint] = [1n, 2n, 1n];
    const tx = await goldenLock
      .connect(ambulance)
      .requestAndLock(
        hospital.address,
        1,
        111n,
        dummyProof.a,
        dummyProof.b,
        dummyProof.c,
        publicSignals
      );
    await tx.wait();

    const req = await goldenLock.getRequest(1);
    expect(req.status).to.equal(2);
    expect(req.ktasLevel).to.equal(1);
    expect(await goldenLock.lockedSlots(hospital.address)).to.equal(1);
  });

  it("동일 requestHash 재사용(replay) 시 revert되어야 한다", async function () {
    const { ambulance, hospital, goldenLock } = await setup();
    const publicSignals: [bigint, bigint, bigint] = [1n, 2n, 1n];

    await goldenLock
      .connect(ambulance)
      .requestAndLock(hospital.address, 1, 222n, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals);

    await expect(
      goldenLock
        .connect(ambulance)
        .requestAndLock(hospital.address, 1, 222n, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals)
    ).to.be.revertedWith("requestHash already used (replay)");
  });

  it("canAccept=0인 proof는 revert되어야 한다", async function () {
    const { ambulance, hospital, goldenLock } = await setup();
    const publicSignals: [bigint, bigint, bigint] = [0n, 2n, 1n];

    await expect(
      goldenLock
        .connect(ambulance)
        .requestAndLock(hospital.address, 1, 333n, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals)
    ).to.be.revertedWith("hospital cannot accept resource");
  });

  it("fulfillRequest 호출 시 슬롯이 해제되어야 한다", async function () {
    const { ambulance, hospital, goldenLock } = await setup();
    const publicSignals: [bigint, bigint, bigint] = [1n, 2n, 1n];

    await goldenLock
      .connect(ambulance)
      .requestAndLock(hospital.address, 1, 444n, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals);

    await goldenLock.connect(hospital).fulfillRequest(1);
    const req = await goldenLock.getRequest(1);
    expect(req.status).to.equal(3);
    expect(await goldenLock.lockedSlots(hospital.address)).to.equal(0);
  });
});
