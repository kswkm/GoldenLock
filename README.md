# GoldenLock

응급환자 골든타임 내에 구급차와 병원 간 의료 자원(병상/전문의 슬롯)을 **원자적으로
확약(lock)**하는 시스템. 병원은 실제 병상/전문의 수를 공개하지 않고 ZK-Proof로
"이 요청을 수용할 수 있다"는 사실만 증명하며, 그 증명이 통과해야만 온체인 슬롯이
소비된다 — 두 구급차가 병원의 마지막 슬롯을 동시에 예약하는 상황을 막는다.

```
GoldenLock-main/
├── contracts/      # GoldenLock.sol (Hardhat 3) — 원자적 락 + 병원별 ZK Verifier 등록
├── zk-circuits/    # hospital_resource.circom — 병상/전문의 수용 가능 여부 ZK 증명
├── relay-server/   # 구급차-병원 실시간 매칭(Socket.io) + 가스리스 Web3 relayer
├── frontend/       # 정적 웹 콘솔 (구급대/병원/관제 3-in-1)
└── ai-engine/      # 활력징후·증상 텍스트 → KTAS 등급 → 필요 병상/전문의 수 추론(FastAPI)
```

## 실행 순서 (로컬 데모)

```bash
# 1) 로컬 체인 + 컨트랙트 배포
cd contracts && npm install
npx hardhat node                              # 터미널 A
npm run deploy:local                          # 터미널 B — Verifier + GoldenLock 배포, 테스트 병원 등록
#   로그에 나오는 GOLDEN_LOCK_ADDRESS를 아래 2), 4)에서 사용

# 2) relay-server
cd ../relay-server && cp .env.example .env    # RELAYER_PRIVATE_KEY, GOLDEN_LOCK_ADDRESS 채우기
npm install && npm test                       # 네트워크 불필요한 단위 테스트로 먼저 확인
npm run dev                                   # :4000

# 3) (선택) ZK 회로를 직접 빌드하려면
cd ../zk-circuits && npm install
npm run compile && npm run generate-verifier  # contracts/contracts/Verifier.sol 자동 교체
#   빌드 산출물을 frontend/circuits/ 로 복사 (frontend/circuits/README.md 참고)

# 4) frontend
cd ../frontend && python3 -m http.server 5173
# 브라우저 접속 → 우측 상단 "설정"에서 Relay URL / RPC URL / 컨트랙트 주소 입력
# 구급대/병원 콘솔의 행동은 지갑 연결 + 서명 인증이 필요하다 (MetaMask 등, 가스비 없음)

# 5) (선택) ai-engine
cd ../ai-engine && pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

각 하위 폴더의 README에 더 자세한 설명이 있다: `contracts/README.md`,
`relay-server/README.md`, `zk-circuits/README.md`, `frontend/README.md`,
`ai-engine/README.md` / `ai-engine/ARCHITECTURE.md`.

## 엔드투엔드 흐름

1. **ai-engine**이 활력징후/증상으로 KTAS 1~5 등급과 `requiredBeds`/`requiredSpecialists`를 산출한다.
2. **구급대 콘솔**이 그 값으로 `relay-server`에 매칭을 요청한다. relay-server는 "지금 받을 수
   있다"고 방송 중인 병원 중 가장 가까운 곳을 골라 양쪽에 알린다 (오프체인 라우팅).
3. **병원 콘솔**은 비공개 병상/전문의 수를 브라우저 밖으로 내보내지 않고, `zk-circuits`
   회로로 "요청 수량을 수용 가능하다"는 ZK 증명을 만든다.
4. 병원이 그 증명을 relay-server로 보내면, relay-server(가스 대납 지갑 = `trustedRelayer`)가
   대신 `GoldenLock.sol::requestAndLock`을 호출해 슬롯을 원자적으로 락한다.
5. 병원이 환자를 실제로 받으면 `fulfillRequest`, 이송이 취소되면 `cancelRequest`, 골든타임
   (15분)을 넘기면 누구나 `expireIfOverdue`를 호출해 슬롯을 정리한다.
6. **관제 모니터**는 온체인 요청 테이블과 relay-server의 병원 레지스트리를 읽기 전용으로 보여준다.

## 통합 결정 사항 (이 리포지토리를 정리하며)

원본 zip은 같은 프로젝트의 서로 다른 세 버전이 조율 없이 한 리포지토리에 합쳐져 있었다.
정리하며 내린 판단과 근거는 다음과 같다.

1. **컨트랙트 설계 통일** — `backend/`에는 `requestLock`/`confirmAcceptance`/`expireLock`
   기반의 "Lock/availability" 설계(2-공개신호 `IVerifier`)가, `blockchain/`에는
   `registerHospital`/`requestAndLock`/`fulfillRequest` 기반의 "EmergencyRequest" 설계
   (4-공개신호 `IGroth16Verifier`, 병원별 verifier)가 있었고, 서로 함수명부터 달라 호환되지
   않았다. `blockchain/README.md`는 "팀원 원본 로직을 100% 보존했다"고 적혀 있었지만 실제
   파일은 완전히 다른 설계였다 — 즉 리포지토리 조립 과정에서 잘못된 초안이 끼어든 것으로
   보인다. 실제로 존재하는 ZK 회로(`hospital_resource.circom`, 세 사본 모두 동일)는
   `requiredBeds`/`requiredSpecialists`/`requestHash` 3개의 public input과 `canAccept`
   output, 총 4개의 public signal을 노출하는데, 이는 EmergencyRequest 설계의
   `IGroth16Verifier`하고만 맞는다. 그래서 **회로와 실제로 정합하는 EmergencyRequest
   설계를 채택**했다.
2. **gasless relayer 패턴 병합** — 다만 EmergencyRequest 설계에는 Lock/availability
   설계에 있던 `trustedRelayer`/대리 호출(메타트랜잭션) 개념이 없었다. relay-server가
   가스비를 대납하는 것이 이 프로젝트의 핵심 가치 제안이므로, `trustedRelayer` +
   `onlySelfOrRelayer` 패턴을 새 컨트랙트에 병합했다 (`ambulanceOperator`를 명시 파라미터로
   받아 relayer가 대신 호출해도 온체인 기록이 relayer 주소로 뒤섞이지 않게 함).
3. **디렉터리 평탄화** — `backend/`, `blockchain/` 래퍼를 없애고 `contracts/`,
   `zk-circuits/`, `relay-server/`를 루트로 올렸다. `frontend/` 안에 들어 있던
   `contracts/`, `relay-server/`, `zk-circuits/`의 스테일 복사본(그마저도 서로 다른 시점의
   구 API를 가리키고 있었다)은 삭제했다 — 정적 프론트는 그 소스들이 필요 없다.
4. **frontend 자체의 자기모순 수정** — 기존 `frontend/js/views/hospital.js`는 이미 실제
   회로에 맞는 4-공개신호 증명을 생성하면서도, 그 증명을 구 설계의 2-공개신호 컨트랙트
   호출(`hospital:submit-onchain-proof`)로 잘못 내보내고 있었고, 그 이벤트명조차
   `matchSocket.ts`가 실제로 듣는 이름과 달랐다. relay-server/frontend/contracts를
   같은 스키마로 다시 맞췄다.
5. **ai-engine 계약 정리** — `resource_mapper.py`가 산출하던 `resource_code`(0x01~0x05)는
   컨트랙트 어디에서도 실제로 쓰이지 않는 참고용 라벨이었다. 새 컨트랙트가 실제로 필요로
   하는 `requiredBeds`/`requiredSpecialists`를 산출값에 추가했다 (`resource_code`는 UI
   표시용으로 유지).
6. **네이밍 정리** — `ai-engine/frontend/`(사용되지 않는 정적 목업 UI)는 루트의
   `frontend/`와 이름이 겹쳐 혼동을 주므로 `ai-engine/demo-ui/`로 이름을 바꿨다.
   `relay-server/tsconfig.json`은 `contracts` 패키지의 tsconfig가 그대로 복사되어
   `./hardhat.config.ts`, `./contracts` 등 존재하지 않는 경로를 include하고 있던 버그를
   고쳤다(빌드가 아예 안 되는 상태였다).

## 보안 강화 (v3 — 외부 검토 반영)

외부 코드 리뷰에서 다음 문제가 지적되었고, 전부 아래와 같이 반영했다.

1. **소켓 계층에 인증이 없었다 (가장 심각)** — `matchId`만 알면 누구나 임의의
   `hospital:confirm-acceptance` 등을 보내 relayer의 실제 트랜잭션(가스)을 유발할 수
   있었다. → `relay-server/src/auth/walletAuth.ts`에 지갑 서명 challenge/response 인증을
   추가했다. `hospitalAddress`/`ambulanceAddress`를 자처하는 모든 이벤트는 이제 그 주소의
   개인키로 서명해야 처리된다. `src/schemas.ts`로 모든 소켓 페이로드에 zod 검증을 추가했고,
   병원 이벤트는 온체인 `isRegisteredHospital`까지 재확인한다. CORS도 `origin: "*"`에서
   설정 가능한 origin으로 좁혔다. 트랜잭션을 유발하는 이벤트에는 주소별 레이트 리밋을 추가했다.
2. **relayer 단일신뢰** — 1번과 결합하면 공격 표면이 컸다. → `GoldenLock.sol`에 EIP-712
   서명 검증을 추가했다: relayer가 탈취되어도, 실제 행위자(구급대/병원)의 서명 없이는
   그 사람을 대리한 요청을 만들 수 없다. 소켓 인증이 전부 뚫리더라도 온체인에서 다시
   한번 막힌다(심층 방어). 자세한 설계는 `contracts/README.md`의 "보안 모델" 참고.
3. **자동화 테스트/CI 부재** — `contracts/`에만 테스트가 있었다. → `relay-server`에
   `node:test` 기반 단위 테스트(매칭 로직, 지갑 인증, zod 스키마 — 전부 네트워크 불필요)를
   추가하고, `contracts`의 서명 검증 테스트도 확장했다. `.github/workflows/ci.yml`로
   contracts 컴파일+테스트, relay-server 빌드+테스트, frontend/ai-engine 구문 검사를
   자동화했다.
4. **ai-engine이 사실상 폴백만 동작** — `ai-engine/data/*.csv`가 실제 데이터가 아니라
   Git LFS 포인터 스텁이라 학습된 모델이 없다. 이건 코드 수정으로 고칠 수 있는 문제가
   아니다(학습 데이터 자체가 없음). 대신 API 응답의 `source`(`"ai_model"` vs
   `"rule_based_fallback"`)와 `warning` 필드가 이미 이 상태를 정직하게 드러내도록 되어
   있는지 확인했다 — 실제 모델 없이 "AI 기반"인 척하지 않는다.
5. **한 번도 직접 실행해본 적 없음** — 이 작업 환경 자체가 npm 레지스트리 접근이 막혀
   있어 `npm install`부터 안 된다. `node --check`/`tsc --noEmit` 수준의 정적 검증과
   전체 파일 간 필드명·이벤트명 수기 대조까지는 했지만, 실제 실행 검증은 여전히 못
   했다. 로컬에서 문제가 발생하면 에러 로그를 붙여줄 것.

## 알려진 한계 / 다음 단계

- `contracts/contracts/Verifier.sol`은 자리표시자다. 프로덕션 전 `zk-circuits`에서
  생성한 실제 Verifier로 반드시 교체할 것.
- EIP-712 서명은 "relayer가 누구를 대리하는지"는 위조하지 못하게 막지만, relayer가
  유효한 요청 자체를 검열(브로드캐스트 거부)하는 것까지 막지는 못한다 — relayer는
  여전히 "이 트랜잭션을 낼지 말지"를 결정하는 단일 주체다.
- relay-server의 병원 레지스트리/매칭 상태/인증 세션/레이트 리밋은 전부 인메모리다.
  다중 인스턴스 운영 시 Redis 등 외부 스토어로 교체할 것.
- ai-engine의 임상 모델은 데모/해커톤 스코프이며, 실제 학습 데이터가 없어 항상
  규칙 기반 폴백으로만 동작한다. 실제 임상 데이터·의료진 검증 없이는 진단·트리아지
  목적으로 사용해서는 안 된다 (`ai-engine/ARCHITECTURE.md` 참고).
