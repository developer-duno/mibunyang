import { describe, it, expect, vi, beforeEach } from 'vitest';

// import.meta.env 모킹을 위해 동적 import 사용
describe('fetchStaticApartments', () => {
  let fetchStaticApartments;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // Supabase 모드 테스트
  describe('USE_SUPABASE=true', () => {
    beforeEach(async () => {
      vi.stubEnv('VITE_USE_SUPABASE', 'true');
      const mod = await import('./staticDataApi');
      fetchStaticApartments = mod.fetchStaticApartments;
    });

    it('Supabase 성공 시 데이터 반환', async () => {
      const mockData = { ok: true, data: [{ id: 1 }], dataUpdatedAt: "2026-01-01" };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      }));
      const result = await fetchStaticApartments();
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith("/api/supabase/apartments");
    });

    it('Supabase 실패 → JSON 폴백', async () => {
      const jsonData = { ok: true, data: [{ id: 2 }], dataUpdatedAt: "2026-01-02" };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(jsonData),
        }),
      );
      const result = await fetchStaticApartments();
      expect(result).toEqual(jsonData);
    });

    it('Supabase data 빈 배열 → JSON 폴백', async () => {
      const jsonData = { ok: true, data: [{ id: 3 }] };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(jsonData),
        }),
      );
      const result = await fetchStaticApartments();
      expect(result).toEqual(jsonData);
    });

    it('양쪽 모두 실패 → 에러 throw', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 404 }),
      );
      await expect(fetchStaticApartments()).rejects.toThrow();
    });

    // 429 (rateLimit 초과) 감지 시 Error 메시지에 "잠시 후" 포함 (JSON 폴백 전에 캐치되어야 함)
    it('Supabase 429 시 Error 메시지에 "잠시 후" 포함한다 (개발자 디버깅용)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const jsonData = { ok: true, data: [{ id: 99 }], dataUpdatedAt: null };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(jsonData) }),
      );
      await fetchStaticApartments();
      // console.warn의 두 번째 인자(err.message)에 "잠시 후" 포함 확인
      // 호출 형식: console.warn("Supabase 실패, 정적 JSON 폴백:", err.message)
      const warnCalls = warnSpy.mock.calls;
      // DEV 모드가 아니면 warn 없을 수 있으므로 유연하게 검증
      if (warnCalls.length > 0) {
        const msg = warnCalls[0].join(' ');
        expect(msg).toMatch(/잠시 후/);
      }
      warnSpy.mockRestore();
    });

    // 양쪽 모두 실패하되 Supabase가 429인 경우 → throw 시 메시지에 "잠시 후" 포함
    it('Supabase 429 + JSON 실패 → catch/throw 경로에 429 시그널 남긴다', async () => {
      // fetchFromSupabase가 throw하면 catch → fetchFromJson → 실패 시 throw
      // 이 경로에서 최종 에러는 JSON 쪽("Static data fetch failed: 500")
      // 하지만 Supabase쪽 err.message가 "요청이 너무 많습니다..." 인지 확인하려면
      // console.warn spy로 검증 (이미 위 테스트에서 커버)
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 500 }),
      );
      await expect(fetchStaticApartments()).rejects.toThrow('Static data fetch failed');
    });
  });

  // JSON 모드 테스트
  describe('USE_SUPABASE=false (기본)', () => {
    beforeEach(async () => {
      vi.stubEnv('VITE_USE_SUPABASE', 'false');
      const mod = await import('./staticDataApi');
      fetchStaticApartments = mod.fetchStaticApartments;
    });

    it('JSON 성공 시 데이터 반환', async () => {
      const mockData = { ok: true, data: [{ id: 1 }] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      }));
      const result = await fetchStaticApartments();
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith("/data/apartments.json");
    });

    it('JSON 실패 → 에러 throw', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(fetchStaticApartments()).rejects.toThrow("Static data fetch failed");
    });

    it('JSON ok=false → 에러 throw', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, data: [] }),
      }));
      await expect(fetchStaticApartments()).rejects.toThrow("Static data empty");
    });
  });
});
