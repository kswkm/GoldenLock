# GoldenLock AI Engine

GoldenLock의 KTAS(한국형 응급환자 중증도 분류) 추론 서비스입니다. ECG/SpO2/심박수 시계열, 증상 텍스트, 환자 메타데이터를 결합해 KTAS 1~5 등급을 예측하고, 결과를 의료 자원 코드와 ZK 공개 입력 값으로 변환합니다.

> 현재 구현은 데모 및 파이프라인 검증 단계입니다. 규칙 기반 폴백과 합성 데이터는 임상 판단이나 실제 환자 분류에 사용할 수 없습니다.

## 주요 기능

- FastAPI 기반 `POST /predict-ktas` 추론 API
- ONNX Runtime CPU 추론
- 모델 입력 전처리
  - ECG, SpO2, HR: 길이 500으로 패딩/절단, 밴드패스 필터, Z-score 정규화
  - 증상 텍스트: `paraphrase-multilingual-mpnet-base-v2` 임베딩, 768차원
  - 메타데이터: 나이, 성별, 과거력 인코딩, 16차원
- 멀티모달 gated fusion을 통한 모달리티 기여도 반환
- ONNX 모델 미탑재 시 규칙 기반 폴백 응답
- KTAS 등급을 `0x01`~`0x05` 자원 코드와 정수형 ZK 공개 입력으로 변환
- PyTorch 학습 체크포인트를 FP32 ONNX 및 INT8 ONNX로 변환

## 디렉터리 구조

```text
ai-engine/
├── main.py                         # FastAPI 앱 진입점, /health
├── requirements.txt                # Python 의존성
├── api/
│   └── routes.py                   # 요청/응답 스키마와 /predict-ktas
├── services/
│   ├── dataset.py                  # CSV/합성 데이터셋
│   ├── export_onnx.py              # PyTorch -> ONNX -> INT8 변환
│   ├── ktas_model.py               # 멀티모달 PyTorch 모델
│   ├── multimodal_fusion.py        # 세 모달리티 전처리 및 입력 텐서 생성
│   ├── resource_mapper.py           # KTAS -> 자원 코드/ZK 입력 매핑
│   ├── rule_based_fallback.py       # 데모용 폴백 분류
│   └── train.py                    # 학습 및 검증 루프
├── scripts/
│   └── convert_triagegeist.py      # 원천 CSV -> 학습 스키마 변환
├── data/                            # 변환된 데이터 및 원천 데이터
└── models/                          # 배포할 ONNX 모델
```

## 실행 환경

Python 3.10 이상을 권장합니다. `ai-engine` 디렉터리를 작업 디렉터리로 사용해야 모듈 import와 상대 경로가 올바르게 동작합니다.

### Windows PowerShell

```powershell
cd ai-engine
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### API 실행

```powershell
cd ai-engine
.\.venv\Scripts\Activate.ps1
python main.py
```

또는:

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

- 상태 확인: `GET http://localhost:8000/health`
- Swagger UI: `http://localhost:8000/docs`

`frontend/js/views/ambulance.js`가 브라우저에서 이 API를 직접 호출한다(`/predict-ktas`,
"AI로 KTAS/필요자원 자동 산출" 버튼). 기본 CORS 허용 origin은 `http://localhost:5173`
(frontend/README.md 권장 포트)이며, `FRONTEND_ORIGIN` 환경변수(콤마 구분)로 바꿀 수 있다:

```bash
FRONTEND_ORIGIN=http://localhost:5173 python main.py
```

## API 사용 예시

```powershell
$body = @'
{
  "vitals": {
    "ecg": [0.1, 0.2, 0.15],
    "spo2": [98, 98, 97],
    "hr": [82, 84, 81]
  },
  "symptom_text": "가벼운 복통",
  "meta": {
    "age": 42,
    "sex": "F",
    "history": ["none"]
  }
}
'@
Invoke-RestMethod -Method Post -Uri http://localhost:8000/predict-ktas `
  -ContentType "application/json" -Body $body
