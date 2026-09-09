"""KTAS prediction API with an AI-model fallback."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import numpy as np
import onnxruntime as ort

from app.services.resource_mapper import map_ktas_to_resource, to_zk_public_input
from app.services.rule_based_fallback import rule_based_ktas

router = APIRouter()

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "ktas_classifier.onnx")
_session: Optional[ort.InferenceSession] = None
_MODEL_AVAILABLE = os.path.exists(_MODEL_PATH)
_ALLOW_RULE_FALLBACK = os.getenv("ALLOW_RULE_BASED_FALLBACK", "false").lower() == "true"


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
    zk_public_input: int
    modality_contribution: dict
    source: str          # "ai_model" | "rule_based_fallback"
    warning: Optional[str] = None


@router.post("/predict-ktas", response_model=KTASPredictResponse)
def predict_ktas(payload: KTASPredictRequest):
    try:
        session = get_session()

        if session is None:
            if not _ALLOW_RULE_FALLBACK:
                raise HTTPException(status_code=503, detail="AI model is not available")
            # --- 모델 미탑재/로드 실패: 규칙 기반 폴백 ---
            fallback = rule_based_ktas(payload.vitals.dict(), payload.meta.dict())
            ktas_grade = fallback["ktas_grade"]
            confidence = fallback["confidence"]
            gates = {"ecg": 0.0, "symptom_text": 0.0, "meta": 0.0}
            source = "rule_based_fallback"
            warning = f"AI 모델 미탑재 -> 규칙 기반 폴백 사용 (근거: {fallback['reason']}). 학습된 모델 배포 후 재확인 필요."
        else:
            from app.services.multimodal_fusion import build_input_tensor

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
        zk_input = to_zk_public_input(ktas_grade)

        return KTASPredictResponse(
            ktas_grade=ktas_grade,
            confidence=round(confidence, 4),
            resource_code=resource_info["resource_code"],
            resource_label=resource_info["resource_label"],
            priority=resource_info["priority"],
            zk_public_input=zk_input,
            modality_contribution=gates,
            source=source,
            warning=warning,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"추론 실패: {str(e)}")


def _softmax(x: np.ndarray) -> np.ndarray:
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum()
