"""
GoldenLock - ai-engine/services/dataset.py

학습 데이터셋 로더.

실전에서 쓸 수 있는 실제 공개 데이터:
  1) AI-Hub "응급실 환자 중증도 분류(KTAS) 데이터" (한국어, KTAS 라벨 직접 존재)
     -> https://aihub.or.kr (검색: "응급실" 또는 "KTAS") - 회원가입/승인 후 다운로드 필요
  2) PhysioNet MIMIC-IV-ED (영어, ESI 1~5 라벨 - KTAS와 체계 유사, 매핑 가능)
     -> https://physionet.org/content/mimic-iv-ed  (Credentialed Access 필요, CITI 교육 이수 조건)
  3) PhysioNet MIMIC-IV-Ext Triage Instruction Corpus(MIETIC)
     -> https://physionet.org/content/mietic  (LLM 학습용으로 가공된 triage 케이스, ESI 라벨 포함)

  => 이 데이터들은 승인 절차가 있어 지금 이 자리에서 자동 다운로드는 불가능합니다.
     아래 CSVDataset은 "vitals + symptom_text + meta + ktas_label" 컬럼 형태로
     전처리된 CSV만 있으면 바로 학습에 쓸 수 있는 어댑터입니다.
     (MIMIC-IV-ED의 triage 테이블: temperature/heartrate/resprate/o2sat/sbp/dbp/pain/acuity/chiefcomplaint
      컬럼을 아래 스키마로 rename만 하면 그대로 사용 가능 — acuity(ESI 1~5)를 ktas_label로 사용)

실제 데이터 확보 전, 파이프라인 검증 및 데모용으로 SyntheticKTASDataset(규칙 기반 합성 데이터)을 제공합니다.
"""

import os
import json
import random
from typing import List, Dict, Optional

import numpy as np
import torch
from torch.utils.data import Dataset

from services.multimodal_fusion import preprocess_ecg, embed_symptom_text, encode_meta


# ---------------------------------------------------------
# 1) 실제 데이터용: CSV 어댑터
# ---------------------------------------------------------
class CSVKTASDataset(Dataset):
    """
    기대 CSV 스키마 (컬럼명 고정):
      ecg_json, spo2_json, hr_json   : JSON 리스트 문자열 (시계열)  ex) "[0.1, 0.2, ...]"
      symptom_text                    : str
      age, sex, history_json          : 메타 (history_json: ["cardiac", ...] 형태 JSON 문자열)
      ktas_label                      : int (1~5)

    MIMIC-IV-ED triage.csv를 쓸 경우 컬럼 매핑 예:
      heartrate -> hr_json(단일값을 500 길이로 repeat), o2sat -> spo2_json,
      chiefcomplaint -> symptom_text, acuity -> ktas_label (ESI와 KTAS 체계가 유사해 근사 매핑 가능,
      단 임상적으로 완전히 동일하지 않으므로 실제 서비스 적용 전 의료진 검증 필수)
    """

    def __init__(self, csv_path: str, target_len: int = 500):
        import pandas as pd
        self.df = pd.read_csv(csv_path)
        self.target_len = target_len
        required = {"ecg_json", "spo2_json", "hr_json", "symptom_text",
                    "age", "sex", "history_json", "ktas_label"}
        missing = required - set(self.df.columns)
        if missing:
            raise ValueError(f"CSV에 필요한 컬럼이 없습니다: {missing}")

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        vitals = {
            "ecg": json.loads(row["ecg_json"]),
            "spo2": json.loads(row["spo2_json"]),
            "hr": json.loads(row["hr_json"]),
        }
        ecg_tensor = preprocess_ecg(vitals, target_len=self.target_len)[0]  # (C, T)
        text_emb = embed_symptom_text(row["symptom_text"])[0]              # (D_text,)
        meta_vec = encode_meta(
            age=int(row["age"]), sex=str(row["sex"]),
            history=json.loads(row["history_json"]),
        )[0]                                                                 # (16,)

        label = int(row["ktas_label"]) - 1  # 1~5 -> 0~4

        return (
            torch.tensor(ecg_tensor, dtype=torch.float32),
            torch.tensor(text_emb, dtype=torch.float32),
            torch.tensor(meta_vec, dtype=torch.float32),
            torch.tensor(label, dtype=torch.long),
        )


