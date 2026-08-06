/**
 * 아파트 데이터 로드 — Supabase API 우선, 정적 JSON 폴백
 *
 * 전환 순서:
 *   1단계: USE_SUPABASE=false (기본) → 기존 JSON
 *   2단계: USE_SUPABASE=true → Supabase API, JSON 폴백
 *   3단계: JSON 제거 (Phase 2 완료 후)
 */
import type { Apt } from "@/types/scoring";
import { bucketOf, detailBucketName } from "@/utils/bucketHash.mjs";

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
  const json = (await res.json()) as StaticApartmentsResponse;
  if (!json.ok || !json.data?.length) throw new Error("Supabase data empty");
  return json;
}

async function fetchFromJson(): Promise<StaticApartmentsResponse> {
  const res = await fetch("/data/apartments-list.json");
  if (!res.ok) throw new Error(`Static data fetch failed: ${res.status}`);
  // 정적 JSON 은 양쪽 키 동시 박힘 (`fetchedAt` + `dataUpdatedAt` 동일값, 세션 292 이후).
  // fallback 은 과거 JSON CDN 캐시 + Supabase 분기 응답 호환 위함 — 미래에도 보존.
  const json = (await res.json()) as {
    ok: boolean;
    data: Apt[];
    dataUpdatedAt?: string | null;
    fetchedAt?: string | null;
  };
  if (!json.ok || !json.data?.length) throw new Error("Static data empty");
  return { ok: json.ok, data: json.data, dataUpdatedAt: json.dataUpdatedAt ?? json.fetchedAt ?? null };
}

// 상세 버킷 필드 (세션 468) — 목록 JSON 에서 슬림된 상세 전용 필드 + 가격배열 + full catsCache.
// DetailModal 이 버킷 1개 fetch 로 한 번에 받아 mergedApt/mergedRes 로 복원.
// 가격배열 4개는 구 apartments-prices.json 이 싣던 것 — PR2(세션 495)에서 그 파일 생성을
// 중단하며 버킷이 유일한 출처가 됐다(PriceArrays 인터페이스는 여기로 흡수).
export interface AptDetailFields {
  priceByArea: unknown[] | null;
  rentByArea: unknown[] | null;
  jeonseByArea: unknown[] | null;
  priceByFloor: unknown[] | null;
  catsCache?: unknown;
  nearbySchools?: unknown[] | null;
  nearbyChildcare?: unknown[] | null;
  nearbyFacilities?: unknown[] | null;
  benefits?: unknown[] | null;
}

// ─── 상세 버킷 lazy fetch (세션 468) ───
// DetailModal 첫 열림 시 id 해시 버킷 1개만 fetch (br ~69KB). 버킷 단위 Map 캐시 +
// 버킷별 promise dedup + reject 시 reset.
// FIFO 상한 8버킷 = 최악 누적 ~7MB (세션 279 모바일 OOM 후순위 메모 대응).
const DETAIL_CACHE_MAX_BUCKETS = 8;
const detailCache = new Map<number, Map<string, AptDetailFields>>();
const detailPromise = new Map<number, Promise<void>>();

// vitest 격리 헬퍼 — 모듈 캐시는 테스트 간 공유되므로 beforeEach 에서 비운다.
export function _clearDetailCache(): void {
  detailCache.clear();
  detailPromise.clear();
}

function evictOldestBucketIfNeeded(): void {
  while (detailCache.size > DETAIL_CACHE_MAX_BUCKETS) {
    const oldest = detailCache.keys().next().value; // Map 삽입 순서 = FIFO
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
}

async function loadDetailBucketOnce(bucket: number): Promise<void> {
  if (detailCache.has(bucket)) return;
  // detailPromise 는 **진행 중** 요청만 담는다(dedup 용). 성공/실패 후엔 finally 로 비운다 —
  // FIFO evict 로 캐시에서 밀려난 버킷의 settled promise 가 남아 재fetch 를 막던 버그 방지(세션 468).
  const inflight = detailPromise.get(bucket);
  if (inflight) return inflight;
  const p = (async () => {
    const res = await fetch(`/data/${detailBucketName(bucket)}`);
    if (!res.ok) throw new Error(`Detail bucket fetch failed: ${res.status}`);
    // vercel.json rewrite `/(.*)→/index.html`: 부재 버킷 URL 은 200 + HTML 을 반환한다.
    // res.ok 는 통과하므로 content-type 으로 걸러 SyntaxError 대신 명시 throw.
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) throw new Error(`Detail bucket not JSON (content-type: ${ct})`);
    const json = (await res.json()) as { ok: boolean; data: Array<{ id: string } & AptDetailFields> };
    if (!json.ok || !Array.isArray(json.data)) throw new Error("Detail bucket data empty");
    const m = new Map<string, AptDetailFields>();
    for (const row of json.data) {
      const { id, ...rest } = row;
      m.set(id, rest);
    }
    detailCache.set(bucket, m);
    evictOldestBucketIfNeeded();
  })().finally(() => {
    detailPromise.delete(bucket);
  });
  detailPromise.set(bucket, p);
  return p;
}

export async function fetchApartmentDetail(id: string): Promise<AptDetailFields | null> {
  const bucket = bucketOf(id);
  if (!detailCache.has(bucket)) {
    await loadDetailBucketOnce(bucket); // 실패 시 throw — finally 가 이미 promise 비움(재시도 허용)
  }
  return detailCache.get(bucket)?.get(id) ?? null;
}
