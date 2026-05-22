/**
 * 아파트 데이터 로드 — Supabase API 우선, 정적 JSON 폴백
 *
 * 전환 순서:
 *   1단계: USE_SUPABASE=false (기본) → 기존 JSON
 *   2단계: USE_SUPABASE=true → Supabase API, JSON 폴백
 *   3단계: JSON 제거 (Phase 2 완료 후)
 */
import type { Apt } from "@/types/scoring";

const USE_SUPABASE: boolean = import.meta.env.VITE_USE_SUPABASE === "true";

export interface StaticApartmentsResponse {
  ok: boolean;
  data: Apt[];
  dataUpdatedAt: string | null;
}

export async function fetchStaticApartments(): Promise<StaticApartmentsResponse> {
  if (USE_SUPABASE) {
    try {
      return await fetchFromSupabase();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (import.meta.env.DEV) console.warn("Supabase 실패, 정적 JSON 폴백:", msg);
      return await fetchFromJson();
    }
  }
  return await fetchFromJson();
}

async function fetchFromSupabase(): Promise<StaticApartmentsResponse> {
  const res = await fetch("/api/supabase/apartments");
  if (!res.ok) {
    if (res.status === 429) throw new Error("요청이 너무 많습니다. 잠시 후 새로고침하세요");
    throw new Error(`Supabase API failed: ${res.status}`);
  }
  const json = await res.json() as StaticApartmentsResponse;
  if (!json.ok || !json.data?.length) throw new Error("Supabase data empty");
  return json;
}

async function fetchFromJson(): Promise<StaticApartmentsResponse> {
  const res = await fetch("/data/apartments-list.json");
  if (!res.ok) throw new Error(`Static data fetch failed: ${res.status}`);
  // 정적 JSON 은 양쪽 키 동시 박힘 (`fetchedAt` + `dataUpdatedAt` 동일값, 세션 292 이후).
  // fallback 은 과거 JSON CDN 캐시 + Supabase 분기 응답 호환 위함 — 미래에도 보존.
  const json = await res.json() as { ok: boolean; data: Apt[]; dataUpdatedAt?: string | null; fetchedAt?: string | null };
  if (!json.ok || !json.data?.length) throw new Error("Static data empty");
  return { ok: json.ok, data: json.data, dataUpdatedAt: json.dataUpdatedAt ?? json.fetchedAt ?? null };
}

export interface PriceArrays {
  priceByArea: unknown[] | null;
  rentByArea: unknown[] | null;
  jeonseByArea: unknown[] | null;
  priceByFloor: unknown[] | null;
}

// DetailModal 첫 열림 시 1회 전체 fetch + 모듈 Map 캐시 (useHistoryData 패턴 답습)
const pricesCache = new Map<string, PriceArrays>();
let pricesPromise: Promise<void> | null = null;
let pricesLoaded = false;

// vitest 격리 헬퍼 — 모듈 캐시는 테스트 간 공유되므로 beforeEach 에서 비운다.
export function _clearPricesCache(): void {
  pricesCache.clear();
  pricesPromise = null;
  pricesLoaded = false;
}

async function loadPricesOnce(): Promise<void> {
  if (pricesLoaded) return;
  // 진행 중이면 같은 Promise 대기 (동시 호출 dedup). rejected 상태면
  // fetchApartmentPrices 의 catch 가 pricesPromise = null 로 reset → 다음 진입 시 새 fetch.
  if (pricesPromise) return pricesPromise;
  pricesPromise = (async () => {
    const res = await fetch("/data/apartments-prices.json");
    if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`);
    const json = await res.json() as { ok: boolean; data: Array<{ id: string } & PriceArrays> };
    if (!json.ok || !Array.isArray(json.data)) throw new Error("Prices data empty");
    for (const row of json.data) {
      const { id, ...rest } = row;
      pricesCache.set(id, rest);
    }
    pricesLoaded = true;
  })();
  return pricesPromise;
}

export async function fetchApartmentPrices(id: string): Promise<PriceArrays | null> {
  if (!pricesLoaded) {
    try { await loadPricesOnce(); }
    catch (err) {
      // 재시도 허용: pricesPromise = null reset → 다음 호출 시 새 fetch.
      // 본 라인이 없으면 다음 호출 시 if(pricesPromise) return pricesPromise 가 rejected Promise 를
      // 반환해 무한 throw loop 가 된다.
      pricesPromise = null;
      throw err;
    }
  }
  return pricesCache.get(id) ?? null;
}
