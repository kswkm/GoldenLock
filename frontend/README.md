# frontend — web console

빌드 도구 없이 브라우저에서 바로 여는 정적 콘솔입니다 (React/Vite 대신 ES 모듈 +
CDN 구성 — `ethers`, `socket.io-client`, `snarkjs`는 각각 esm.sh / jsdelivr CDN에서
로드됩니다. `npm install` 없이 동작합니다).

- `구급대 콘솔` — relay-server에 매칭 요청, 락 라이프사이클(15분 골든타임) 추적
- `병원 콘솔` — 비공개 병상/전문의 수를 브라우저 밖으로 내보내지 않고 ZK 증명 생성·제출, 환자 수용 확정
- `관제 모니터` — GoldenLock.sol 온체인 요청 테이블 + relay-server 병원 레지스트리 읽기 전용 뷰

구급대/병원 콘솔의 모든 행동(join, 가용성 방송, 매칭 요청, 증명 제출, 수용 확정, 취소)은
지갑 연결과 서명 인증이 먼저 필요하다 — relay-server가 그 주소의 개인키 소유를 증명하지
않은 소켓의 요청을 거부한다(`auth.js`, 가스비 없는 메시지 서명일 뿐 트랜잭션 아님).

⚠️ **지갑(MetaMask 등)이 반드시 설정의 RPC URL과 같은 체인에 연결돼 있어야 한다.**
EIP-712 서명의 도메인 `chainId`는 GoldenLock이 실제 배포된 체인 값을 쓰는데, 지갑이 다른
네트워크(예: 이더리움 메인넷)를 보고 있으면 MetaMask가 서명 자체를 거부하거나("Provided
chainId must match the active chainId") 서명이 되더라도 온체인 검증에 실패한다. 로컬
`hardhat node`를 쓴다면 MetaMask에 "Localhost 8545"(chainId 31337) 같은 커스텀 네트워크를
추가하고 그걸로 전환한 뒤 접속할 것.

## 실행

```bash
cd frontend
python3 -m http.server 5173
# 브라우저에서 http://localhost:5173 접속
```

또는 VS Code의 Live Server 확장 등 아무 정적 서버로 열어도 됩니다.
(파일을 그냥 더블클릭해서 `file://`로 열면 ES 모듈 CORS 제약으로 동작하지 않습니다 — 반드시 정적 서버로 서빙하세요.)

접속 후 우측 상단 **설정** 버튼에서 Relay Server URL / RPC URL / GoldenLock 컨트랙트 주소를
입력하세요. 값은 브라우저 `localStorage`에만 저장됩니다.

전체 실행 순서(컨트랙트 배포 → zk-circuits 컴파일 → relay-server 기동 → 이 프론트)는
프로젝트 루트의 `README.md`를 참고하세요.

## 디렉터리

```
frontend/
├── index.html
├── css/style.css
├── circuits/              # zk-circuits 컴파일 산출물을 여기로 복사 (circuits/README.md 참고)
└── js/
    ├── app.js              # 부트스트랩: 탭 라우팅 + 연결 관리
    ├── auth.js             # 지갑 서명 challenge/response 인증 오케스트레이션
    ├── config.js           # 연결 설정 + 코드 테이블
    ├── contract.js         # GoldenLock.sol 읽기 전용 레이어 + EIP-712 서명 헬퍼
    ├── socket.js           # relay-server socket.io 래퍼
    ├── state.js            # 아주 작은 pub/sub 스토어 + 이벤트 로그
    ├── zk.js               # 브라우저 SnarkJS 증명 생성
    └── views/
        ├── ambulance.js
        ├── hospital.js
        └── monitor.js
```

이전 버전에는 이 폴더 안에 `contracts/`, `relay-server/`, `zk-circuits/`의 스테일 복사본이
함께 들어 있었다(그것도 이미 폐기된 구 API를 가리키고 있었다). 정적 프론트는 순수하게 위
디렉터리만 필요하므로 그 복사본들은 제거했다 — 실제 소스는 프로젝트 루트의
`contracts/`, `relay-server/`, `zk-circuits/`를 참고할 것.
