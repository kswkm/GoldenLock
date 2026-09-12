import { ethers } from "ethers";
import { GOLDEN_LOCK_ABI } from "./goldenLockAbi";
import { ProofArgs, PublicSignals } from "../types";

/**
 * Relayer
 * -------
 * relay-server가 소유한 지갑(trustedRelayer, GoldenLock.sol의 trustedRelayer와 동일 주소)으로
 * 병원/구급대를 대신해 가스비를 대납하며 트랜잭션을 제출한다.
 *
 * v2: GoldenLock.sol이 EIP-712 서명 검증을 요구하므로, 여기서 만드는 모든 대리
 * 트랜잭션에는 실제 행위자(구급대/병원)가 미리 서명한 값을 함께 실어 보낸다.
 * relayer 자신의 개인키만으로는 아무 것도 대리할 수 없다 — 서명이 없거나
 * 틀리면 온체인에서 그대로 revert된다. 즉 이 지갑이 탈취되어도 실제 행위자의
 * 서명 없이는 임의 주소를 대리해 요청을 만들 수 없다.
 */
export class Relayer {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;

  constructor(rpcUrl: string, privateKey: string, contractAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, GOLDEN_LOCK_ABI, this.wallet);
  }

  get relayerAddress(): string {
    return this.wallet.address;
  }

  async isRegisteredHospital(hospitalAddress: string): Promise<boolean> {
    return this.contract.isRegisteredHospital(hospitalAddress);
  }

  async nonceOf(address: string): Promise<bigint> {
    return this.contract.nonces(address);
  }

  /**
   * 병원이 (브라우저 SnarkJS로) 생성한 ZK 증명 + 구급대가 미리 서명한 EIP-712
   * 서명(ambulanceSignature)을 실어 requestAndLock을 대납 호출한다.
   *
   * @returns 트랜잭션 영수증 정보와, RequestCreated 이벤트에서 파싱한 requestId
   */
  async requestAndLock(params: {
    hospitalAddress: string;
    ambulanceOperatorAddress: string;
    ktasLevel: number;
    requestHash: string; // decimal string, publicSignals[3]와 동일해야 함
    proof: ProofArgs;
    publicSignals: PublicSignals;
    ambulanceSignature: string;
  }): Promise<{ txHash: string; requestId: number }> {
    const tx = await this.contract.requestAndLock(
      params.hospitalAddress,
      params.ambulanceOperatorAddress,
      params.ktasLevel,
      params.requestHash,
      params.proof.a,
      params.proof.b,
      params.proof.c,
      params.publicSignals,
      params.ambulanceSignature
    );
    const receipt = await tx.wait();

    const requestId = this.parseRequestIdFromReceipt(receipt);
    return { txHash: receipt.hash, requestId };
  }

  async fulfillRequest(requestId: number, hospitalSignature: string): Promise<string> {
    const tx = await this.contract.fulfillRequest(requestId, hospitalSignature);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async cancelRequest(requestId: number, ambulanceSignature: string): Promise<string> {
    const tx = await this.contract.cancelRequest(requestId, ambulanceSignature);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async expireIfOverdue(requestId: number): Promise<string> {
    const tx = await this.contract.expireIfOverdue(requestId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async availableSlots(hospitalAddress: string): Promise<bigint> {
    return this.contract.availableSlots(hospitalAddress);
  }

  /**
   * 온체인 이벤트를 구독해 다른 relayer/서버 인스턴스나 감사(audit) 로그가
   * 상태 변화를 실시간으로 반영할 수 있게 한다. matchSocket.ts에서 호출해
   * 브로드캐스트와 연결한다.
   */
  onRequestFulfilled(callback: (requestId: number) => void) {
    this.contract.on("RequestFulfilled", (requestId: bigint) => {
      callback(Number(requestId));
    });
  }

  onRequestExpired(callback: (requestId: number) => void) {
    this.contract.on("RequestExpired", (requestId: bigint) => {
      callback(Number(requestId));
    });
  }

  private parseRequestIdFromReceipt(receipt: ethers.ContractTransactionReceipt): number {
    for (const log of receipt.logs) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name === "RequestCreated") {
          return Number(parsed.args.requestId);
        }
      } catch {
        // GoldenLock 이벤트가 아닌 로그는 무시
      }
    }
    throw new Error("RequestCreated event not found in transaction receipt");
  }
}
