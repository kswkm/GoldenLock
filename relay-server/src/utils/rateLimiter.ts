/**
 * 아주 단순한 인메모리 슬라이딩 윈도우 레이트 리미터.
 *
 * 목적: 소켓 인증(WalletAuth)이 "이 주소가 진짜 그 사람이다"는 보장하지만,
 * 인증된 사용자가 온체인 트랜잭션(가스 소비)을 유발하는 이벤트를 짧은 시간에
 * 반복 호출해 relayer의 가스를 소모시키는 것까지 막아주지는 않는다. 이 모듈은
 * 그런 남용을 완화하기 위한 최소한의 안전장치다.
 *
 * 프로덕션에서는 여러 relay-server 인스턴스가 상태를 공유해야 하므로 Redis 등
 * 외부 스토어 기반 리미터로 교체하는 것이 좋다.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly maxCalls: number, private readonly windowMs: number) {}

  /** key(보통 "이벤트명:주소")가 이번 호출을 허용받으면 true, 초과했으면 false. */
  tryConsume(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxCalls) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
