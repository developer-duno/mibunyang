/**
 * 공공데이터 섹션 정의 타입 (세션 408 D2a — 구 DataSections 해체 후 dataSections.ts·DataSectionBlock 공용).
 *
 * DATA_SECTIONS 배열 원소 — section 정의.
 * highlight (강조 박스 필드) / pairs (인프라 [count,dist] 쌍) / grid (일반 필드).
 * 셋 다 optional 이지만 적어도 하나는 채워짐.
 */
export interface DataSection {
  title: string;
  highlight?: readonly string[];
  pairs?: ReadonlyArray<readonly [string, string | null]>;
  grid?: readonly string[];
  /** true면 섹션의 모든 필드가 null일 때 "데이터 수집 중..." 대신 섹션 자체를 숨김 (청약 경쟁률 등 부분 보유 필드용) */
  hideWhenEmpty?: boolean;
}
