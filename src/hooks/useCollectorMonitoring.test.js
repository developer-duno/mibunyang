/**
 * useCollectorMonitoring 훅 테스트
 *
 * 수집기 모니터링 화면용 훅의 동작을 검증합니다.
 * - 마운트 시 GET /api/admin/collector-status 1회 자동 호출 (Bearer 토큰)
 * - 토큰 없으면 error 세팅 + fetch 미호출
 * - 429 / 401 / !ok 분기별 error·토스트
 * - 정상 응답 시 data 채움
 * - refetch 재호출
 */
// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCollectorMonitoring } from './useCollectorMonitoring';

/**
 * fetch 응답 mock 헬퍼.
 * @param {number} status
 * @param {any} body
 */
function mockRes(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe('useCollectorMonitoring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  // 토큰 없음 → error 세팅, fetch 미호출
  it('토큰이 없으면 인증 필요 error 를 세팅하고 fetch 하지 않는다', async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.error).toBe('관리자 인증이 필요합니다');
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // 정상 응답 → data 채움 + Bearer 헤더
  it('정상 응답 시 data 를 채우고 Bearer 토큰을 보낸다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    const payload = { ok: true, collectors: [{ name: 'x', status: 'ok' }] };
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce(mockRes(200, payload));

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/admin/collector-status', expect.objectContaining({
      headers: { Authorization: 'Bearer tok-1' },
    }));
  });

  // 429 → 토스트 + error
  it('429 응답 시 요청 과다 토스트와 error 를 세팅한다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce(mockRes(429, {}));

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.error).toBe('요청이 너무 많습니다');
    });
    expect(showToast).toHaveBeenCalledWith('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
  });

  // 401 → 세션 만료 토스트 + error
  it('401 응답 시 세션 만료 토스트와 error 를 세팅한다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce(mockRes(401, { ok: false }));

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.error).toBe('관리자 세션이 만료되었습니다');
    });
    expect(showToast).toHaveBeenCalledWith('관리자 세션이 만료되었습니다');
  });

  // json.ok=false → json.error 메시지
  it('json.ok=false 면 json.error 메시지를 세팅한다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce(
      mockRes(200, { ok: false, error: '권한이 없습니다' }),
    );

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.error).toBe('권한이 없습니다');
    });
  });

  // fetch 거부 (네트워크) → 서버 연결 실패 error
  it('네트워크 오류 시 서버 연결 실패 error 를 세팅한다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    /** @type {import('vitest').Mock} */ (fetch).mockRejectedValueOnce(new Error('network down'));

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.error).toBe('서버 연결에 실패했습니다');
    });
  });

  // refetch → fetch 재호출
  it('refetch 호출 시 fetch 를 다시 실행한다', async () => {
    localStorage.setItem('authToken', 'tok-1');
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue(
      mockRes(200, { ok: true, collectors: [] }),
    );

    const showToast = vi.fn();
    const { result } = renderHook(() => useCollectorMonitoring(showToast));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
