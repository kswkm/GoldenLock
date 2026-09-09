"""
GoldenLock - ai-engine/services/resource_mapper.py
(내용은 기존과 동일 — import 경로 변경 없음)

KTAS 등급(1~5) -> 필요 의료자원 코드 매핑.
relay-server의 매칭 요청과 zk-circuits(hospital_resource.circom)의
공개 입력(public input)으로 그대로 전달된다.
"""

from typing import Dict

KTAS_RESOURCE_MAP: Dict[int, Dict] = {
    1: {"code": "0x01", "label": "즉시 수술실 + 중환자실(소생)", "priority": 1},
    2: {"code": "0x02", "label": "중환자실(긴급)", "priority": 2},
    3: {"code": "0x03", "label": "응급병상 + 전문의(응급)", "priority": 3},
    4: {"code": "0x04", "label": "일반병상(준응급)", "priority": 4},
    5: {"code": "0x05", "label": "외래 대기(비응급)", "priority": 5},
}


def map_ktas_to_resource(ktas_grade: int) -> Dict:
    if ktas_grade not in KTAS_RESOURCE_MAP:
        raise ValueError(f"유효하지 않은 KTAS 등급: {ktas_grade}")

    resource = KTAS_RESOURCE_MAP[ktas_grade]
    return {
        "ktas_grade": ktas_grade,
        "resource_code": resource["code"],
        "resource_label": resource["label"],
        "priority": resource["priority"],
    }


def to_zk_public_input(ktas_grade: int) -> int:
    resource = map_ktas_to_resource(ktas_grade)
    return int(resource["resource_code"], 16)
