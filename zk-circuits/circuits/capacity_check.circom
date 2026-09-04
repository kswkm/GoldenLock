pragma circom 2.0.0;

// SnarkJS 라이브러리의 비교 연산 회로를 가져옵니다
include "../node_modules/circomlib/circuits/comparators.circom";

template CapacityCheck() {
    // 병원의 현재 가용 자원 (비공개 데이터 - Private)
    signal input current_beds; 
    
    // 환자가 요구하는 자원 (공개 데이터 - Public, 예: 필요 병상 수)
    signal input required_beds; 
    
    // 수용 가능 여부 결과 (공개 데이터 - Public, 1=가능, 0=불가능)
    signal output can_accept;

    // 32비트 숫자 크기 비교 컴포넌트 생성 (current >= required 인지 확인)
    component gte = GreaterEqThan(32);
    
    gte.in[0] <== current_beds;
    gte.in[1] <== required_beds;

    // 비교 결과를 출력으로 연결
    can_accept <== gte.out;
}

// required_beds(요구 자원)만 공개하고 나머지는 숨김 처리
component main {public [required_beds]} = CapacityCheck();