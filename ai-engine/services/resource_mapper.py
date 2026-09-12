"""
GoldenLock - ai-engine/services/resource_mapper.py

KTAS 등급(1~5) -> 필요 의료자원 매핑.
relay-server의 매칭 요청(AmbulanceMatchRequest.requiredBeds/requiredSpecialists)과
zk-circuits(hospital_resource.circom)의 public input(requiredBeds, requiredSpecialists)으로
그대로 전달된다. resource_code/label은 사람이 읽기 위한 참고용 값이며 온체인/회로에는
쓰이지 않는다 (온체인 상태는 GoldenLock.sol::EmergencyRequest.ktasLevel로 기록된다).
"""

from typing import Dict

KTAS_RESOURCE_MAP: Dict[int, Dict] = {
    1: {"code": "0x01", "label": "즉시 수술실 + 중환자실(소생)", "priority": 1, "required_beds": 1, "required_specialists": 3},
    2: {"code": "0x02", "label": "중환자실(긴급)", "priority": 2, "required_beds": 1, "required_specialists": 2},
    3: {"code": "0x03", "label": "응급병상 + 전문의(응급)", "priority": 3, "required_beds": 1, "required_specialists": 1},
    4: {"code": "0x04", "label": "일반병상(준응급)", "priority": 4, "required_beds": 1, "required_specialists": 0},
    5: {"code": "0x05", "label": "외래 대기(비응급)", "priority": 5, "required_beds": 0, "required_specialists": 0},
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
        "required_beds": resource["required_beds"],
        "required_specialists": resource["required_specialists"],
    }


def to_zk_public_input(ktas_grade: int) -> Dict[str, int]:
    """hospital_resource.circom / GoldenLock.sol::requestAndLock에 전달할 public input.

    canAccept과 requestHash는 병원 측(브라우저 SnarkJS)에서 계산되므로 여기서는
    구급대가 요청하는 두 값(requiredBeds, requiredSpecialists)만 만들어 돌려준다.
    """
    resource = map_ktas_to_resource(ktas_grade)
    return {
        "requiredBeds": resource["required_beds"],
        "requiredSpecialists": resource["required_specialists"],
    }
