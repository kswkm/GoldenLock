import { expect } from "chai";
import { network } from "hardhat";

describe("GoldenLock", function () {
  const EIP712_DOMAIN_NAME = "GoldenLock";
  const EIP712_DOMAIN_VERSION = "1";

  const REQUEST_LOCK_TYPES = {
    RequestLock: [
      { name: "hospital", type: "address" },
      { name: "ambulanceOperator", type: "address" },
      { name: "ktasLevel", type: "uint8" },
      { name: "requestHash", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const FULFILL_REQUEST_TYPES = {
    FulfillRequest: [
      { name: "requestId", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const CANCEL_REQUEST_TYPES = {
    CancelRequest: [
      { name: "requestId", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  async function setup() {
    const { ethers } = await network.connect();
    const [owner, ambulance, hospital, relayer, stranger] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory("Verifier");
    const verifier = await Verifier.deploy();

    const GoldenLock = await ethers.getContractFactory("GoldenLock");
    const goldenLock = await GoldenLock.deploy(relayer.address);

    await goldenLock.registerHospital(hospital.address, await verifier.getAddress(), 3);

    const network_ = await ethers.provider.getNetwork();
    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: network_.chainId,
      verifyingContract: await goldenLock.getAddress(),
    };

    return { ethers, owner, ambulance, hospital, relayer, stranger, verifier, goldenLock, domain };
  }

  const dummyProof = {
    a: [0n, 0n] as [bigint, bigint],
    b: [
      [0n, 0n],
      [0n, 0n],
    ] as [[bigint, bigint], [bigint, bigint]],
    c: [0n, 0n] as [bigint, bigint],
  };

  async function signRequestLock(signer: any, domain: any, value: any) {
    return signer.signTypedData(domain, REQUEST_LOCK_TYPES, value);
  }
  async function signFulfillRequest(signer: any, domain: any, value: any) {
    return signer.signTypedData(domain, FULFILL_REQUEST_TYPES, value);
  }
  async function signCancelRequest(signer: any, domain: any, value: any) {
    return signer.signTypedData(domain, CANCEL_REQUEST_TYPES, value);
  }

  describe("requestAndLock — 본인 직접 호출 (서명 불필요)", function () {
    it("구급대 본인이 직접 호출하면 서명 없이(0x) Lock이 걸려야 한다", async function () {
      const { ambulance, hospital, goldenLock } = await setup();
      const requestHash = 111n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];

      await goldenLock
        .connect(ambulance)
        .requestAndLock(
          hospital.address,
          ambulance.address,
          1,
          requestHash,
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          publicSignals,
          "0x"
        );

      const req = await goldenLock.getRequest(1);
      expect(req.status).to.equal(1); // Locked
      expect(req.ambulanceOperator).to.equal(ambulance.address);
    });

    it("동일 requestHash 재사용(replay) 시 revert되어야 한다", async function () {
      const { ambulance, hospital, goldenLock } = await setup();
      const requestHash = 222n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];

      await goldenLock
        .connect(ambulance)
        .requestAndLock(hospital.address, ambulance.address, 1, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, "0x");

      await expect(
        goldenLock
          .connect(ambulance)
          .requestAndLock(hospital.address, ambulance.address, 1, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, "0x")
      ).to.be.revertedWith("requestHash already used (replay)");
    });

    it("canAccept=0인 proof는 revert되어야 한다", async function () {
      const { ambulance, hospital, goldenLock } = await setup();
      const requestHash = 333n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [0n, 2n, 1n, requestHash];

      await expect(
        goldenLock
          .connect(ambulance)
          .requestAndLock(hospital.address, ambulance.address, 1, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, "0x")
      ).to.be.revertedWith("hospital cannot accept resource");
    });
  });

  describe("requestAndLock — relayer 대납 호출 (EIP-712 서명 필요)", function () {
    it("ambulance의 유효한 서명이 있으면 relayer가 대납 호출할 수 있어야 한다", async function () {
      const { ambulance, hospital, relayer, goldenLock, domain } = await setup();
      const requestHash = 555n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];
      const nonce = await goldenLock.nonces(ambulance.address);

      const signature = await signRequestLock(ambulance, domain, {
        hospital: hospital.address,
        ambulanceOperator: ambulance.address,
        ktasLevel: 2,
        requestHash,
        nonce,
      });

      await goldenLock
        .connect(relayer)
        .requestAndLock(hospital.address, ambulance.address, 2, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, signature);

      const req = await goldenLock.getRequest(1);
      expect(req.ambulanceOperator).to.equal(ambulance.address);
      expect(await goldenLock.nonces(ambulance.address)).to.equal(nonce + 1n);
    });

    it("서명 없이(0x) relayer가 대납 호출하면 revert되어야 한다", async function () {
      const { ethers, ambulance, hospital, relayer, goldenLock } = await setup();
      const requestHash = 556n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];

      await expect(
        goldenLock
          .connect(relayer)
          .requestAndLock(hospital.address, ambulance.address, 2, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, "0x")
      ).to.be.revert(ethers); // ECDSA: 빈 서명은 malformed로 revert
    });

    it("다른 사람(hospital)이 대신 서명한 경우 revert되어야 한다", async function () {
      const { ambulance, hospital, relayer, goldenLock, domain } = await setup();
      const requestHash = 557n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];
      const nonce = await goldenLock.nonces(ambulance.address);

      // hospital이 ambulance인 척 서명 (서명자 불일치)
      const badSignature = await signRequestLock(hospital, domain, {
        hospital: hospital.address,
        ambulanceOperator: ambulance.address,
        ktasLevel: 2,
        requestHash,
        nonce,
      });

      await expect(
        goldenLock
          .connect(relayer)
          .requestAndLock(hospital.address, ambulance.address, 2, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, badSignature)
      ).to.be.revertedWith("GoldenLock: invalid signature");
    });

    it("등록되지 않은 제3자는 (relayer가 아니므로) 대리 호출할 수 없어야 한다", async function () {
      const { ambulance, hospital, owner, goldenLock, domain } = await setup();
      const requestHash = 777n;
      const publicSignals: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, requestHash];
      const nonce = await goldenLock.nonces(ambulance.address);

      const signature = await signRequestLock(ambulance, domain, {
        hospital: hospital.address,
        ambulanceOperator: ambulance.address,
        ktasLevel: 2,
        requestHash,
        nonce,
      });

      await expect(
        goldenLock
          .connect(owner)
          .requestAndLock(hospital.address, ambulance.address, 2, requestHash, dummyProof.a, dummyProof.b, dummyProof.c, publicSignals, signature)
      ).to.be.revertedWith("GoldenLock: unauthorized caller");
    });

    it("같은 서명을 두 번 재사용(nonce replay)할 수 없어야 한다", async function () {
      const { ambulance, hospital, relayer, goldenLock, domain } = await setup();
      const requestHash1 = 991n;
      const requestHash2 = 992n;
      const nonce = await goldenLock.nonces(ambulance.address);

      const signature = await signRequestLock(ambulance, domain, {
        hospital: hospital.address,
        ambulanceOperator: ambulance.address,
        ktasLevel: 2,
        requestHash: requestHash1,
        nonce,
      });

      await goldenLock
        .connect(relayer)
        .requestAndLock(
          hospital.address,
          ambulance.address,
          2,
          requestHash1,
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          [1n, 2n, 1n, requestHash1],
          signature
        );

      // nonce가 이미 소비되어 같은 서명(과거 nonce 기준)은 더 이상 유효하지 않음
      await expect(
        goldenLock
          .connect(relayer)
          .requestAndLock(
            hospital.address,
            ambulance.address,
            2,
            requestHash2,
            dummyProof.a,
            dummyProof.b,
            dummyProof.c,
            [1n, 2n, 1n, requestHash2],
            signature
          )
      ).to.be.revertedWith("GoldenLock: invalid signature");
    });
  });

  describe("fulfillRequest", function () {
    async function lockOne(ctx: Awaited<ReturnType<typeof setup>>, requestHash: bigint) {
      await ctx.goldenLock
        .connect(ctx.ambulance)
        .requestAndLock(
          ctx.hospital.address,
          ctx.ambulance.address,
          1,
          requestHash,
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          [1n, 2n, 1n, requestHash],
          "0x"
        );
      return 1;
    }

    it("병원 본인이 직접 호출하면 서명 없이(0x) 확정되어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 601n);

      await ctx.goldenLock.connect(ctx.hospital).fulfillRequest(requestId, "0x");
      const req = await ctx.goldenLock.getRequest(requestId);
      expect(req.status).to.equal(2); // Fulfilled
      expect(await ctx.goldenLock.lockedSlots(ctx.hospital.address)).to.equal(0);
    });

    it("병원의 유효한 서명이 있으면 relayer가 대신 확정할 수 있어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 602n);
      const nonce = await ctx.goldenLock.nonces(ctx.hospital.address);

      const signature = await signFulfillRequest(ctx.hospital, ctx.domain, { requestId, nonce });
      await ctx.goldenLock.connect(ctx.relayer).fulfillRequest(requestId, signature);

      const req = await ctx.goldenLock.getRequest(requestId);
      expect(req.status).to.equal(2);
    });

    it("서명 없이 relayer가 확정하려 하면 revert되어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 603n);

      await expect(ctx.goldenLock.connect(ctx.relayer).fulfillRequest(requestId, "0x")).to.be.revert(ctx.ethers);
    });

    it("오너는 서명 없이도 비상 경로로 확정할 수 있어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 604n);

      await ctx.goldenLock.connect(ctx.owner).fulfillRequest(requestId, "0x");
      const req = await ctx.goldenLock.getRequest(requestId);
      expect(req.status).to.equal(2);
    });
  });

  describe("cancelRequest", function () {
    async function lockOne(ctx: Awaited<ReturnType<typeof setup>>, requestHash: bigint) {
      await ctx.goldenLock
        .connect(ctx.ambulance)
        .requestAndLock(
          ctx.hospital.address,
          ctx.ambulance.address,
          1,
          requestHash,
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          [1n, 2n, 1n, requestHash],
          "0x"
        );
      return 1;
    }

    it("구급대 본인이 직접 취소하면 서명 없이(0x) 슬롯이 반환되어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 701n);

      await ctx.goldenLock.connect(ctx.ambulance).cancelRequest(requestId, "0x");
      const req = await ctx.goldenLock.getRequest(requestId);
      expect(req.status).to.equal(4); // Cancelled
      expect(await ctx.goldenLock.lockedSlots(ctx.hospital.address)).to.equal(0);
    });

    it("구급대의 유효한 서명이 있으면 relayer가 대신 취소할 수 있어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 702n);
      const nonce = await ctx.goldenLock.nonces(ctx.ambulance.address);

      const signature = await signCancelRequest(ctx.ambulance, ctx.domain, { requestId, nonce });
      await ctx.goldenLock.connect(ctx.relayer).cancelRequest(requestId, signature);

      const req = await ctx.goldenLock.getRequest(requestId);
      expect(req.status).to.equal(4);
    });

    it("병원이 구급대인 척 서명해도 revert되어야 한다", async function () {
      const ctx = await setup();
      const requestId = await lockOne(ctx, 703n);
      const nonce = await ctx.goldenLock.nonces(ctx.ambulance.address);

      const badSignature = await signCancelRequest(ctx.hospital, ctx.domain, { requestId, nonce });
      await expect(ctx.goldenLock.connect(ctx.relayer).cancelRequest(requestId, badSignature)).to.be.revertedWith(
        "GoldenLock: invalid signature"
      );
    });
  });

  describe("expireIfOverdue", function () {
    it("골든타임 초과 후 누구나 호출해 슬롯을 해제할 수 있어야 한다", async function () {
      const { ethers, ambulance, hospital, goldenLock } = await setup();
      const requestHash = 888n;

      await goldenLock
        .connect(ambulance)
        .requestAndLock(
          hospital.address,
          ambulance.address,
          3,
          requestHash,
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          [1n, 2n, 1n, requestHash],
          "0x"
        );

      await ethers.provider.send("evm_increaseTime", [15 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await goldenLock.expireIfOverdue(1);
      const req = await goldenLock.getRequest(1);
      expect(req.status).to.equal(3); // Expired
      expect(await goldenLock.lockedSlots(hospital.address)).to.equal(0);
    });
  });
});
