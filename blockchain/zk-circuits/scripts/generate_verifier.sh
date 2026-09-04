#!/usr/bin/env bash
set -e

CIRCUIT_NAME="hospital_resource"
BUILD_DIR="./build"
OUT_CONTRACT="../contracts/contracts/Verifier.sol"

echo "▶ Solidity Verifier 컨트랙트 생성 중..."
snarkjs zkey export solidityverifier "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$OUT_CONTRACT"

echo "✅ Verifier.sol 생성 완료 -> $OUT_CONTRACT"
echo "⚠ contracts/contracts/Verifier.sol 을 GoldenLock.sol의 IGroth16Verifier 인터페이스에 맞게 함수명 확인 필요"
