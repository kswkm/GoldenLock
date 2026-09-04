# GoldenLock

GoldenLock coordinates emergency resource allocation through five layers:

1. `ai-engine/`: KTAS triage and resource-code prediction on port 8000.
2. `backend/`: FastAPI gateway, timeout/error boundary, and AI service policy on port 5000.
3. `relay-server/`: authenticated Socket.IO matching and relayed on-chain transactions on port 4000.
4. `contracts/`: `GoldenLock.sol` atomic resource reservation contract.
5. `web-dashboard/`: Next.js ambulance, hospital, and demo interfaces on port 3000.

The supported integration path is `relay-server -> backend -> ai-engine`. The relay never
calls the model service directly in the default configuration.

## Local run

Start each service in its own terminal, in this order:

```bash
# 1. Local blockchain
cd contracts && npx hardhat node --hostname 127.0.0.1 --port 8545

# 2. Deploy the contract (new terminal)
cd contracts && npm run deploy:local
# copy the printed GoldenLock address into relay-server/.env as GOLDEN_LOCK_ADDRESS

# 3. AI engine (new terminal)
cd ai-engine && source .venv/Scripts/activate && ALLOW_RULE_BASED_FALLBACK=true python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. API gateway (new terminal)
cd backend && pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 5000

# 5. relay-server (new terminal)
cd relay-server && npm install && npm run dev

# 6. web-dashboard (new terminal)
cd web-dashboard && npm install && npm run dev
```

Copy `relay-server/.env.example` to `.env` and set `GOLDEN_LOCK_ADDRESS`, `DATABASE_URL`,
`REDIS_URL`, `AUTH_JWT_SECRET`, and `ALLOW_DEMO_PROOF=false`. The dashboard first logs in through
`/auth/login` and then connects with its short-lived session token. Hospital capacity responses must contain a
real Groth16 proof and an EIP-712 signature over the `Availability` typed data; zero proofs are
accepted only when `ALLOW_DEMO_PROOF=true` in a local demo.

For a containerized local stack, use `docker compose up --build`. The blockchain container is a
local Hardhat node only; deploy the contract first and pass its address through
`GOLDEN_LOCK_ADDRESS`. Do not use the default private key or API key outside local development.

For a deployment using a managed RPC and a real verifier, use
`docker compose -f docker-compose.production.yml up --build -d` after exporting all required
variables from `.env.example`. The production compose file does not run a local blockchain and
does not permit MockVerifier or demo proof fallback.

Sessions are short-lived JWTs backed by Redis, while user records and matching state are stored in
PostgreSQL. Provision users through a restricted deployment migration or admin tool; there is no
public signup endpoint. Role-based authorization is enforced for hospital, ambulance, and
operator Socket.IO events. A generated Groth16 `Verifier.sol`
must be placed at `contracts/contracts/Verifier.sol` before production; the checked-in
`MockVerifier` is test-only.

> Windows note: `ts-node-dev --respawn` can fail to release port 4000 on restart (`EADDRINUSE`). If that happens:
> ```bash
> for p in $(netstat -ano | findstr :4000 | findstr LISTENING | awk '{print $NF}' | sort -u); do taskkill //PID $p //F; done
> npm run dev
> ```

Health checks: `curl http://localhost:8000/health`, `curl http://localhost:5000/health`, `curl http://localhost:4000/health`, `curl -I http://localhost:3000/demo`.

Open `http://localhost:3000/demo`. Register the hospital with a wallet, then submit an ambulance request. The relay calls the backend gateway, requests a signed hospital capacity proof, and submits the atomic lock. A successful run emits `triage:completed` → `hospital:capacity-request` → `hospital:capacity-proof-sent` → `match:found` → `match:lock-requested` → `match:lock-onchain` in the demo's event log.



## 계층별 역할
계층	위치	역할
web-dashboard	3000	구급대/병원 UI, Socket.IO 클라이언트
relay-server	4000	인증, 실시간 매칭, 가스 대납 relayer
ai-engine	8000	KTAS 중증도 분류 (FastAPI)
contracts	8545 (로컬 hardhat)	GoldenLock.sol 원자적 락 컨트랙트


## 요청 흐름 (실제 코드 기준)
로그인 — DemoConsole.tsx가 마운트 시 hospital/ambulance 데모 계정으로 /auth/login 자동 호출 → JWT 2개 발급 → Socket.IO 연결 2개(병원용/구급대용) 생성
병원 등록 — "병원 등록 및 가용화" 클릭 → hospital:join, hospital:update-availability emit → matchingService.ts의 인메모리(또는 Postgres) 레지스트리에 등록
AI 분류 요청 — "AI 분류 후 매칭" 클릭 → ambulance:request-triage-match emit → matchSocket.ts가 AI_API_URL(ai-engine)에 /predict-ktas 호출 → KTAS 등급/자원코드 수신 → triage:completed 응답
병원 매칭 탐색 — findBestHospital()로 자원코드+거리 기준 최적 병원 탐색 → match:found 브로드캐스트
병원 가용성 온체인 증명 — 서버가 병원 소켓에 hospital:capacity-request 전송 → 클라이언트가 ZK proof(+ 가능하면 EIP-712 서명, 없으면 ALLOW_DEMO_PROOF 경로) 응답 → relayer.ts가 submitAvailabilityProof(For) 트랜잭션 전송
자원 락 요청 — relayer.requestLock() → GoldenLock.sol의 requestLock() 호출 → match:lock-requested → 트랜잭션 컨펌 후 match:lock-onchain
수용 확정/해제 — 병원이 "수용 확정" 클릭 시 confirmAcceptance, 이송 취소 시 releaseLock 온체인 호출


