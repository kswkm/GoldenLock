"""
GoldenLock - ai-engine/services/train.py

KTASMultimodalNet 학습 스크립트.

실행 (ai-engine/ 루트에서, 모듈 형태로):
  # 합성 데이터로 파이프라인 검증
  python -m services.train --epochs 10 --out checkpoints/ktas_best.pt

  # 실제 CSV 데이터로 학습 (dataset.py의 CSVKTASDataset 스키마 참고)
  python -m services.train --csv data/ktas_train.csv --epochs 30 --out checkpoints/ktas_best.pt
"""

import argparse
import os

import torch
from torch.utils.data import DataLoader, random_split
from sklearn.metrics import f1_score, confusion_matrix

from services.ktas_model import KTASMultimodalNet, WeightedFocalLoss
from services.dataset import get_dataset


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] device = {device}")

    dataset = get_dataset(csv_path=args.csv, n_synthetic=args.n_synthetic)

    val_size = int(len(dataset) * 0.2)
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    model = KTASMultimodalNet().to(device)
    loss_fn = WeightedFocalLoss(class_weights=args.class_weights).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_f1 = -1.0
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for ecg, text_emb, meta, labels in train_loader:
            ecg, text_emb, meta, labels = ecg.to(device), text_emb.to(device), meta.to(device), labels.to(device)

            optimizer.zero_grad()
            logits, _ = model(ecg, text_emb, meta)
            loss = loss_fn(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            total_loss += loss.item() * ecg.size(0)

        scheduler.step()
        train_loss = total_loss / len(train_ds)

        # --- 검증 ---
        model.eval()
        all_preds, all_labels = [], []
        with torch.no_grad():
            for ecg, text_emb, meta, labels in val_loader:
                ecg, text_emb, meta = ecg.to(device), text_emb.to(device), meta.to(device)
                logits, _ = model(ecg, text_emb, meta)
                preds = torch.argmax(logits, dim=-1).cpu().numpy()
                all_preds.extend(preds.tolist())
                all_labels.extend(labels.numpy().tolist())

        macro_f1 = f1_score(all_labels, all_preds, average="macro")
        # KTAS1(index0)/KTAS2(index1) 재현율(recall)이 특히 중요 -> False Negative 감시
        cm = confusion_matrix(all_labels, all_preds, labels=[0, 1, 2, 3, 4])
        ktas1_recall = cm[0, 0] / cm[0].sum() if cm[0].sum() > 0 else float("nan")
        ktas2_recall = cm[1, 1] / cm[1].sum() if cm[1].sum() > 0 else float("nan")

        print(
            f"[Epoch {epoch:03d}] train_loss={train_loss:.4f}  "
            f"val_macro_f1={macro_f1:.4f}  KTAS1_recall={ktas1_recall:.3f}  KTAS2_recall={ktas2_recall:.3f}"
        )

        if macro_f1 > best_f1:
            best_f1 = macro_f1
            torch.save(model.state_dict(), args.out)
            print(f"  -> [SAVE] 최고 성능 갱신, 체크포인트 저장: {args.out}")

    print(f"\n[DONE] 최종 best_macro_f1={best_f1:.4f}, 체크포인트: {args.out}")
    print("다음 단계: python -m services.export_onnx --ckpt", args.out)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=str, default=None, help="실제 학습 데이터 CSV 경로 (services/dataset.py 스키마 참고)")
    parser.add_argument("--n_synthetic", type=int, default=2000, help="csv 미지정시 합성 데이터 샘플 수")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--class_weights", type=float, nargs=5, default=[4.0, 3.0, 1.5, 1.0, 1.0],
                         help="KTAS1~5 순서의 loss 가중치 (중증일수록 크게)")
    parser.add_argument("--out", type=str, default="checkpoints/ktas_best.pt")
    args = parser.parse_args()

    train(args)
