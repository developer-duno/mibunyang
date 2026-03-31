// @vitest-environment node
/**
 * tokenBlacklist.js 테스트 — 해시 결정성, 블랙리스트 등록/확인, Redis 장애 시 fail-open
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// @vercel/kv 모킹
const mockKv = { set: vi.fn(), get: vi.fn() };
vi.mock('@vercel/kv', () => ({ kv: mockKv }));

const { hashToken, blacklistToken, isBlacklisted } = await import('./tokenBlacklist.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashToken', () => {
  // 동일 입력은 항상 같은 해시 반환 (결정성)
  it('동일 토큰에 대해 동일 해시를 반환한다', () => {
    const token = 'test-token-12345';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  // 다른 입력은 다른 해시
  it('다른 토큰에 대해 다른 해시를 반환한다', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  // 32자 길이
  it('해시 길이는 32자이다', () => {
    expect(hashToken('any-token')).toHaveLength(32);
  });
});

describe('blacklistToken', () => {
  // 정상: TTL과 함께 KV에 저장
  it('토큰을 TTL과 함께 KV에 저장한다', async () => {
    const payload = { exp: Date.now() + 3600000 }; // 1시간 후 만료
    await blacklistToken('test-token', payload);
    expect(mockKv.set).toHaveBeenCalledWith(
      expect.stringMatching(/^bl:/),
      1,
      expect.objectContaining({ ex: expect.any(Number) }),
    );
    const ttl = mockKv.set.mock.calls[0][2].ex;
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  // 이미 만료된 토큰은 등록하지 않음
  it('이미 만료된 토큰은 등록하지 않는다', async () => {
    const payload = { exp: Date.now() - 1000 };
    await blacklistToken('expired-token', payload);
    expect(mockKv.set).not.toHaveBeenCalled();
  });
});

describe('isBlacklisted', () => {
  // 정상: 블랙리스트에 있는 토큰
  it('블랙리스트에 있는 토큰은 true를 반환한다', async () => {
    mockKv.get.mockResolvedValue(1);
    expect(await isBlacklisted('blacklisted-token')).toBe(true);
  });

  // 정상: 블랙리스트에 없는 토큰
  it('블랙리스트에 없는 토큰은 false를 반환한다', async () => {
    mockKv.get.mockResolvedValue(null);
    expect(await isBlacklisted('valid-token')).toBe(false);
  });

  // Redis 장애 시 fail-open (가용성 우선)
  it('Redis 장애 시 fail-open (false 반환)', async () => {
    mockKv.get.mockRejectedValue(new Error('Redis down'));
    expect(await isBlacklisted('any-token')).toBe(false);
  });

  // 해시 기반 키 사용 확인
  it('bl:{hash} 형식의 키로 조회한다', async () => {
    mockKv.get.mockResolvedValue(null);
    await isBlacklisted('my-token');
    const key = mockKv.get.mock.calls[0][0];
    expect(key).toMatch(/^bl:[a-f0-9]{32}$/);
  });
});
