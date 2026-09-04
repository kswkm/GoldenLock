#!/usr/bin/env bash
set -e

CIRCUIT_NAME="hospital_resource"
BUILD_DIR="./build"

mkdir -p "$BUILD_DIR"

echo "▶ [1/3] Circom 컴파일 (R1CS / WASM / SYM 생성)"
circom circuits/${CIRCUIT_NAME}.circom \
  --r1cs --wasm --sym \
  -l node_modules \
  -o "$BUILD_DIR"

echo "▶ [2/3] Powers of Tau (최초 1회만 필요 — 이미 있으면 스킵)"
if [ ! -f "$BUILD_DIR/pot14_final.ptau" ]; then
  snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0000.ptau" -v
  snarkjs powersoftau contribute "$BUILD_DIR/pot14_0000.ptau" "$BUILD_DIR/pot14_0001.ptau" \
    --name="GoldenLock contribution" -v -e="goldenlock_random_entropy"
  snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot14_0001.ptau" "$BUILD_DIR/pot14_final.ptau" -v
fi

echo "▶ [3/3] Groth16 zkey 생성"
snarkjs groth16 setup "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$BUILD_DIR/pot14_final.ptau" "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"
snarkjs zkey contribute "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
  --name="GoldenLock zkey contribution" -v -e="goldenlock_more_entropy"

snarkjs zkey export verificationkey "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$BUILD_DIR/verification_key.json"

echo "✅ 컴파일 완료: $BUILD_DIR"
