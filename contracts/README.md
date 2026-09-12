# contracts/ — GoldenLock 스마트 컨트랙트 (Hardhat 3)

`GoldenLock.sol` — 병원별 ZK Verifier를 등록하고, 구급대(또는 relay-server가 대납하는
대리 호출)가 `requestAndLock`으로 병상/전문의 슬롯을 원자적으로 락(확약)한다.

```
contracts/
├── contracts/
│   ├── GoldenLock.sol
│   ├── Verifier.sol                 # zk-circuits generate_verifier.sh가 덮어씀 (현재는 자리표시자)
│   ├── interfaces/IGroth16Verifier.sol
│   └── mocks/MockVerifier.sol       # 로컬 테스트용, forceInvalid 토글 지원
├── ignition/modules/GoldenLock.ts
├── scripts/deploy.ts
├── test/GoldenLock.test.ts
└── hardhat.config.ts
```

## 실행

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network hardhatMainnet
# 또는 Hardhat 표준 배포(Ignition):
npx hardhat ignition deploy ignition/modules/GoldenLock.ts --network hardhatMainnet
```

⚠️ Node.js 22.13.0 이상 필요 (Hardhat 3 요구사항).

## 핵심 함수

v2부터 `requestAndLock`/`fulfillRequest`/`cancelRequest`는 **EIP-712 서명 파라미터**를
받는다 — 관계자 본인이 직접 호출할 때는 빈 bytes(`"0x"`)를 넘기면 되고, relayer가
대납할 때는 그 관계자가 서명한 값을 반드시 함께 실어야 한다 (아래 "보안 모델" 참고).

| 함수 | 호출자 | 설명 |
|---|---|---|
| `registerHospital(hospital, verifier, slotCapacity)` | owner | 병원 등록 + 전용 Verifier 배정 |
| `requestAndLock(hospital, ambulanceOperator, ktasLevel, requestHash, a, b, c, publicSignals, ambulanceSignature)` | 구급대 본인 또는 (서명 지참) `trustedRelayer` | ZK 증명 검증 후 슬롯 1개 락 |
| `fulfillRequest(requestId, hospitalSignature)` | 병원 본인, (서명 지참) `trustedRelayer`, 또는 owner | 환자 수용 확정 |
| `cancelRequest(requestId, ambulanceSignature)` | 구급대 본인, (서명 지참) `trustedRelayer`, 또는 owner | 이송 취소, 슬롯 반환 |
| `expireIfOverdue(requestId)` | 아무나 | 골든타임(15분) 초과 락 하우스키핑 |
| `setTrustedRelayer(addr)` | owner | relay-server 지갑 교체 |
| `nonces(address)` | 누구나(view) | 그 주소의 다음 서명에 써야 할 nonce 조회 |

## 보안 모델: EIP-712 서명 + trustedRelayer

`trustedRelayer`가 탈취되거나 악의적으로 바뀌어도 **실제 행위자(구급대/병원)의
개인키 서명 없이는 그 사람을 대리한 트랜잭션을 만들 수 없다.** relayer는 서명을
검증해서 대신 제출해주는 "우체부"일 뿐이다.

- `msg.sender == ambulanceOperator`(또는 `hospital`)로 본인이 직접 호출하면 서명 불필요.
- 그 외에는 `msg.sender == trustedRelayer`이면서, 그 관계자가 `(파라미터..., nonces[관계자])`에
  대해 서명한 EIP-712 서명이 있어야 한다. 검증에 성공하면 해당 주소의 nonce가 1 증가해
  같은 서명이 재사용(replay)되지 않는다.
- `owner()`는 운영 복구용 비상 경로로 서명 없이 `fulfillRequest`/`cancelRequest`를 호출할
  수 있다 (오너 키는 이미 별도의 높은 신뢰 등급을 전제).
- 도메인: `EIP712("GoldenLock", "1")`, `chainId`/`verifyingContract`는 배포된 네트워크와
  컨트랙트 주소를 그대로 사용 — `relay-server/src/web3/goldenLockAbi.ts`와
  `frontend/js/contract.js`의 상수가 이와 정확히 일치해야 서명이 검증된다.

## 다음 단계

1. `../zk-circuits`에서 회로 컴파일 → `generate-verifier` 실행 → `contracts/contracts/Verifier.sol` 자동 교체
2. 배포 후 `TRUSTED_RELAYER_ADDRESS`(또는 `setTrustedRelayer`)를 `../relay-server/.env`의
   relayer 지갑 주소와 일치시킬 것
3. `deploy.ts` 로그에 출력되는 `GOLDEN_LOCK_ADDRESS`를 `relay-server/.env`와 프론트엔드
   설정(우측 상단 "설정" 패널)에 반영

## 이 패키지의 유래 (통합 노트)

이전 zip에는 이름은 같지만 서로 다른 세 개의 `GoldenLock.sol`(Lock/availability 모델,
EmergencyRequest 모델, 그리고 그 둘의 스테일 복사본)이 `backend/`, `blockchain/`,
`frontend/`에 각각 들어 있었다. 이 패키지는 그중 **실제 ZK 회로
(`zk-circuits/circuits/hospital_resource.circom`)의 4-공개신호 시그니처와 맞는
EmergencyRequest 모델**을 기준으로 삼고, 다른 버전에만 있던 **gasless
`trustedRelayer` 메타트랜잭션 패턴**을 병합했다. 이후 외부 검토에서 "relayer가
탈취되면 임의 주소를 대리할 수 있다"는 점이 지적되어, `trustedRelayer`가 아무 서명
없이도 대리할 수 있던 초기 버전을 **EIP-712 서명 검증** 버전으로 교체했다. 자세한
내용은 프로젝트 루트 `README.md`를 참고.
