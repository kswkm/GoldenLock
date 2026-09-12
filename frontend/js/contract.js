// ============================================================================
// contract.js — GoldenLock.sol 온체인 조회 전용 레이어.
//
// 이 프론트는 "가스리스 relayer" 아키텍처를 그대로 따른다: 실제 트랜잭션
// (requestAndLock / fulfillRequest / cancelRequest)은 relay-server가 socket
// 이벤트를 받아 trustedRelayer 지갑으로 대납해서 쏜다. 브라우저는 지갑 서명 없이도
// 동작해야 하므로, 여기서는 읽기 전용(Provider) 연결과 이벤트 구독만 담당한다.
// MetaMask 연결은 "내 주소 자동 채움" 편의용.
//
// relay-server/src/web3/goldenLockAbi.ts 와 동일한 최소 ABI를 사용한다.
// ============================================================================
import { ethers } from "https://esm.sh/ethers@6.13.4";

export const GOLDEN_LOCK_ABI = [
  "function requestAndLock(address hospital, address ambulanceOperator, uint8 ktasLevel, uint256 requestHash, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[4] publicSignals, bytes ambulanceSignature) external returns (uint256 requestId)",
  "function fulfillRequest(uint256 requestId, bytes hospitalSignature) external",
  "function cancelRequest(uint256 requestId, bytes ambulanceSignature) external",
  "function expireIfOverdue(uint256 requestId) external",
  "function isRegisteredHospital(address hospital) view returns (bool)",
  "function availableSlots(address hospital) view returns (uint256)",
  "function totalSlots(address hospital) view returns (uint256)",
  "function lockedSlots(address hospital) view returns (uint256)",
  "function trustedRelayer() view returns (address)",
  "function requestCounter() view returns (uint256)",
  "function nonces(address actor) view returns (uint256)",
  "function getRequest(uint256 requestId) view returns (tuple(address ambulanceOperator, address hospital, uint8 ktasLevel, uint256 requestedAt, uint256 lockDeadline, uint8 status))",

  "event HospitalRegistered(address indexed hospital, address verifier, uint256 totalSlots)",
  "event RequestCreated(uint256 indexed requestId, address indexed ambulanceOperator, address indexed hospital, uint8 ktasLevel)",
  "event ResourceLocked(uint256 indexed requestId, address indexed hospital, uint256 deadline)",
  "event RequestFulfilled(uint256 indexed requestId)",
  "event RequestExpired(uint256 indexed requestId)",
  "event RequestCancelled(uint256 indexed requestId)",
];

// GoldenLock.sol의 EIP712("GoldenLock", "1") 및 relay-server/src/web3/goldenLockAbi.ts와 반드시 일치해야 한다.
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

let readProvider = null;
let browserProvider = null;
let signer = null;
let contractAddress = null;

export function initReadProvider(rpcUrl, contractAddr) {
  contractAddress = contractAddr || null;
  readProvider = new ethers.JsonRpcProvider(rpcUrl);
  return readProvider;
}

export function getReadContract() {
  if (!readProvider) throw new Error("read provider가 초기화되지 않았습니다.");
  if (!contractAddress) throw new Error("GoldenLock 컨트랙트 주소가 설정되지 않았습니다. 상단 '설정'에서 입력하세요.");
  return new ethers.Contract(contractAddress, GOLDEN_LOCK_ABI, readProvider);
}

/** MetaMask 등 EIP-1193 지갑 연결. 서명은 하지 않고 "내 주소" 표시용으로만 사용. */
export async function connectWallet() {
  if (!window.ethereum) throw new Error("브라우저 지갑(MetaMask 등)을 찾을 수 없습니다.");
  browserProvider = new ethers.BrowserProvider(window.ethereum);
  await browserProvider.send("eth_requestAccounts", []);
  signer = await browserProvider.getSigner();
  const address = await signer.getAddress();
  const network = await browserProvider.getNetwork();
  return { address, chainId: network.chainId.toString() };
}

export function getSignerAddress() {
  return signer ? signer.getAddress() : Promise.resolve(null);
}

