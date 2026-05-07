/**
 * scripts/ 공유 타입 정의 — JSDoc typedef 형태로 .mjs 본체에서 참조.
 *
 * M5a (.mjs 유지 + // @ts-check + JSDoc) 의 인프라.
 * M5d-1 (세션 193): collectors/_shared.mjs + _molit-api.mjs 의 공통 타입 4종 추가.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** 지역 코드 → 코드 매핑 (REGION_MAP, REGION_LAWD_PREFIX, SIDO_CODE 공용) */
export type RegionMap = Record<string, string>;

/** region → gu → 5자리 법정동코드 (GU_LAWD_MAP) */
export type GuLawdMap = Record<string, Record<string, string>>;

/** 건설사 별칭 매핑 (BUILDER_ALIASES) */
export type BuilderAliasMap = Record<string, string>;

/** upsertBatch 옵션 (delayMs, maxRetries) */
export interface UpsertBatchOptions {
  delayMs?: number;
  maxRetries?: number;
}

/** SupabaseClient — _shared/_molit-api JSDoc 에서 참조 */
export type { SupabaseClient };


/**
 * apartments_flat VIEW 의 핵심 컬럼.
 * compute-scores.mjs 의 `sb.from("apartments_flat").select("*")` 결과 타입 추정용.
 *
 * 정확한 컬럼 목록은 supabase/migrations/ 와 src/types/apartment.ts 에 박제.
 * 여기는 scripts/ 가 실제 사용하는 필드만 부분 박제 (Pick 패턴).
 */
export interface ApartmentRow {
  id: number | string;
  name: string;
  region?: string | null;
  // 점수 계산에 필요한 기타 모든 필드는 calcCats 가 처리 — 본 인터페이스는 narrow 용
  [key: string]: unknown;
}

/**
 * 6 카테고리 점수 (price/location/product/benefit/risk/future) 의 한 항목.
 */
export interface CatScore {
  total: number;
  subs: unknown[];
  label: string;
}

/**
 * cats_cache 컬럼에 저장될 6 카테고리 묶음.
 */
export interface CatsCache {
  price?: CatScore;
  location?: CatScore;
  product?: CatScore;
  benefit?: CatScore;
  risk?: CatScore;
  future?: CatScore;
}

/**
 * compute-scores.mjs 의 DB 업서트 행 구조.
 */
export interface ScoreRow {
  id: number | string;
  cats_cache: CatsCache;
}

/**
 * createReporter() 반환 객체 시그니처 (_shared.mjs L463-478).
 */
export interface Reporter {
  success(n?: number): void;
  fail(n?: number): void;
  skip(n?: number): void;
  summary(): {
    elapsed: string;
    ok: number;
    fail: number;
    skip: number;
    total: number;
  };
}

/**
 * Supabase 행 변환 시 NaN/Infinity 를 null 로 직렬화하는 replacer 시그니처.
 */
export type SafeJsonReplacer = (key: string, value: unknown) => unknown;
