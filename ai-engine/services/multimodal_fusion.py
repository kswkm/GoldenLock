"""
GoldenLock - ai-engine/services/multimodal_fusion.py
(내용은 기존과 동일 — import 경로 변경 없음, flat 구조에서도 그대로 사용 가능)

원본 입력(ECG 파형, 증상 텍스트, 메타데이터)을 모델 입력 텐서로 변환.
- ECG: 밴드패스 필터링 -> 정규화 -> (1, C, T) 텐서
- 텍스트: 경량 문장 인코더로 임베딩 추출 (사전 로드된 세션 재사용)
- 메타: 나이/성별/과거력 -> 수치 벡터
"""

from typing import Dict, List
import numpy as np
from scipy.signal import butter, filtfilt

try:
    from sentence_transformers import SentenceTransformer
    # ⚠️ 이전에는 "distiluse-base-multilingual-cased-v2"를 사용했으나, 이 모델의 실제 출력
    #    차원은 512인 반면 KTASMultimodalNet/TextAdapter(services/ktas_model.py)와
    #    export_onnx.py의 dummy_text, ARCHITECTURE.md 문서는 모두 768차원을 전제로 한다.
    #    인코더가 정상 로드되는 환경에서는 (1, 512) 임베딩이 나와 TextAdapter의
    #    nn.Linear(768, 128) 레이어에서 바로 shape mismatch로 크래시했다.
    #    768차원을 출력하는 다국어 인코더로 교체해 모델 전체의 차원 계약을 일치시킨다.
    #    (요구사항이 바뀌어 인코더를 다시 바꿀 경우, 아래 TEXT_EMBED_DIM과
    #     ktas_model.py의 text_in_dim / export_onnx.py의 dummy_text를 함께 수정할 것.)
    _TEXT_ENCODER = SentenceTransformer("paraphrase-multilingual-mpnet-base-v2")
except Exception:
    _TEXT_ENCODER = None  # 텍스트 인코더 미탑재 환경(온디바이스 경량 배포) 대비

TEXT_EMBED_DIM = 768  # ktas_model.py의 text_in_dim, export_onnx.py의 dummy_text와 반드시 일치


def _bandpass_filter(signal: np.ndarray, fs: float = 250.0,
                      low: float = 0.5, high: float = 40.0, order: int = 4) -> np.ndarray:
    nyq = 0.5 * fs
    b, a = butter(order, [low / nyq, high / nyq], btype="band")
    return filtfilt(b, a, signal)


def _z_normalize(x: np.ndarray) -> np.ndarray:
    mu, sigma = np.mean(x), np.std(x) + 1e-8
    return (x - mu) / sigma


def preprocess_ecg(vitals: Dict[str, List[float]], target_len: int = 500) -> np.ndarray:
    channels = []
    for key in ["ecg", "spo2", "hr"]:
        raw = np.array(vitals.get(key, np.zeros(target_len)), dtype=np.float32)

        if len(raw) < 2:
            raw = np.zeros(target_len, dtype=np.float32)

        if len(raw) >= target_len:
            raw = raw[:target_len]
        else:
            raw = np.pad(raw, (0, target_len - len(raw)))

        try:
            raw = _bandpass_filter(raw)
        except Exception:
            pass

        channels.append(_z_normalize(raw))

    tensor = np.stack(channels, axis=0)
    return np.expand_dims(tensor, axis=0).astype(np.float32)


def embed_symptom_text(symptom_text: str) -> np.ndarray:
    if _TEXT_ENCODER is None:
        return np.zeros((1, TEXT_EMBED_DIM), dtype=np.float32)

    emb = np.asarray(_TEXT_ENCODER.encode([symptom_text]), dtype=np.float32)

    # 방어적 체크: 인코더를 교체했는데 차원 상수를 갱신하지 않으면 여기서 즉시 실패시켜
    # (모델 내부 Linear 레이어에서 알아보기 힘든 shape mismatch로 죽는 대신) 원인을 바로 드러낸다.
    if emb.shape[-1] != TEXT_EMBED_DIM:
        raise ValueError(
            f"텍스트 인코더 출력 차원({emb.shape[-1]})이 TEXT_EMBED_DIM({TEXT_EMBED_DIM})과 다릅니다. "
            "services/multimodal_fusion.py의 TEXT_EMBED_DIM, services/ktas_model.py의 text_in_dim, "
            "services/export_onnx.py의 dummy_text 차원을 함께 맞춰주세요."
        )
    return emb


_HISTORY_VOCAB = ["hypertension", "diabetes", "asthma", "cardiac", "renal",
                   "cancer", "stroke", "allergy", "none"]


def encode_meta(age: int, sex: str, history: List[str]) -> np.ndarray:
    age_norm = np.array([age / 100.0], dtype=np.float32)
    sex_onehot = np.array([1.0, 0.0] if sex.lower().startswith("m") else [0.0, 1.0], dtype=np.float32)

    history_vec = np.zeros(len(_HISTORY_VOCAB), dtype=np.float32)
    for h in history or []:
        if h in _HISTORY_VOCAB:
            history_vec[_HISTORY_VOCAB.index(h)] = 1.0

    pad_len = 16 - (1 + 2 + len(_HISTORY_VOCAB))
    pad = np.zeros(max(pad_len, 0), dtype=np.float32)

    vec = np.concatenate([age_norm, sex_onehot, history_vec, pad])[:16]
    return np.expand_dims(vec, axis=0).astype(np.float32)


def build_input_tensor(vitals: dict, symptom_text: str, meta: dict) -> Dict[str, np.ndarray]:
    ecg_tensor = preprocess_ecg(vitals)
    text_emb = embed_symptom_text(symptom_text)
    meta_vec = encode_meta(
        age=meta.get("age", 0),
        sex=meta.get("sex", "unknown"),
        history=meta.get("history", []),
    )
    return {"ecg": ecg_tensor, "text_emb": text_emb, "meta": meta_vec}