# ---------------------------------------------------------
# 2) 데모/파이프라인 검증용: 규칙 기반 합성 데이터
#    (실제 임상 타당성은 없음 - 오직 학습 루프/변환/서빙 파이프라인이
#     끝까지 도는지 확인하는 용도)
# ---------------------------------------------------------
_SYMPTOM_TEMPLATES = {
    1: ["심정지 상태로 발견됨", "무호흡, 의식 없음", "심한 흉통 후 의식 소실"],
    2: ["가슴을 쥐어짜는 듯한 흉통 호소", "심한 호흡곤란", "의식은 있으나 반응 느림"],
    3: ["복부 통증 지속, 구토 동반", "고열과 오한", "골절 의심, 심한 통증"],
    4: ["경미한 열상, 출혈 적음", "가벼운 복통", "타박상 후 통증"],
    5: ["감기 증상, 콧물/기침", "경미한 어지러움", "가벼운 찰과상"],
}

_HISTORY_POOL = ["hypertension", "diabetes", "asthma", "cardiac", "renal", "none"]


def _synthesize_vitals(ktas_grade: int, target_len: int = 500) -> Dict[str, List[float]]:
    """
    중증도가 높을수록(1에 가까울수록) 심박수/혈압 등이 비정상적인 패턴을 갖도록 합성.
    """
    t = np.linspace(0, 10, target_len)

    if ktas_grade <= 2:
        hr_base = random.uniform(130, 170)   # 빈맥
        spo2_base = random.uniform(80, 90)   # 저산소증
        ecg_noise = 0.6
    elif ktas_grade == 3:
        hr_base = random.uniform(100, 120)
        spo2_base = random.uniform(90, 95)
        ecg_noise = 0.35
    else:
        hr_base = random.uniform(60, 90)     # 정상 범위
        spo2_base = random.uniform(95, 99)
        ecg_noise = 0.15

    ecg = np.sin(2 * np.pi * (hr_base / 60) * t) + np.random.normal(0, ecg_noise, target_len)
    hr = hr_base + np.random.normal(0, 3, target_len)
    spo2 = spo2_base + np.random.normal(0, 1, target_len)

    return {"ecg": ecg.tolist(), "hr": hr.tolist(), "spo2": spo2.tolist()}


class SyntheticKTASDataset(Dataset):
    def __init__(self, n_samples: int = 2000, target_len: int = 500, seed: int = 42):
        random.seed(seed)
        np.random.seed(seed)
        self.target_len = target_len
        self.samples = []

        # 클래스 불균형도 실제와 비슷하게: KTAS1이 가장 적고 3~4가 가장 많음
        grade_weights = {1: 0.05, 2: 0.15, 3: 0.35, 4: 0.30, 5: 0.15}
        grades = random.choices(
            population=list(grade_weights.keys()),
            weights=list(grade_weights.values()),
            k=n_samples,
        )

        for g in grades:
            vitals = _synthesize_vitals(g, target_len)
            symptom_text = random.choice(_SYMPTOM_TEMPLATES[g])
            age = random.randint(1, 95)
            sex = random.choice(["M", "F"])
            history = random.sample(_HISTORY_POOL, k=random.randint(0, 2))
            self.samples.append((vitals, symptom_text, age, sex, history, g))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        vitals, symptom_text, age, sex, history, grade = self.samples[idx]

        ecg_tensor = preprocess_ecg(vitals, target_len=self.target_len)[0]
        text_emb = embed_symptom_text(symptom_text)[0]
        meta_vec = encode_meta(age=age, sex=sex, history=history)[0]

        label = grade - 1

        return (
            torch.tensor(ecg_tensor, dtype=torch.float32),
            torch.tensor(text_emb, dtype=torch.float32),
            torch.tensor(meta_vec, dtype=torch.float32),
            torch.tensor(label, dtype=torch.long),
        )


def get_dataset(csv_path: Optional[str] = None, n_synthetic: int = 2000):
    """
    csv_path가 주어지면 실제 데이터(CSVKTASDataset), 없으면 합성 데이터(SyntheticKTASDataset) 반환.
    """
    if csv_path and os.path.exists(csv_path):
        print(f"[INFO] 실제 데이터 사용: {csv_path}")
        return CSVKTASDataset(csv_path)
    print("[WARN] 실제 데이터 미제공 -> 합성 데이터(SyntheticKTASDataset)로 대체 (데모/파이프라인 검증용, 임상적 신뢰 불가)")
    return SyntheticKTASDataset(n_samples=n_synthetic)
