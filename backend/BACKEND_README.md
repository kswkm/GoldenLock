# Backend Gateway

`backend/`는 relay-server와 ai-engine 사이의 내부 FastAPI gateway입니다.

```text
relay-server -> POST /api/ai/predict-ktas -> backend -> AI_ENGINE_URL -> ai-engine
```

운영 상태는 PostgreSQL에 저장되고 사용자 session은 Redis에 저장됩니다. 공개 회원가입은 없으며, provisioning job으로 역할을 부여합니다.

- `hospital`: 병원 등록, availability proof 제출, 수용 확정
- `ambulance`: 환자 매칭 요청
- `operator`: 운영자 예외 처리 및 락 해제

사용자 테이블은 [migrations/001_users.sql](migrations/001_users.sql)로 생성합니다. 비밀번호는 반드시 bcrypt hash로 provisioning job에서 입력하고 평문을 저장하지 않습니다.

`ALLOW_RULE_BASED_FALLBACK=true`는 로컬에서만 사용합니다. 운영에서는 학습된 `ai-engine/app/models/ktas_classifier.onnx`를 배포하고 false로 유지합니다.

운영 배포는 루트의 `docker-compose.production.yml`을 사용합니다. backend와 ai-engine은 외부에 직접 노출하지 않습니다.
