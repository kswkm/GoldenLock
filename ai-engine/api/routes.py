"""
GoldenLock - ai-engine/api/routes.py
FastAPI 엔드포인트: /predict-ktas (flat 구조: ai-engine/ 루트 기준 import)

모델 파일(models/ktas_classifier.onnx)이 없거나 로드 실패 시
services/rule_based_fallback.py로 자동 폴백 -> 데모/개발 중에도 흐름이 끊기지 않음.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import numpy as np
import onnxruntime as ort

from services.multimodal_fusion import build_input_tensor
from services.resource_mapper import map_ktas_to_resource
from services.rule_based_fallback import rule_based_ktas

router = APIRouter()

_MODEL_PATH = "models/ktas_classifier.onnx"   # ai-engine/models/ktas_classifier.onnx
_session: Optional[ort.InferenceSession] = None
_MODEL_AVAILABLE = os.path.exists(_MODEL_PATH)


def get_session() -> Optional[ort.InferenceSession]:
    global _session
    if not _MODEL_AVAILABLE:
        return None
    if _session is None:
        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = 2
        _session = ort.InferenceSession(
            _MODEL_PATH,
            sess_options=sess_options,
            providers=["CPUExecutionProvider"],
        )
    return _session


class VitalsInput(BaseModel):
    ecg: List[float] = Field(default_factory=list)
    spo2: List[float] = Field(default_factory=list)
    hr: List[float] = Field(default_factory=list)


class MetaInput(BaseModel):
    age: int
    sex: str
    history: List[str] = Field(default_factory=list)


class KTASPredictRequest(BaseModel):
    vitals: VitalsInput
    symptom_text: str
    meta: MetaInput


class KTASPredictResponse(BaseModel):
    ktas_grade: int
    confidence: float
    resource_code: str
    resource_label: str
    priority: int
    required_beds: int
    required_specialists: int
    modality_contribution: dict
    source: str          # "ai_model" | "rule_based_fallback"
    warning: Optional[str] = None


@router.post("/predict-ktas", response_model=KTASPredictResponse)
def predict_ktas(payload: KTASPredictRequest):
    try:
        session = get_session()

        if session is None:
            # --- 모델 미탑재/로드 실패: 규칙 기반 폴백 ---
            fallback = rule_based_ktas(payload.vitals.dict(), payload.meta.dict())
            ktas_grade = fallback["ktas_grade"]
            confidence = fallback["confidence"]
            gates = {"ecg": 0.0, "symptom_text": 0.0, "meta": 0.0}
            source = "rule_based_fallback"
            warning = f"AI 모델 미탑재 -> 규칙 기반 폴백 사용 (근거: {fallback['reason']}). 학습된 모델 배포 후 재확인 필요."
        else:
            inputs = build_input_tensor(
                vitals=payload.vitals.dict(),
                symptom_text=payload.symptom_text,
                meta=payload.meta.dict(),
            )
            outputs = session.run(
                None,
                {"ecg": inputs["ecg"], "text_emb": inputs["text_emb"], "meta": inputs["meta"]},
            )
            logits, gates_arr = outputs[0], outputs[1]
            probs = _softmax(logits[0])
            pred_idx = int(np.argmax(probs))
            ktas_grade = pred_idx + 1
            confidence = float(probs[pred_idx])
            gates = {
                "ecg": float(gates_arr[0][0]),
                "symptom_text": float(gates_arr[0][1]),
                "meta": float(gates_arr[0][2]),
            }
            source = "ai_model"
            warning = None

        resource_info = map_ktas_to_resource(ktas_grade)

        return KTASPredictResponse(
            ktas_grade=ktas_grade,
            confidence=round(confidence, 4),
            resource_code=resource_info["resource_code"],
            resource_label=resource_info["resource_label"],
            priority=resource_info["priority"],
            required_beds=resource_info["required_beds"],
            required_specialists=resource_info["required_specialists"],
            modality_contribution=gates,
            source=source,
            warning=warning,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"추론 실패: {str(e)}")


def _softmax(x: np.ndarray) -> np.ndarray:
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum()
