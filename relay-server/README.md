# relay-server — 매칭 + 가스리스 Web3 relayer

구급차 ↔ 병원 실시간 매칭(Socket.io)과, 병원/구급대를 대신해 가스비를 대납하는
Web3 relayer(Ethers.js)를 함께 제공한다.

## 실행 순서

### 1) 컨트랙트가 먼저 배포되어 있어야 한다

```bash
cd ../contracts
npm install
npx hardhat node                 # 터미널 1: 로컬 체인 기동
npm run deploy:local             # 터미널 2: Verifier + GoldenLock 배포, 테스트 병원 등록
```

### 2) relay-server 기동

```bash
cd relay-server
cp .env.example .env
# .env 에 RELAYER_PRIVATE_KEY(로컬 hardhat 테스트 계정 키)와
# GOLDEN_LOCK_ADDRESS(1단계 로그의 주소)를 채워 넣는다.
# 이 지갑 주소가 GoldenLock.trustedRelayer로 등록되어 있어야 대리 호출이 성공한다.
npm install
npm run dev
```

### 3) 테스트

```bash
npm test   # matchingService / walletAuth / zod 스키마 단위 테스트 (node:test + tsx, 네트워크 불필요)
```

## 보안 모델

relay-server는 세 겹의 방어선을 갖는다 — 아무 하나가 뚫려도 나머지가 막는다.

1. **스키마 검증 (`src/schemas.ts`)** — 모든 인바운드 소켓 페이로드는 zod로 검증한다.
   형식이 안 맞으면 `"validation:error"`를 emit하고 처리하지 않는다.
2. **지갑 서명 인증 (`src/auth/walletAuth.ts`)** — `hospitalAddress`/`ambulanceAddress`를
   자처하는 모든 이벤트는 먼저 그 주소의 개인키로 challenge 메시지에 서명해야 한다
   (`"auth:request-challenge"` → `"auth:verify"`, 가스비 없음). 인증은 소켓 연결 단위로
   유효하며 연결이 끊기면 무효화된다. 추가로 병원 관련 이벤트는 온체인
   `isRegisteredHospital(address)`까지 확인한다.
3. **온체인 EIP-712 서명 (`contracts/contracts/GoldenLock.sol`)** — relay-server 자체가
   전부 뚫리더라도, `requestAndLock`/`fulfillRequest`/`cancelRequest`는 실제 행위자가
   서명한 값 없이는 온체인에서 그대로 revert된다.

레이트 리밋(`src/utils/rateLimiter.ts`)은 인증된 주소라도 트랜잭션(가스)을 유발하는
이벤트를 짧은 시간에 반복 호출해 relayer의 가스를 소모시키는 것을 완화한다
(기본: 주소당 분당 10회).

## 동작 흐름

```
[구급대 콘솔]                                                       [relay-server]                         [GoldenLock.sol]
  auth:request-challenge → auth:challenge → auth:verify(서명) ---> 지갑 소유 증명 완료
  socket "ambulance:request-match" ---------------------------->  findBestHospital()
                                                                    (hasCapacity 방송 기준, 오프체인 라우팅)
                                                                    socket "match:found" → 양쪽에 통지

[구급대 콘솔]  match:found 수신 즉시:
  requestHash를 독립 계산 → RequestLock(hospital, ambulanceOperator,
  ktasLevel, requestHash, nonce) EIP-712 서명
  socket "ambulance:authorize-lock" ----------------------------> 매치에 서명 저장, "match:authorized" 브로드캐스트

[병원 콘솔]  match:found 수신 → 브라우저에서 ZK 증명 생성
  (private: availableBeds/Specialists/secret, public: requiredBeds/Specialists/requestHash)
  socket "hospital:submit-request-proof" ------------------------> relayer.requestAndLock(..., ambulanceSignature) --> requestAndLock()
                                                                    <---- RequestCreated/ResourceLocked                    (원자적 락 + 서명 검증)
                                                                    socket "match:lock-onchain" 로 양쪽에 브로드캐스트

[병원 콘솔]  FulfillRequest(requestId, nonce) EIP-712 서명
  socket "hospital:confirm-acceptance" ---------------------------> relayer.fulfillRequest(requestId, hospitalSignature) --> fulfillRequest()
```

## 알려진 단순화 (데모 스코프)

- relayer 지갑 자체는 여전히 "이 트랜잭션을 실제로 브로드캐스트할지"를 결정하는
  단일 주체다 — EIP-712 서명이 relayer의 대필 자체를 막지는 못하고, "누구를 대신해
  대필했는지"를 위조하지 못하게 할 뿐이다. relayer가 특정 유효한 요청의 브로드캐스트를
  검열(거부)하는 것 자체는 여전히 가능하다.
- 병원 레지스트리/매칭 상태/인증 세션은 인메모리다. 다중 인스턴스 운영 시 Redis 등
  외부 스토어로 교체할 것.
- 레이트 리밋도 인스턴스 로컬 메모리 기반이다.

## 이 패키지의 유래 (통합 노트)

이전 zip에는 `backend/relay-server`와 `frontend/relay-server`에 사실상 동일한 코드가
중복되어 있었고, 둘 다 지금은 폐기된 "Lock/availability" 컨트랙트를 호출하고
있었으며 소켓 계층에 인증이 전혀 없었다(matchId만 알면 누구나 병원/구급대 행세가
가능했다). 이 패키지는 그 둘을 하나로 합치고, 실제 ZK 회로와 정합한 컨트랙트에
맞춰 매칭 로직·타입·ABI를 다시 작성한 뒤, 외부 검토에서 지적된 인증 부재와 relayer
단일신뢰 문제를 지갑 서명 인증 + EIP-712 서명 검증으로 보강했다.
