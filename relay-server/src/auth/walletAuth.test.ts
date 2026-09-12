import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { WalletAuth, buildChallengeMessage } from "./walletAuth";

describe("WalletAuth", () => {
  it("올바른 서명이면 인증에 성공하고 이후 isAuthenticatedAs가 true를 반환한다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();
    const socketId = "socket-1";

    const challenge = auth.issueChallenge(socketId, wallet.address);
    const signature = await wallet.signMessage(challenge.message);

    const ok = auth.verify(socketId, wallet.address, signature);
    assert.equal(ok, true);
    assert.equal(auth.isAuthenticatedAs(socketId, wallet.address), true);
  });

  it("다른 지갑이 서명하면 인증에 실패해야 한다", async () => {
    const auth = new WalletAuth();
    const realWallet = Wallet.createRandom();
    const impostor = Wallet.createRandom();
    const socketId = "socket-2";

    const challenge = auth.issueChallenge(socketId, realWallet.address);
    // impostor가 realWallet인 척 서명 시도 — 메시지 자체는 realWallet 주소로 발급된 것
    const badSignature = await impostor.signMessage(challenge.message);

    const ok = auth.verify(socketId, realWallet.address, badSignature);
    assert.equal(ok, false);
    assert.equal(auth.isAuthenticatedAs(socketId, realWallet.address), false);
  });

  it("challenge를 발급받지 않은 소켓의 verify는 실패해야 한다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();
    const fakeSignature = "0x" + "00".repeat(65);

    const ok = auth.verify("never-issued", wallet.address, fakeSignature);
    assert.equal(ok, false);
  });

  it("challenge는 한 번 성공적으로 소비되면 재사용할 수 없다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();
    const socketId = "socket-3";

    const challenge = auth.issueChallenge(socketId, wallet.address);
    const signature = await wallet.signMessage(challenge.message);

    assert.equal(auth.verify(socketId, wallet.address, signature), true);
    // 같은 서명으로 다시 verify 시도 — challenge가 이미 소비(삭제)되어 실패해야 함
    assert.equal(auth.verify(socketId, wallet.address, signature), false);
  });

  it("다른 socketId로 인증된 지갑은 이 socketId에서는 인증된 것으로 간주되지 않는다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();

    const challenge = auth.issueChallenge("socket-A", wallet.address);
    const signature = await wallet.signMessage(challenge.message);
    auth.verify("socket-A", wallet.address, signature);

    assert.equal(auth.isAuthenticatedAs("socket-A", wallet.address), true);
    assert.equal(auth.isAuthenticatedAs("socket-B", wallet.address), false);
  });

  it("clear() 이후에는 인증 상태가 사라져야 한다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();
    const socketId = "socket-4";

    const challenge = auth.issueChallenge(socketId, wallet.address);
    const signature = await wallet.signMessage(challenge.message);
    auth.verify(socketId, wallet.address, signature);
    assert.equal(auth.isAuthenticatedAs(socketId, wallet.address), true);

    auth.clear(socketId);
    assert.equal(auth.isAuthenticatedAs(socketId, wallet.address), false);
  });

  it("만료된 challenge에 대한 서명은 거부되어야 한다", async () => {
    const auth = new WalletAuth();
    const wallet = Wallet.createRandom();
    const socketId = "socket-5";

    const challenge = auth.issueChallenge(socketId, wallet.address);
    const signature = await wallet.signMessage(challenge.message);

    // 내부 challenge의 발급 시각을 과거로 돌려 TTL(2분)을 넘긴 것처럼 만든다.
    const internalChallenges = (auth as unknown as { challenges: Map<string, { issuedAt: number }> }).challenges;
    const record = internalChallenges.get(socketId);
    if (!record) {
      throw new Error("테스트 설정 오류: challenge가 저장되어 있어야 합니다.");
    }
    record.issuedAt = Date.now() - 3 * 60 * 1000;

    const ok = auth.verify(socketId, wallet.address, signature);
    assert.equal(ok, false);
  });

  it("buildChallengeMessage는 nonce/주소가 다르면 다른 메시지를 만든다", () => {
    const m1 = buildChallengeMessage("0xabc", "nonce1", 1000);
    const m2 = buildChallengeMessage("0xabc", "nonce2", 1000);
    assert.notEqual(m1, m2);
  });
});
