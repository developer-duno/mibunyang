// @vitest-environment node
/**
 * rateLimit.js 테스트 — 레이트 리미팅, Redis 장애 시 fail-close, IP 추출
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// redis.js 모킹 (pipeline 전용)
const mockPipeline = {
  incr: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn(),
};

vi.mock('./redis.js', () => ({
  kv: {
    pipeline: () => mockPipeline,
  },
}));

const { checkRateLimit } = await import('./rateLimit.js');

/** req 목 객체 팩토리 */
function makeReq(ip = '1.2.3.4') {
  return {
    headers: { 'x-forwarded-for': ip },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkRateLimit', () => {
  // 정상: 제한 이내 요청
  it('제한 이내 요청은 limited=false를 반환한다', async () => {
    mockPipeline.exec.mockResolvedValue([1]);
    const result = await checkRateLimit(makeReq(), 'login');
    expect(result.limited).toBe(false);
  });

  // 정상: 제한 초과
  it('제한 초과 시 limited=true와 retryAfter를 반환한다', async () => {
    // login 제한: 5회
    mockPipeline.exec.mockResolvedValue([6]);
    const result = await checkRateLimit(makeReq(), 'login');
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBe(300);
  });

  // 정상: 경계값 (정확히 제한)
  it('정확히 제한 수만큼의 요청은 통과한다', async () => {
    mockPipeline.exec.mockResolvedValue([5]); // login 제한: 5
    const result = await checkRateLimit(makeReq(), 'login');
    expect(result.limited).toBe(false);
  });

  // 정상: 다른 엔드포인트 제한
  it('verify 엔드포인트는 20회 제한이다', async () => {
    mockPipeline.exec.mockResolvedValue([20]);
    const result = await checkRateLimit(makeReq(), 'verify');
    expect(result.limited).toBe(false);

    mockPipeline.exec.mockResolvedValue([21]);
    const result2 = await checkRateLimit(makeReq(), 'verify');
    expect(result2.limited).toBe(true);
  });

  // 에러: Redis 장애 시 fail-close (보안 우선)
  it('Redis 장애 시 fail-close (limited=true)', async () => {
    mockPipeline.exec.mockRejectedValue(new Error('Redis down'));
    const result = await checkRateLimit(makeReq(), 'login');
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBe(300);
  });

  // IP 추출: x-forwarded-for의 마지막 IP 사용
  it('x-forwarded-for에서 마지막 IP를 추출한다', async () => {
    mockPipeline.exec.mockResolvedValue([1]);
    await checkRateLimit({ headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1, 1.2.3.4' } }, 'login');
    expect(mockPipeline.incr).toHaveBeenCalledWith('rl:1.2.3.4:login');
  });

  // IP 추출: x-real-ip 폴백
  it('x-forwarded-for가 없으면 x-real-ip를 사용한다', async () => {
    mockPipeline.exec.mockResolvedValue([1]);
    await checkRateLimit({ headers: { 'x-real-ip': '5.6.7.8' } }, 'signup');
    expect(mockPipeline.incr).toHaveBeenCalledWith('rl:5.6.7.8:signup');
  });

  // IP 추출: 헤더 없으면 "unknown"
  it('IP 헤더가 없으면 "unknown"을 사용한다', async () => {
    mockPipeline.exec.mockResolvedValue([1]);
    await checkRateLimit({ headers: {} }, 'login');
    expect(mockPipeline.incr).toHaveBeenCalledWith('rl:unknown:login');
  });

  // 미등록 엔드포인트는 DEFAULT_MAX(5) 적용
  it('미등록 엔드포인트는 기본 제한(5)이 적용된다', async () => {
    mockPipeline.exec.mockResolvedValue([6]);
    const result = await checkRateLimit(makeReq(), 'unknown-endpoint');
    expect(result.limited).toBe(true);
  });
});
