import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUserLocation } from './useUserLocation';

describe('useUserLocation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    // geolocation 모킹
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn(),
      },
      writable: true,
    });
  });

  it('sessionStorage 캐시 히트 → 즉시 반환', async () => {
    sessionStorage.setItem("userRegion", JSON.stringify({ region: "서울", gu: "강남구", method: "gps" }));
    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.region).toBe("서울");
    expect(result.current.gu).toBe("강남구");
    expect(result.current.method).toBe("gps");
  });

  it('GPS 성공 + API 성공', async () => {
    // GPS 성공 시뮬레이션
    navigator.geolocation.getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 37.5, longitude: 127.0 } });
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, region: "서울", gu: "강남구", method: "gps" }),
    }));

    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.region).toBe("서울");
    expect(result.current.method).toBe("gps");
    expect(sessionStorage.getItem("userRegion")).toBeTruthy();
  });

  it('GPS 거부 → IP 폴백', async () => {
    navigator.geolocation.getCurrentPosition.mockImplementation((_, reject) => {
      reject(new Error("denied"));
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, region: "경기", gu: "수원시", method: "ip" }),
    }));

    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.region).toBe("경기");
    expect(result.current.method).toBe("ip");
  });

  it('API 실패 → 에러 상태', async () => {
    navigator.geolocation.getCurrentPosition.mockImplementation((_, reject) => {
      reject(new Error("denied"));
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500,
    }));

    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('API ok=false → 에러 메시지', async () => {
    navigator.geolocation.getCurrentPosition.mockImplementation((_, reject) => {
      reject(new Error("denied"));
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, error: "위치 확인 불가" }),
    }));

    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("위치 확인 불가");
  });

  it('sessionStorage 캐시에 region 없으면 무시하고 감지 시도', async () => {
    sessionStorage.setItem("userRegion", JSON.stringify({ region: null }));

    navigator.geolocation.getCurrentPosition.mockImplementation((_, reject) => {
      reject(new Error("denied"));
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, region: "인천", method: "ip" }),
    }));

    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.region).toBe("인천");
  });
});
