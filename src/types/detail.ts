/**
 * 상세(detail) 컴포넌트 props 묶음 (M3d).
 *
 * DataSections / PresaleInfo / LoanAnalysis 만 큰 3개로 분리 (src/types/components/*.types.ts).
 * 나머지 8개 작은 컴포넌트 props 는 본 파일에 묶음.
 */
import type { Apt } from "./scoring";

/**
 * dataValueColor 함수 시그니처 — DataSections 가 호출처, HighlightField 가 prop 으로 받음.
 */
export type DataValueColorFn = (_field: string, _value: unknown) => string;

/**
 * 인근 시세 단위 행 — apt.priceByArea / rentByArea / jeonseByArea 의 원소.
 * DB 가 Json 으로 저장하므로 sanitize 후 객체 형태.
 */
export interface PriceAreaRow {
  area: number;
  min: number;
  max: number;
  avg: number;
  count?: number;
  rate?: number;
}

/**
 * 학교 정보 행 — apt.nearbySchools 원소.
 */
export interface SchoolRow {
  name: string;
  type?: string;
  highSchoolType?: string;
  schoolType?: string;
  founded?: string;
  classes?: number;
  students?: number;
  distance?: number;
}

/**
 * HighlightField props (31줄).
 * field = FIELD_META 의 키, dataValueColor 는 DataSections 가 보유한 함수.
 */
export interface HighlightFieldProps {
  field: string;
  apt: Apt;
  dataValueColor: DataValueColorFn;
}

/**
 * InfrastructureSection props (30줄).
 * pairs = [[countField, distField|null], ...].
 */
export interface InfrastructureSectionProps {
  pairs: ReadonlyArray<readonly [string, string | null]>;
  apt: Apt;
}

/**
 * PriceChart props (43줄, DetailModal 내).
 */
export interface PriceChartProps {
  apartmentId: string;
  siblingIds?: string[];
}

/**
 * UnsoldChart props (45줄, DetailModal 내).
 */
export interface UnsoldChartProps {
  apartmentId: string;
  siblingIds?: string[];
}

/**
 * SchoolInfo props (67줄).
 */
export interface SchoolInfoProps {
  apt: Apt;
}

/**
 * NearbyChildcareSection props (세션 257 W6-D2).
 */
export interface NearbyChildcareSectionProps {
  apt: Apt;
}

/**
 * PriceTable props (86줄).
 * isLoading / error: 가격배열 lazy fetch (상세 해시 버킷 JSON) 진행 상태.
 */
export interface PriceTableProps {
  apt: Apt;
  isLoading?: boolean;
  error?: string | null;
}

/**
 * LoanRatesSection props (96줄, useLoanRates 호출).
 */
export interface LoanRatesSectionProps {
  apt: Apt;
}

/**
 * MarketStatsCharts props (99줄, 지역 + 구 차트).
 */
export interface MarketStatsChartsProps {
  region?: string;
  gu?: string;
}
