#!/usr/bin/env sh
set -eu
circom circuits/capacity_check.circom --r1cs --wasm --sym -o build