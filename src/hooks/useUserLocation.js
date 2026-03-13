import { useState, useEffect, useRef } from "react";

/**
 * 사용자 위치 감지 → 지역명 반환
 *
 * 1) navigator.geolocation → GPS 좌표
 * 2) /api/location/region?lat=&lng= → Kakao 역지오코딩
 * 3) GPS 거부 시 → /api/location/region (IP fallback)
 *
 * @returns {{ region: string|null, gu: string|null, method: "gps"|"ip"|null, loading: boolean, error: string|null }}
 */
export function useUserLocation() {
  const [state, setState] = useState({ region: null, gu: null, method: null, loading: true, error: null });
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    // 이미 세션에 저장된 위치가 있으면 재사용
    const cached = sessionStorage.getItem("userRegion");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.region) {
          setState({ ...parsed, loading: false, error: null });
          return;
        }
      } catch { /* ignore */ }
    }

    async function detect() {
      try {
        // 1. GPS 시도
        const coords = await getGeoCoords().catch(() => null);

        const params = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : "";
        const res = await fetch(`/api/location/region${params}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          setState(s => ({ ...s, loading: false, error: "위치 API 오류" }));
          return;
        }
        const json = await res.json();

        if (json.ok && json.region) {
          const result = { region: json.region, gu: json.gu ?? null, method: json.method };
          sessionStorage.setItem("userRegion", JSON.stringify(result));
          setState({ ...result, loading: false, error: null });
        } else {
          setState(s => ({ ...s, loading: false, error: json.error ?? "위치 확인 실패" }));
        }
      } catch (err) {
        setState(s => ({ ...s, loading: false, error: err.message }));
      }
    }

    detect();
  }, []);

  return state;
}

function getGeoCoords() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 5000, maximumAge: 300000 }
    );
  });
}