```

응답 예시:

```json
{
  "ktas_grade": 5,
  "confidence": 0.91,
  "resource_code": "0x05",
  "resource_label": "외래 대기(비응급)",
  "priority": 5,
  "required_beds": 0,
  "required_specialists": 0,
  "modality_contribution": {
    "ecg": 0.31,
    "symptom_text": 0.44,
    "meta": 0.25
  },
  "source": "ai_model",
  "warning": null
}
```

`models/ktas_classifier.onnx`가 없으면 `source`가 `rule_based_fallback`으로 반환되고 `warning`에 폴백 사유가 포함됩니다. 모델 파일이 있더라도 로드 또는 추론 오류는 현재 API에서 HTTP 500으로 처리됩니다.

## 학습 및 모델 배포

### 1. 합성 데이터로 파이프라인 확인

```powershell
cd ai-engine
python -m services.train --epochs 10 --out checkpoints/ktas_best.pt
```

합성 데이터는 학습 루프와 export/serving 흐름을 확인하기 위한 것입니다. 성능 수치나 임상 타당성의 근거로 사용하지 마세요.

### 2. CSV 데이터로 학습

`services.dataset.CSVKTASDataset`가 요구하는 최소 컬럼은 다음과 같습니다.

```text
ecg_json, spo2_json, hr_json, symptom_text, age, sex, history_json, ktas_label
```

시계열과 과거력은 JSON 문자열이어야 하며, `ktas_label`은 1~5입니다. 예:

```powershell
python -m services.train `
  --csv data/ktas_train.csv `
  --epochs 30 `
  --out checkpoints/ktas_best.pt
```

### 3. ONNX export 및 INT8 양자화

```powershell
python -m services.export_onnx `
  --ckpt checkpoints/ktas_best.pt `
  --fp32_out models/ktas_classifier_fp32.onnx `
  --int8_out models/ktas_classifier.onnx
```

최종 서비스가 자동으로 읽는 경로는 `ai-engine/models/ktas_classifier.onnx`입니다. export 시 모델 입력 이름은 `ecg`, `text_emb`, `meta`, 출력 이름은 `logits`, `modality_gates`입니다.

## 원천 데이터 변환

`scripts/convert_triagegeist.py`는 `train.csv`, `patient_history.csv`, `chief_complaints.csv`를 병합해 학습 어댑터의 CSV 스키마로 변환합니다.

```powershell
python scripts/convert_triagegeist.py `
  --raw_dir <원천 CSV 디렉터리> `
  --out data/ktas_train.csv
```

원천 데이터에 ECG가 없으면 ECG를 0으로 채우므로, 이 데이터로 학습한 모델의 ECG 표현력은 제한됩니다. 실제 데이터 사용 전 데이터 사용 권한, 개인정보 비식별화, 라벨 정의, 의료진 검증을 확인해야 합니다.

## GoldenLock 연동

`required_beds`/`required_specialists`가 relay-server의 `AmbulanceMatchRequest`와
`zk-circuits/circuits/hospital_resource.circom`의 public input(`requiredBeds`,
`requiredSpecialists`)으로 그대로 전달되는 값입니다. `ktas_grade`는
`contracts/contracts/GoldenLock.sol::requestAndLock`의 `ktasLevel` 파라미터로 그대로
올라가 온체인에 감사 기록으로 남습니다. `resource_code`/`resource_label`은 사람이 읽기
위한 참고용 라벨일 뿐 온체인이나 회로에는 쓰이지 않습니다.

| KTAS | 자원 코드(참고용) | 우선순위 | requiredBeds | requiredSpecialists |
|---:|---|---:|---:|---:|
| 1 | `0x01` | 1 | 1 | 3 |
| 2 | `0x02` | 2 | 1 | 2 |
| 3 | `0x03` | 3 | 1 | 1 |
| 4 | `0x04` | 4 | 1 | 0 |
| 5 | `0x05` | 5 | 0 | 0 |

서비스 간 계약이 변경되면 `services/resource_mapper.py`, `relay-server/src/types.ts`,
ZK 회로(`zk-circuits/circuits/hospital_resource.circom`)의 공개 입력 정의를 함께
변경해야 합니다.

## 운영상 주의

- 본 서비스의 결과는 의료진 판단을 대체하지 않습니다.
- 합성 데이터와 `rule_based_fallback.py`는 데모 전용입니다.
- 모델 버전, 학습 데이터 버전, 성능 지표, confusion matrix, KTAS 1/2 재현율을 배포 기록에 남겨야 합니다.
- 운영 환경에서는 인증, 요청 추적, 입력 범위 검증, 모델 파일 무결성 확인, 관측성, rate limit을 별도로 구성해야 합니다.
- 현재 텍스트 인코더는 import 시 모델을 로드하므로 최초 기동 시간이 길어질 수 있습니다. 인코더가 없는 환경에서는 768차원 0 벡터를 사용합니다.
