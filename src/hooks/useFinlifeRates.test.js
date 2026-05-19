/**
 * useFinlifeRates 훅 테스트
 *
 * finlife 금리 데이터 페칭 공통 팩토리의 동작을 검증합니다.
 * - 정상 응답 시 rates 채움 + cacheRef 저장
 * - 캐시 있으면 fetch 미호출
 * - HTTP 오류 / json.ok=false 시 error 세팅
 * - apiPath 에 ? 유무에 따른 구분자(? / &) 처리
 */
// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFinlifeRates } from './useFinlifeRates';

/**
 * 단일값 캐시 ref 헬퍼 — getCached/setCached 쌍.
 * @param {unknown} [initial]
 */
function makeCacheRef(initial = null) {
  return {
    ref: { current: initial },
    get: (/** @type {{ current: unknown }} */ r) => r.current,
    set: (/** @type {{ current: unknown }} */ r, /** @type {unknown} */ d) => { r.current = d; },
  };
}

const SAMPLE = [{ bank: 'A은행', product: '정기예금', rateMin: 3.1, rateMax: 3.5 }];

describe('useFinlifeRates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  // 정상 응답 → rates 채움
  it('정상 응답 시 rates 를 채운다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: SAMPLE }),
    });
    const c = makeCacheRef();
    const { result } = renderHook(() =>
      useFinlifeRates('/api/finlife/rates', '020000', c.ref, c.get, c.set),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rates).toEqual(SAMPLE);
    expect(result.current.error).toBeNull();
  });

  // 정상 응답 → cacheRef 에 저장
  it('정상 응답을 cacheRef 에 저장한다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: SAMPLE }),
    });
    const c = makeCacheRef();
    renderHook(() => useFinlifeRates('/api/x', '02', c.ref, c.get, c.set));

    await waitFor(() => {
      expect(c.ref.current).toEqual(SAMPLE);
    });
  });

  // 캐시가 있으면 fetch 미호출
  it('cacheRef 에 데이터가 있으면 fetch 하지 않는다', async () => {
    const c = makeCacheRef(SAMPLE);
    const { result } = renderHook(() =>
      useFinlifeRates('/api/x', '02', c.ref, c.get, c.set),
    );

    await waitFor(() => {
      expect(result.current.rates).toEqual(SAMPLE);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // HTTP 오류 → error 세팅
  it('HTTP 오류 시 error 를 세팅한다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({ ok: false, status: 500 });
    const c = makeCacheRef();
    const { result } = renderHook(() => useFinlifeRates('/api/x', '02', c.ref, c.get, c.set));

    await waitFor(() => {
      expect(result.current.error).toBe('API 오류 (500)');
    });
    expect(result.current.loading).toBe(false);
  });

  // json.ok=false → error 메시지
  it('json.ok=false 면 error 메시지를 세팅한다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: '쿼터 초과' }),
    });
    const c = makeCacheRef();
    const { result } = renderHook(() => useFinlifeRates('/api/x', '02', c.ref, c.get, c.set));

    await waitFor(() => {
      expect(result.current.error).toBe('쿼터 초과');
    });
  });

  // apiPath 에 ? 가 없으면 ? 로, 있으면 & 로 topFinGrpNo 연결
  it('apiPath 구분자를 ?/& 로 올바르게 붙인다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: [] }),
    });

    const c1 = makeCacheRef();
    renderHook(() => useFinlifeRates('/api/x', '050000', c1.ref, c1.get, c1.set));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/x?topFinGrpNo=050000', expect.anything());
    });

    const c2 = makeCacheRef();
    renderHook(() => useFinlifeRates('/api/x?foo=1', '050000', c2.ref, c2.get, c2.set));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/x?foo=1&topFinGrpNo=050000', expect.anything());
    });
  });

  // data 누락 응답 → 빈 배열
  it('응답에 data 가 없으면 빈 배열로 처리한다', async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const c = makeCacheRef();
    const { result } = renderHook(() => useFinlifeRates('/api/x', '02', c.ref, c.get, c.set));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rates).toEqual([]);
  });
});
