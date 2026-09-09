"""
GoldenLock - ai-engine/services/export_onnx.py
학습된 PyTorch KTASMultimodalNet -> ONNX 변환 -> INT8 PTQ

실행 (ai-engine/ 루트에서, 모듈 형태로 -> 상대 import 안전):
  python -m services.export_onnx --ckpt checkpoints/ktas_best.pt \
      --fp32_out models/ktas_classifier_fp32.onnx \
      --int8_out models/ktas_classifier.onnx
"""

import argparse
import torch
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

from services.ktas_model import KTASMultimodalNet


def export_to_onnx(model: torch.nn.Module, out_path: str, device="cpu"):
    model.eval().to(device)

    dummy_ecg = torch.randn(1, 3, 500, device=device)
    dummy_text = torch.randn(1, 768, device=device)
    dummy_meta = torch.randn(1, 16, device=device)

    torch.onnx.export(
        model,
        (dummy_ecg, dummy_text, dummy_meta),
        out_path,
        input_names=["ecg", "text_emb", "meta"],
        output_names=["logits", "modality_gates"],
        dynamic_axes={
            "ecg": {0: "batch", 2: "seq_len"},
            "text_emb": {0: "batch"},
            "meta": {0: "batch"},
            "logits": {0: "batch"},
            "modality_gates": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"[OK] FP32 ONNX exported -> {out_path}")

    onnx_model = onnx.load(out_path)
    onnx.checker.check_model(onnx_model)
    print("[OK] ONNX 모델 구조 검증 통과")


def quantize_to_int8(fp32_path: str, int8_path: str):
    quantize_dynamic(
        model_input=fp32_path,
        model_output=int8_path,
        weight_type=QuantType.QInt8,
    )
    print(f"[OK] INT8 양자화 완료 -> {int8_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt", type=str, default=None, help="학습된 state_dict 경로(.pt)")
    parser.add_argument("--fp32_out", type=str, default="models/ktas_classifier_fp32.onnx")
    parser.add_argument("--int8_out", type=str, default="models/ktas_classifier.onnx")
    args = parser.parse_args()

    model = KTASMultimodalNet()
    if args.ckpt:
        state_dict = torch.load(args.ckpt, map_location="cpu")
        model.load_state_dict(state_dict)
        print(f"[OK] 체크포인트 로드: {args.ckpt}")
    else:
        print("[WARN] --ckpt 미지정: 랜덤 초기화 가중치로 export (구조 검증용)")

    export_to_onnx(model, args.fp32_out)
    quantize_to_int8(args.fp32_out, args.int8_out)

    print("\n최종 배포 파일: ", args.int8_out)
    print("이 파일을 ai-engine/models/ktas_classifier.onnx 로 배치하세요.")
