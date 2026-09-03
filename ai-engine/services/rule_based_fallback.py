"""
GoldenLock - ai-engine/services/rule_based_fallback.py

학습된 모델이 준비되기 전(또는 모델 로드 실패/신뢰도 낮음 시) 데모 흐름을 끊기지 않게 하는
규칙 기반(rule-based) KTAS 산출 폴백.

⚠️ 주의: 이건 실제 임상 트리아지 알고리즘이 아니라 vitals 임계값 기반의 아주 단순한 근사입니다.
   데모/개발 단계에서 "AI 모델 미탑재 시에도 시스템 전체 흐름은 동작한다"를 보여주는 용도로만 쓰세요.
   실제 서비스에서는 반드시 의료진 감수를 거친 검증된 트리아지 규칙(또는 학습된 모델)으로 교체해야 합니다.
"""

from typing import Dict, List


def _avg(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def rule_based_ktas(vitals: Dict[str, List[float]], meta: Dict) -> Dict:
    """
    아주 단순한 vitals 임계값 기반 KTAS 근사 산출.
    (참고: 실제 KTAS는 활력징후뿐 아니라 통증척도, 의식수준(AVPU/GCS), 주호소 등을 종합 평가함)
    """
    hr = _avg(vitals.get("hr", []))
    spo2 = _avg(vitals.get("spo2", []))
    age = meta.get("age", 40)

    # 심각도가 높은 순서로 체크 (첫 매칭 규칙 적용)
    if spo2 and spo2 < 85:
        grade = 1
        reason = f"SpO2 {spo2:.0f}% (심각한 저산소증)"
    elif hr and (hr > 150 or hr < 40):
        grade = 1
        reason = f"HR {hr:.0f}bpm (심각한 부정맥/서맥·빈맥)"
    elif spo2 and spo2 < 90:
        grade = 2
        reason = f"SpO2 {spo2:.0f}% (저산소증)"
    elif hr and (hr > 130 or hr < 50):
        grade = 2
        reason = f"HR {hr:.0f}bpm (빈맥/서맥)"
    elif spo2 and spo2 < 94:
        grade = 3
        reason = f"SpO2 {spo2:.0f}% (경미한 저산소증)"
    elif hr and hr > 110:
        grade = 3
        reason = f"HR {hr:.0f}bpm (경도 빈맥)"
    elif age >= 75 or age <= 2:
        grade = 3
        reason = "고령/영유아 - 보수적 등급 상향"
    elif hr and hr > 100:
        grade = 4
        reason = f"HR {hr:.0f}bpm (경미한 이상)"
    else:
        grade = 5
        reason = "활력징후 정상 범위"

    return {
        "ktas_grade": grade,
        "confidence": 0.0,          # 규칙기반은 confidence 개념이 없음 -> 0으로 표기해 AI 결과와 구분
        "source": "rule_based_fallback",
        "reason": reason,
    }
