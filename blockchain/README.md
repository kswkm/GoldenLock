# GoldenLock — Blockchain & ZK 담당 파트

이 zip은 전체 goldenlock 프로젝트 구조 중 **contracts/** 와 **zk-circuits/** 두 디렉터리만 포함합니다.

## 설치 & 실행 순서

### 1. zk-circuits (먼저 실행)
```bash
cd zk-circuits
npm install
npm install -g circom   # 로컬에 circom CLI 없으면 설치
npm run compile
npm run generate-verifier   # contracts/contracts/Verifier.sol 자동 교체
```

### 2. contracts
```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network hardhatMainnet
```

또는 Hardhat 3 표준 배포(Ignition):
```bash
npx hardhat ignition deploy ignition/modules/GoldenLock.ts --network hardhatMainnet
```

## 주의사항
- `contracts/contracts/Verifier.sol`은 현재 **mock**(항상 true 반환)입니다. `zk-circuits`의 `generate-verifier` 스크립트를 실행하면 실제 SnarkJS 생성 코드로 교체됩니다.
- 교체 후 `GoldenLock.sol`의 `verifyProof` 파라미터(`uint256[3] publicSignals`)가 실제 회로의 public signal 개수와 일치하는지 확인하세요.
- `.env.example`을 `.env`로 복사 후 배포용 개인키/RPC URL을 채워주세요.
