"""
GoldenLock - scripts/convert_triagegeist.py

Kaggle "Triagegeist" (kagglehub competition_download) 실제 데이터를
services/dataset.py의 CSVKTASDataset 스키마로 변환.

실제 확인된 스키마:
  train.csv (80000 x 40): patient_id, age, sex, heart_rate, spo2, systolic_bp,
    diastolic_bp, respiratory_rate, temperature_c, gcs_total, pain_score,
    weight_kg, height_cm, bmi, shock_index, news2_score,
    chief_complaint_system, triage_acuity(라벨 1~5, 1=최중증 확인됨)
  patient_history.csv (100000 x 26): patient_id + hx_* 이진 플래그 24종
  chief_complaints.csv (100000 x 3): patient_id, chief_complaint_raw(텍스트), chief_complaint_system
  test.csv: train과 동일하나 triage_acuity 없음 (제출용)

사용:
  python scripts/convert_triagegeist.py \
      --raw_dir <kagglehub 다운로드 경로> \
      --out data/ktas_train.csv
"""

import argparse
import json
import os

import pandas as pd

HX_COLUMNS = [
    "hx_hypertension", "hx_diabetes_type2", "hx_diabetes_type1", "hx_asthma",
    "hx_copd", "hx_heart_failure", "hx_atrial_fibrillation", "hx_ckd",
    "hx_liver_disease", "hx_malignancy", "hx_obesity", "hx_depression",
    "hx_anxiety", "hx_dementia", "hx_epilepsy", "hx_hypothyroidism",
    "hx_hyperthyroidism", "hx_hiv", "hx_coagulopathy", "hx_immunosuppressed",
    "hx_pregnant", "hx_substance_use_disorder", "hx_coronary_artery_disease",
    "hx_stroke_prior", "hx_peripheral_vascular_disease",
]


def repeat_series(value: float, length: int = 500):
    v = 0.0 if pd.isna(value) else float(value)
    return json.dumps([v] * length)


def build_symptom_text(row) -> str:
    complaint = str(row.get("chief_complaint_raw", "") or "")
    system = str(row.get("chief_complaint_system", "") or "")
    return f"[{system}] {complaint}".strip()


def convert(raw_dir: str, out_path: str, split: str = "train"):
    main_df = pd.read_csv(os.path.join(raw_dir, f"{split}.csv"))
    history_df = pd.read_csv(os.path.join(raw_dir, "patient_history.csv"))
    complaints_df = pd.read_csv(os.path.join(raw_dir, "chief_complaints.csv"))

    df = main_df.merge(history_df, on="patient_id", how="left") \
                .merge(complaints_df, on="patient_id", how="left", suffixes=("", "_dup"))

    print(f"[INFO] 병합 후 row 수: {len(df)}  (원본 {split}.csv: {len(main_df)})")

    rows = []
    for _, r in df.iterrows():
        history_list = [h.replace("hx_", "") for h in HX_COLUMNS if r.get(h, 0) == 1]

        row = {
            "ecg_json": repeat_series(0.0),                     # 원시 ECG 없음 -> 0으로 채움
            "spo2_json": repeat_series(r.get("spo2", 97.0)),
            "hr_json": repeat_series(r.get("heart_rate", 80.0)),
            "symptom_text": build_symptom_text(r),
            "age": r.get("age", 40),
            "sex": r.get("sex", "unknown"),
            "history_json": json.dumps(history_list),
            # 추가 수치형 vitals (모델 고도화 시 meta 벡터 확장용으로 함께 보존)
            "systolic_bp": r.get("systolic_bp"),
            "diastolic_bp": r.get("diastolic_bp"),
            "respiratory_rate": r.get("respiratory_rate"),
            "temperature_c": r.get("temperature_c"),
            "gcs_total": r.get("gcs_total"),
            "pain_score": r.get("pain_score"),
            "shock_index": r.get("shock_index"),
            "news2_score": r.get("news2_score"),
            "bmi": r.get("bmi"),
        }
        if split == "train":
            row["ktas_label"] = int(r["triage_acuity"])  # 1=최중증, 반전 불필요 (검증 완료)
        rows.append(row)

    out_df = pd.DataFrame(rows)
    out_df.to_csv(out_path, index=False)
    print(f"[OK] 변환 완료: {out_path} ({len(out_df)} rows)")
    if split == "train":
        print(out_df["ktas_label"].value_counts().sort_index())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw_dir", type=str, required=True, help="kagglehub 다운로드 경로 (6개 csv가 있는 폴더)")
    parser.add_argument("--out", type=str, default="data/ktas_train.csv")
    parser.add_argument("--split", type=str, default="train", choices=["train", "test"])
    args = parser.parse_args()

    convert(args.raw_dir, args.out, args.split)