## 로컬 직접 실행 방법 (검증된 순서)
터미널 5개를 열어 각각 실행:
# 1) 로컬 블록체인
cd contracts && npx hardhat node --hostname 127.0.0.1 --port 8545

# 2) 컨트랙트 배포 (새 터미널)
cd contracts && npm run deploy:local
# 출력된 GoldenLock 주소를 relay-server/.env 의 GOLDEN_LOCK_ADDRESS에 반영

# 3) AI 엔진 (새 터미널)
cd ai-engine && source .venv/Scripts/activate
ALLOW_RULE_BASED_FALLBACK=true python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4) relay-server (새 터미널)
cd relay-server && npm run dev

# 5) web-dashboard (새 터미널)
cd web-dashboard && npm run dev

브라우저에서 http://localhost:3000/demo 접속 → 로그인 화면 없이 바로 "병원 등록 및 가용화" → "AI 분류 후 매칭" 클릭.


## 로컬 전용 우회 장치
항목	운영(production)	지금(로컬)
저장소	PostgreSQL	MemoryStore (재시작 시 초기화)
인증	JWT + Redis 세션 + DB 사용자	LocalAuthService 고정 계정(hospital/ambulance/operator)
병원 서명	MetaMask EIP-712 서명 필수	ALLOW_DEMO_PROOF=true로 서명 생략 허용
트리거	DATABASE_URL 환경변수 존재 여부로 자동 분기	.env에 DATABASE_URL 없음


1. 저장소/인증 우회 (MemoryStore + LocalAuthService)
index.ts에서 DATABASE_URL 환경변수의 존재 여부만으로 자동 분기합니다.

const LOCAL_DEV_MODE = !process.env.DATABASE_URL;

끄고 싶으면(운영 경로로 전환): .env에 DATABASE_URL, REDIS_URL, AUTH_JWT_SECRET을 채우고 실제 Postgres/Redis를 띄운 뒤 재시작 → 자동으로 PostgresStore + AuthService(JWT+Redis 세션+DB 계정) 사용
켜고 싶으면(로컬 데모 유지): DATABASE_URL을 비우거나 .env에서 삭제 → MemoryStore + LocalAuthService(고정 계정 hospital/ambulance/operator) 사용
토글 방법: .env에서 한 줄만 주석 처리/해제하면 됩니다.
# DATABASE_URL=postgresql://...   ← 주석 처리하면 로컬 모드


2. 병원 서명(MetaMask) 우회
.env의 ALLOW_DEMO_PROOF 플래그로 제어됩니다.

ALLOW_DEMO_PROOF=true   # 서명 없이 데모 진행 가능
ALLOW_DEMO_PROOF=false  # MetaMask EIP-712 서명 필수 (운영 기본값)

matchSocket.ts에서 서명이 없을 때 이 플래그를 확인해 우회 여부를 결정합니다.


## 적용 방법
두 값 모두 .env 파일 수정 후 relay-server 재시작이 필요합니다 (ts-node-dev --respawn이 파일 변경 시 자동 재시작하지만, .env는 코드 파일이 아니라서 자동 감지되지 않으므로 수동 재시작 필요).

cd relay-server
# .env 수정 후
npm run dev   # 재시작

요약하면, 하나는 인프라(DB) 존재 여부로, 하나는 명시적 플래그로 각각 독립적으로 켜고 끌 수 있습니다. 둘 다 꺼도(운영 모드) 되고, 하나만 켤 수도 있습니다 (예: 실제 Postgres는 쓰되 서명은 생략하는 조합도 가능).


## 껐을 때(운영 모드) vs 켰을 때(로컬 모드) 차이
단계	우회 OFF (운영)	우회 ON (로컬)
로그인	AuthService — Postgres app_users 조회 + bcrypt 검증	LocalAuthService — 코드에 고정된 3개 계정
세션 저장	Redis (session:{jti})	프로세스 메모리 Map
매칭 상태 저장	Postgres matching_state 테이블 (재시작해도 유지)	인메모리 (재시작 시 초기화)
병원 가용성 증명	MetaMask로 EIP-712 서명 → submitAvailabilityProofFor (서명 검증)	서명 없이 submitAvailabilityProof (검증 생략)
필요 인프라	PostgreSQL, Redis, MetaMask 지갑	없음


## 요청 흐름 (운영 모드)
로그인 폼에서 username/password 전송 → AuthService가 Postgres에서 계정 조회 후 bcrypt로 비밀번호 검증
검증 성공 시 JWT 발급, jti(세션 ID)를 Redis에 저장
프론트가 이 JWT를 Socket.IO 핸드셰이크(auth.token)에 담아 연결 → 서버가 매 연결마다 JWT 서명 검증 + Redis 세션 존재 여부 확인
4~5. 병원이 가용성을 갱신할 때 브라우저가 MetaMask로 Availability(hospital, resourceCode, isAvailable, nonce) EIP-712 타입 데이터에 서명
relay가 ai-engine에 KTAS 예측 요청
서명이 있어야만 submitAvailabilityProofFor(컨트랙트가 digest.recover(signature) == hospital 검증)를 호출 — 서명이 없으면 (ALLOW_DEMO_PROOF=false이므로) 요청 자체가 실패
온체인 트랜잭션 전송 → 락 요청/확정도 동일하게 relayer를 통해 처리되지만, 사용자 권한 검증은 이제 JWT의 role/organizationId/walletAddress로 이뤄집니다.