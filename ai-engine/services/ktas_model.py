"""
GoldenLock - ai-engine/services/ktas_model.py
(내용은 기존과 동일 — 이 파일 자체는 위치가 바뀌어도 import 경로 영향 없음)

온디바이스 KTAS(중증도) 분류 멀티모달 모델 (PyTorch)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class DepthwiseSeparableConv1d(nn.Module):
    def __init__(self, in_ch, out_ch, kernel_size, stride=1, padding=0):
        super().__init__()
        self.depthwise = nn.Conv1d(
            in_ch, in_ch, kernel_size, stride=stride,
            padding=padding, groups=in_ch, bias=False
        )
        self.pointwise = nn.Conv1d(in_ch, out_ch, kernel_size=1, bias=False)
        self.bn = nn.BatchNorm1d(out_ch)
        self.act = nn.ReLU(inplace=True)

    def forward(self, x):
        x = self.depthwise(x)
        x = self.pointwise(x)
        x = self.bn(x)
        return self.act(x)


class VitalSignEncoder(nn.Module):
    def __init__(self, in_channels: int = 3, hidden_dim: int = 64, out_dim: int = 64):
        super().__init__()
        self.stem = nn.Conv1d(in_channels, 16, kernel_size=7, stride=2, padding=3)
        self.bn_stem = nn.BatchNorm1d(16)

        self.block1 = DepthwiseSeparableConv1d(16, 32, kernel_size=5, stride=2, padding=2)
        self.block2 = DepthwiseSeparableConv1d(32, hidden_dim, kernel_size=5, stride=2, padding=2)
        self.block3 = DepthwiseSeparableConv1d(hidden_dim, hidden_dim, kernel_size=3, stride=1, padding=1)

        self.pool = nn.AdaptiveAvgPool1d(1)
        self.proj = nn.Linear(hidden_dim, out_dim)

    def forward(self, x):
        x = F.relu(self.bn_stem(self.stem(x)))
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.pool(x).squeeze(-1)
        return self.proj(x)


class TextAdapter(nn.Module):
    def __init__(self, in_dim: int = 768, out_dim: int = 64, dropout: float = 0.2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, out_dim),
        )

    def forward(self, x):
        return self.net(x)


class MetaEncoder(nn.Module):
    def __init__(self, in_dim: int = 16, out_dim: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 32),
            nn.ReLU(inplace=True),
            nn.Linear(32, out_dim),
        )

    def forward(self, x):
        return self.net(x)


class GatedFusion(nn.Module):
    def __init__(self, dim_ecg: int, dim_text: int, dim_meta: int, fused_dim: int = 128):
        super().__init__()
        total_in = dim_ecg + dim_text + dim_meta
        self.gate = nn.Sequential(
            nn.Linear(total_in, 3),
            nn.Softmax(dim=-1)
        )
        self.proj_ecg = nn.Linear(dim_ecg, fused_dim)
        self.proj_text = nn.Linear(dim_text, fused_dim)
        self.proj_meta = nn.Linear(dim_meta, fused_dim)
        self.norm = nn.LayerNorm(fused_dim)

    def forward(self, ecg_vec, text_vec, meta_vec):
        concat = torch.cat([ecg_vec, text_vec, meta_vec], dim=-1)
        gates = self.gate(concat)
        g_ecg, g_text, g_meta = gates[:, 0:1], gates[:, 1:2], gates[:, 2:3]

        fused = (
            g_ecg * self.proj_ecg(ecg_vec)
            + g_text * self.proj_text(text_vec)
            + g_meta * self.proj_meta(meta_vec)
        )
        return self.norm(fused), gates


class KTASClassifierHead(nn.Module):
    def __init__(self, fused_dim: int = 128, num_classes: int = 5, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(fused_dim, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        return self.net(x)


class KTASMultimodalNet(nn.Module):
    def __init__(
        self,
        ecg_in_channels: int = 3,
        text_in_dim: int = 768,
        meta_in_dim: int = 16,
        embed_dim: int = 64,
        fused_dim: int = 128,
        num_classes: int = 5,
    ):
        super().__init__()
        self.vital_encoder = VitalSignEncoder(in_channels=ecg_in_channels, out_dim=embed_dim)
        self.text_adapter = TextAdapter(in_dim=text_in_dim, out_dim=embed_dim)
        self.meta_encoder = MetaEncoder(in_dim=meta_in_dim, out_dim=embed_dim // 2)

        self.fusion = GatedFusion(
            dim_ecg=embed_dim,
            dim_text=embed_dim,
            dim_meta=embed_dim // 2,
            fused_dim=fused_dim,
        )
        self.head = KTASClassifierHead(fused_dim=fused_dim, num_classes=num_classes)

    def forward(self, ecg, text_emb, meta):
        ecg_vec = self.vital_encoder(ecg)
        text_vec = self.text_adapter(text_emb)
        meta_vec = self.meta_encoder(meta)

        fused, gates = self.fusion(ecg_vec, text_vec, meta_vec)
        logits = self.head(fused)
        return logits, gates


class WeightedFocalLoss(nn.Module):
    def __init__(self, class_weights=None, gamma: float = 2.0):
        super().__init__()
        self.gamma = gamma
        self.register_buffer(
            "class_weights",
            torch.tensor(class_weights if class_weights else [4.0, 3.0, 1.5, 1.0, 1.0])
        )

    def forward(self, logits, targets):
        ce = F.cross_entropy(logits, targets, weight=self.class_weights, reduction="none")
        pt = torch.exp(-ce)
        focal = ((1 - pt) ** self.gamma) * ce
        return focal.mean()


if __name__ == "__main__":
    model = KTASMultimodalNet()
    ecg = torch.randn(4, 3, 500)
    text_emb = torch.randn(4, 768)
    meta = torch.randn(4, 16)
    labels = torch.randint(0, 5, (4,))

    logits, gates = model(ecg, text_emb, meta)
    loss_fn = WeightedFocalLoss()
    loss = loss_fn(logits, labels)

    print("logits shape:", logits.shape)
    print("gates (modality 기여도):", gates)
    print("loss:", loss.item())
