# zk-circuits — hospital_resource.circom

병원의 비공개 자원 현황(`availableBeds`, `availableSpecialists`)을 노출하지 않고
"구급대가 요청한 수량(`requiredBeds`, `requiredSpecialists`)을 수용 가능한지"만
공개 증명하는 Circom 회로. `hospitalSecret`/`requestHash`가 0이 아님을 강제해 더미
값으로는 증명을 만들 수 없게 하며, 실제 재사용(replay) 방지는 온체인
`GoldenLock.sol::usedRequestHash` 매핑이 담당한다(같은 requestHash로 두 번 락 불가).

- private input: `availableBeds`, `availableSpecialists`, `hospitalSecret`
- public input: `requiredBeds`, `requiredSpecialists`, `requestHash`
- output(회로가 자동으로 맨 앞에 배치): `canAccept`
- **온체인 `verifyProof`가 받는 public signal 배열은 `[canAccept, requiredBeds,
  requiredSpecialists, requestHash]` 총 4개**다 (`contracts/contracts/interfaces/IGroth16Verifier.sol` 참고).

## 설치 & 실행 순서

⚠️ **`npm install -g circom`으로 설치되는 건 옛날 버전(circom 1.x, JS 구현, 지금은 폐기됨)입니다.**
이 프로젝트의 회로는 `pragma circom 2.1.6`(circom 2.x)을 쓰므로 그 명령으로 깔면 문법을 못 읽습니다.
circom 2.x는 npm 패키지가 아니라 **Rust로 만들어진 별도 실행 파일**입니다:

- **가장 쉬운 방법(Windows/macOS/Linux 공통)**: https://github.com/iden3/circom/releases 에서
  자신의 OS에 맞는 바이너리를 받아 PATH에 등록된 폴더에 넣기 (Windows는 `circom.exe`로
  저장해도 되고, 실행 파일이 있는 폴더 자체를 시스템 환경변수 PATH에 추가해도 된다).
- **또는 Rust로 직접 빌드**: [rustup](https://rustup.rs)으로 Rust 설치 후
  ```bash
  git clone https://github.com/iden3/circom.git
  cd circom
  cargo build --release
  cargo install --path circom
  ```

설치 후 `circom --version`이 실행되는지 확인하고 진행하세요.

```bash
cd zk-circuits
npm install
npm run compile              # scripts/compile.js — Windows 포함 어떤 OS에서도 동작 (bash 불필요)
npm run generate-verifier    # ../contracts/contracts/Verifier.sol 자동 교체
```

로컬에서 증명을 직접 만들어보려면:

```bash
npm run prove   # input.json으로 fullProve + 로컬 검증 + Solidity calldata 출력
```

## 프론트엔드 연동

컴파일 산출물 3개를 `frontend/circuits/`에 복사해야 병원 콘솔의 "ZK 증명 생성" 버튼이
동작한다. 자세한 경로는 `frontend/circuits/README.md` 참고.

## 주의사항

- `contracts/contracts/Verifier.sol`은 현재 자리표시자(항상 true 반환)다.
  `generate-verifier`를 실행하면 실제 SnarkJS 생성 코드로 교체된다.
- 교체 후 `GoldenLock.sol`이 기대하는 `verifyProof(a, b, c, uint256[4])` 시그니처와
  실제 회로의 public signal 개수(4개)가 일치하는지 확인할 것.
