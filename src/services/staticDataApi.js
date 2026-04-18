/**
 * 아파트 데이터 로드 — Supabase API 우선, 정적 JSON 폴백
 *
 * 전환 순서:
 *   1단계: USE_SUPABASE=false (기본) → 기존 JSON
 *   2단계: USE_SUPABASE=true → Supabase API, JSON 폴백
 *   3단계: JSON 제거 (Phase 2 완료 후)
 */
const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === "true";

export async function fetchStaticApartments() {
  if (USE_SUPABASE) {
    try {
      return await fetchFromSupabase();
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Supabase 실패, 정적 JSON 폴백:", err.message);
      return await fetchFromJson();
    }
  }
  return await fetchFromJson();
}

async function fetchFromSupabase() {
  const res = await fetch("/api/supabase/apartments");
  if (!res.ok) {
    if (res.status === 429) throw new Error("요청이 너무 많습니다. 잠시 후 새로고침하세요");
    throw new Error(`Supabase API failed: ${res.status}`);
  }
  const json = await res.json();
  if (!json.ok || !json.data?.length) throw new Error("Supabase data empty");
  return json;
}

async function fetchFromJson() {
  const res = await fetch("/data/apartments.json");
  if (!res.ok) throw new Error(`Static data fetch failed: ${res.status}`);
  const json = await res.json();
  if (!json.ok || !json.data?.length) throw new Error("Static data empty");
  return json;
}
