import { ethers } from "ethers";
import { GOLDEN_LOCK_ABI } from "./goldenLockAbi";

/**
 * Relayer
 * -------
 * relay-server가 소유한 지갑(trustedRelayer, GoldenLock.sol의 trustedRelayer와 동일 주소)으로
 * 병원/구급대를 대신해 가스비를 대납하며 트랜잭션을 제출한다.
 *
 * 이렇게 하면 구급대원/병원 단말은 지갑 앱이나 가스비 없이도 UI 클릭만으로
 * 실제 온체인 락을 걸 수 있다 (meta-tx 패턴의 단순화 버전).
 *
 * 주의: 이 데모 구현은 "relayer가 곧 신뢰 주체"라는 전제를 깔고 있다.
 *       실서비스에서는 EIP-712 서명 위임(permit 유사 패턴)으로 각 행위자의
 *       서명을 검증한 뒤 relayer가 대납하는 방식으로 강화해야 한다.
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

  /** 환자 케이스 ID를 온체인에 그대로 올리지 않고 해시로 변환 (PII 비노출) */
  hashPatientRef(caseId: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(caseId));
  }

  /**
   * 병원이 (오프체인에서 이미 생성한) ZK 증명을 온체인에 제출한다.
   * 증명 생성 자체는 web-dashboard의 useZkProver 훅에서 브라우저 SnarkJS로 수행되고,
   * relayer는 그 결과(proof + public signals)를 받아 트랜잭션만 대납한다.
   */
  async submitAvailabilityProof(
    resourceCode: number,
    isAvailable: 0 | 1,
    proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] }
  ) {
    const tx = await this.contract.submitAvailabilityProof(
      resourceCode,
      isAvailable,
      proof.a,
      proof.b,
      proof.c
    );
    return tx.wait();
  }

  /**
   * 구급대를 대신해 자원 락을 요청한다.
   * @returns 트랜잭션 영수증과, LockRequested 이벤트에서 파싱한 lockId
   */
  async requestLock(params: {
    hospitalAddress: string;
    resourceCode: number;
    patientCaseId: string;
    requesterAddress: string;
  }): Promise<{ txHash: string; lockId: number }> {
    const patientRef = this.hashPatientRef(params.patientCaseId);

    const tx = await this.contract.requestLock(
      params.hospitalAddress,
      params.resourceCode,
      patientRef,
      params.requesterAddress
    );
    const receipt = await tx.wait();

    const lockId = this.parseLockIdFromReceipt(receipt);
    return { txHash: receipt.hash, lockId };
  }

  async confirmAcceptance(lockId: number): Promise<string> {
    const tx = await this.contract.confirmAcceptance(lockId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async releaseLock(lockId: number): Promise<string> {
    const tx = await this.contract.releaseLock(lockId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async expireLock(lockId: number): Promise<string> {
    const tx = await this.contract.expireLock(lockId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async isAvailable(hospitalAddress: string, resourceCode: number): Promise<boolean> {
    return this.contract.availability(hospitalAddress, resourceCode);
  }

  /**
   * 온체인 이벤트를 구독해 다른 relayer/서버 인스턴스나 감사(audit) 로그가
   * 상태 변화를 실시간으로 반영할 수 있게 한다. matchSocket.ts에서 호출해
   * 브로드캐스트와 연결한다.
   */
  onLockConfirmed(callback: (lockId: number, hospital: string) => void) {
    this.contract.on("LockConfirmed", (lockId: bigint, hospital: string) => {
      callback(Number(lockId), hospital);
    });
  }

  onLockExpired(callback: (lockId: number) => void) {
    this.contract.on("LockExpired", (lockId: bigint) => {
      callback(Number(lockId));
    });
  }

  private parseLockIdFromReceipt(receipt: ethers.ContractTransactionReceipt): number {
    for (const log of receipt.logs) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name === "LockRequested") {
          return Number(parsed.args.lockId);
        }
      } catch {
        // GoldenLock 이벤트가 아닌 로그는 무시
      }
    }
    throw new Error("LockRequested event not found in transaction receipt");
  }
}
