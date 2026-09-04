import { expect } from "chai";
import { ethers } from "hardhat";
import { GoldenLock, MockVerifier } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const RESOURCE_ICU = 0x01;
const dummyProof = {
  a: [0, 0] as [number, number],
  b: [
    [0, 0],
    [0, 0],
  ] as [[number, number], [number, number]],
  c: [0, 0] as [number, number],
};

describe("GoldenLock", () => {
  let goldenLock: GoldenLock;
  let mockVerifier: MockVerifier;
  let admin: SignerWithAddress;
  let hospital: SignerWithAddress;
  let ambulance: SignerWithAddress;
  let relayer: SignerWithAddress;

  beforeEach(async () => {
    [admin, hospital, ambulance, relayer] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const GoldenLockFactory = await ethers.getContractFactory("GoldenLock");
    goldenLock = await GoldenLockFactory.deploy(await mockVerifier.getAddress(), relayer.address);
  });

  it("hospital can update availability with a valid proof", async () => {
    await expect(
      goldenLock.connect(hospital).submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c)
    )
      .to.emit(goldenLock, "AvailabilityUpdated")
      .withArgs(hospital.address, RESOURCE_ICU, true);

    expect(await goldenLock.availability(hospital.address, RESOURCE_ICU)).to.equal(true);
  });

  it("rejects an invalid proof (mock verifier returns false)", async () => {
    await mockVerifier.setForceInvalid(true);

    await expect(
      goldenLock.connect(hospital).submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c)
    ).to.be.revertedWith("GoldenLock: invalid ZK proof");
  });

  it("ambulance cannot lock a resource that isn't marked available", async () => {
    await expect(
      goldenLock.connect(ambulance).requestLock(
        hospital.address,
        RESOURCE_ICU,
        ethers.keccak256(ethers.toUtf8Bytes("case-001")),
        ambulance.address
      )
    ).to.be.revertedWith("GoldenLock: resource not available");
  });

  it("locks atomically and prevents double-booking the same slot", async () => {
    await goldenLock
      .connect(hospital)
      .submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c);

    const patientRef = ethers.keccak256(ethers.toUtf8Bytes("case-001"));

    await expect(
      goldenLock.connect(ambulance).requestLock(hospital.address, RESOURCE_ICU, patientRef, ambulance.address)
    )
      .to.emit(goldenLock, "LockRequested")
      .withArgs(1, hospital.address, ambulance.address, RESOURCE_ICU, patientRef, anyValue);

    // 가용성이 즉시 소비되어 두 번째 구급차는 락을 잡을 수 없다
    expect(await goldenLock.availability(hospital.address, RESOURCE_ICU)).to.equal(false);

    const secondPatientRef = ethers.keccak256(ethers.toUtf8Bytes("case-002"));
    await expect(
      goldenLock.connect(ambulance).requestLock(hospital.address, RESOURCE_ICU, secondPatientRef, ambulance.address)
    ).to.be.revertedWith("GoldenLock: resource not available");
  });

  it("hospital can confirm acceptance of a locked resource", async () => {
    await goldenLock
      .connect(hospital)
      .submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c);
    await goldenLock
      .connect(ambulance)
      .requestLock(hospital.address, RESOURCE_ICU, ethers.keccak256(ethers.toUtf8Bytes("case-001")), ambulance.address);

    await expect(goldenLock.connect(hospital).confirmAcceptance(1))
      .to.emit(goldenLock, "LockConfirmed")
      .withArgs(1, hospital.address);
  });

  it("anyone can expire a lock after TTL passes", async () => {
    await goldenLock
      .connect(hospital)
      .submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c);
    await goldenLock
      .connect(ambulance)
      .requestLock(hospital.address, RESOURCE_ICU, ethers.keccak256(ethers.toUtf8Bytes("case-001")), ambulance.address);

    await expect(goldenLock.expireLock(1)).to.be.revertedWith("GoldenLock: lock not yet expired");

    await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(goldenLock.expireLock(1)).to.emit(goldenLock, "LockExpired").withArgs(1);
  });

  it("trusted relayer can act on behalf of the ambulance (gasless UX)", async () => {
    await goldenLock
      .connect(hospital)
      .submitAvailabilityProof(RESOURCE_ICU, 1, dummyProof.a, dummyProof.b, dummyProof.c);

    await expect(
      goldenLock
        .connect(relayer)
        .requestLock(hospital.address, RESOURCE_ICU, ethers.keccak256(ethers.toUtf8Bytes("case-001")), ambulance.address)
    ).to.emit(goldenLock, "LockRequested");
  });

  it("trusted relayer accepts a hospital-signed availability proof", async () => {
    const nonce = await goldenLock.availabilityNonces(hospital.address);
    const network = await ethers.provider.getNetwork();
    const domain = {
      name: "GoldenLock",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await goldenLock.getAddress(),
    };
    const types = {
      Availability: [
        { name: "hospital", type: "address" },
        { name: "resourceCode", type: "uint256" },
        { name: "isAvailable", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const signature = await hospital.signTypedData(domain, types, {
      hospital: hospital.address,
      resourceCode: RESOURCE_ICU,
      isAvailable: 1,
      nonce,
    });

    await goldenLock.connect(relayer).submitAvailabilityProofFor(
      hospital.address,
      RESOURCE_ICU,
      1,
      dummyProof.a,
      dummyProof.b,
      dummyProof.c,
      nonce,
      signature
    );

    expect(await goldenLock.availability(hospital.address, RESOURCE_ICU)).to.equal(true);
    expect(await goldenLock.availabilityNonces(hospital.address)).to.equal(1);
  });
});
