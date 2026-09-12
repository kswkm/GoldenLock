# circuits/ (빌드 산출물 배치 폴더)

이 폴더는 비어 있는 상태로 배포됩니다. `zk-circuits`에서 회로를 컴파일한 뒤
아래 3개 산출물을 **그대로 이 폴더 구조로 복사**해야 병원 콘솔의
"ZK 증명 생성" 버튼이 동작합니다.

```
zk-circuits/build/hospital_resource_js/hospital_resource.wasm
  → frontend/circuits/hospital_resource_js/hospital_resource.wasm

zk-circuits/build/hospital_resource_final.zkey
  → frontend/circuits/hospital_resource_final.zkey

zk-circuits/build/verification_key.json
  → frontend/circuits/verification_key.json
```

복사 명령 예시 (zk-circuits 컴파일이 끝난 뒤 프로젝트 루트에서):

```bash
mkdir -p frontend/circuits/hospital_resource_js
cp zk-circuits/build/hospital_resource_js/hospital_resource.wasm \
   frontend/circuits/hospital_resource_js/hospital_resource.wasm
cp zk-circuits/build/hospital_resource_final.zkey  frontend/circuits/
cp zk-circuits/build/verification_key.json         frontend/circuits/
```

파일 경로를 바꾸고 싶다면 `frontend/js/zk.js` 상단의
`CIRCUIT_WASM` / `CIRCUIT_ZKEY` / `CIRCUIT_VKEY` 상수를 수정하세요.
