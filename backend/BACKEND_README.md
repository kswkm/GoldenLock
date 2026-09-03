# GoldenLock — Backend Parts (contracts + relay-server)

이번에 만든 두 파트:

1. **contracts/** — `GoldenLock.sol` 원자적 자원 확약 컨트랙트, `MockVerifier.sol`(실제 ZK
   Verifier가 나오기 전 임시 검증기), 배포 스크립트, 테스트
2. **relay-server/** — 구급차 ↔ 병원 실시간 매칭(Socket.io) + Web3 gasless relayer(Ethers.js)

## 실행 순서

### 1) 컨트랙트 배포 (로컬 hardhat 네트워크)

```bash
cd contracts
npm install
npx hardhat node            # 터미널 1: 로컬 체인 기동
npm run deploy:local        # 터미널 2: MockVerifier + GoldenLock 배포
```

배포가 끝나면 `contracts/deployments/<network>.json`에 `GoldenLock` 주소가 저장됩니다.

### 2) relay-server 기동

```bash
cd relay-server
cp .env.example .env
# .env 에 RELAYER_PRIVATE_KEY(로컬 hardhat 테스트 계정 키)와
# GOLDEN_LOCK_ADDRESS(1단계에서 나온 주소)를 채워 넣는다
npm install
npm run dev
```

### 3) 동작 흐름 (해커톤 데모 기준)

```
[병원 대시보드]                [relay-server]                 [GoldenLock.sol]
  useZkProver 훅으로               |                                |
  브라우저에서 ZK 증명 생성 -----> socket "hospital:update-availability" (오프체인 UI 반영)
                                    |
                                (증명 자체는 별도 경로로
                                 submitAvailabilityProof 트랜잭션 제출,
                                 relayer가 가스 대납)  -----------> availability[hospital][code] = true

[구급대 단말]
  AI(KTAS) 결과로 resourceCode 산출
  socket "ambulance:request-match" ----> findBestHospital() 매칭
                                          relayer.requestLock() ----> requestLock() (원자적 락)
                                          <---- LockRequested 이벤트 (lockId, txHash)
                                          socket "match:lock-onchain" 로 양쪽에 브로드캐스트

[병원 대시보드]
  socket "hospital:confirm-acceptance" -> relayer.confirmAcceptance() -> confirmAcceptance()
```

## 다음으로 이어질 파트 (아직 미구현)

- `zk-circuits/`: `hospital_resource.circom` 회로 + 실제 `Verifier.sol` 생성
  → 나오면 `contracts/contracts/Verifier.sol`로 교체하고 `deploy.ts`가 자동으로 이를 사용합니다.
- `ai-engine/`: KTAS 추론 API. `relay-server`의 `AmbulanceMatchRequest.resourceCode`는
  이 서비스의 `resource_mapper.py` 산출값과 동일한 코드 체계(0x01~0x05)를 그대로 사용하도록
  맞춰뒀습니다.
- `web-dashboard/`: `useSocket.ts` / `useZkProver.ts` 훅에서 위 이벤트 이름들을 그대로
  구독/emit하면 됩니다.

## 알려진 단순화(데모 스코프)

- `submitAvailabilityProof`에서 relayer가 병원을 대신 호출할 때 실제 병원 주소를 특정하는
  로직이 단순화되어 있습니다(현재는 `admin` 주소로 대체). 프로덕션에서는 병원의 EIP-712
  서명을 받아 relayer가 이를 검증 후 대납하는 방식으로 교체해야 합니다.
- relayer는 "신뢰된 단일 주체"로 가정합니다. 실서비스에서는 각 행위자 서명 검증이 필요합니다.
- 병원 레지스트리/매칭 상태는 인메모리입니다. 다중 인스턴스 운영 시 Redis 등 외부 스토어로
  교체하세요.