/** 지갑 서명 인증(challenge/response)용 — 트랜잭션이 아니라 메시지 서명이라 가스비가 들지 않는다. */
export async function signChallengeMessage(message) {
  if (!signer) throw new Error("지갑이 연결되지 않았습니다. 먼저 지갑을 연결하세요.");
  return signer.signMessage(message);
}

async function getDomain() {
  if (!contractAddress) throw new Error("GoldenLock 컨트랙트 주소가 설정되지 않았습니다.");
  if (!readProvider) throw new Error("RPC가 아직 연결되지 않았습니다.");
  if (!signer) throw new Error("지갑이 연결되지 않았습니다. 먼저 지갑을 연결하세요.");
  // 지갑(MetaMask)이 현재 어느 체인을 보고 있는지가 아니라, GoldenLock이 실제로
  // 배포된 체인(readProvider가 연결된 RPC)의 chainId를 써야 한다. EIP-712 서명은
  // 트랜잭션이 아니라 메시지 서명이라 지갑이 그 체인에 "연결"되어 있을 필요가 없다 —
  // 여기서 browserProvider.getNetwork()(지갑이 현재 선택된 네트워크)를 쓰면, 지갑이
  // 다른 체인을 보고 있을 때 온체인 도메인 분리자와 어긋나 모든 서명이 이유를 알기
  // 어려운 채로 "invalid signature"에 실패한다.
  const network = await readProvider.getNetwork();
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: network.chainId,
    verifyingContract: contractAddress,
  };
}

export async function readNonce(address) {
  return getReadContract().nonces(address);
}

/** GoldenLock.sol::requestAndLock을 relayer가 대납할 때 필요한 EIP-712 서명 (구급대가 생성). */
export async function signRequestLock({ hospital, ambulanceOperator, ktasLevel, requestHash }) {
  if (!signer) throw new Error("지갑이 연결되지 않았습니다. 먼저 지갑을 연결하세요.");
  const domain = await getDomain();
  const nonce = await readNonce(ambulanceOperator);
  return signer.signTypedData(domain, REQUEST_LOCK_TYPES, {
    hospital,
    ambulanceOperator,
    ktasLevel,
    requestHash,
    nonce,
  });
}

/** GoldenLock.sol::fulfillRequest을 relayer가 대납할 때 필요한 EIP-712 서명 (병원이 생성). */
export async function signFulfillRequest({ requestId, hospitalAddress }) {
  if (!signer) throw new Error("지갑이 연결되지 않았습니다. 먼저 지갑을 연결하세요.");
  const domain = await getDomain();
  const nonce = await readNonce(hospitalAddress);
  return signer.signTypedData(domain, FULFILL_REQUEST_TYPES, { requestId, nonce });
}

/** GoldenLock.sol::cancelRequest을 relayer가 대납할 때 필요한 EIP-712 서명 (구급대가 생성). */
export async function signCancelRequest({ requestId, ambulanceOperator }) {
  if (!signer) throw new Error("지갑이 연결되지 않았습니다. 먼저 지갑을 연결하세요.");
  const domain = await getDomain();
  const nonce = await readNonce(ambulanceOperator);
  return signer.signTypedData(domain, CANCEL_REQUEST_TYPES, { requestId, nonce });
}

export async function readRequestCounter() {
  return getReadContract().requestCounter();
}

export async function readRequest(requestId) {
  return getReadContract().getRequest(requestId);
}

export async function readAvailableSlots(hospitalAddress) {
  return getReadContract().availableSlots(hospitalAddress);
}

/** RequestCreated ~ RequestCancelled 전 이벤트를 구독해 콜백으로 흘려보낸다 (관제 모니터용). */
export function subscribeChainEvents(onEvent) {
  const c = getReadContract();
  const names = [
    "HospitalRegistered",
    "RequestCreated",
    "ResourceLocked",
    "RequestFulfilled",
    "RequestExpired",
    "RequestCancelled",
  ];
  const handlers = [];
  for (const name of names) {
    const handler = (...args) => {
      const event = args[args.length - 1];
      onEvent(name, args.slice(0, -1), event);
    };
    c.on(name, handler);
    handlers.push([name, handler]);
  }
  return () => handlers.forEach(([name, handler]) => c.off(name, handler));
}

export function fieldPrime() {
  // BN254 (alt_bn128) scalar field — circom/snarkjs groth16 기본 곡선
  return 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
}
