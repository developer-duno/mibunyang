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
