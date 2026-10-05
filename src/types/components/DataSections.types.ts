/**
 * 공공데이터 섹션 정의 타입 (세션 408 D2a — 구 DataSections 해체 후 dataSections.ts·DataSectionBlock 공용).
 *
 * DATA_SECTIONS 배열 원소 — section 정의.
 * highlight (강조 박스 필드) / grid (일반 필드). 둘 다 optional 이지만 적어도 하나는 채워짐.
 */
export interface DataSection {
  title: string;
  highlight?: readonly string[];
  grid?: readonly string[];
  // 옛 `hideWhenEmpty` 칸은 뺐다 — 필드 전부 null 이면 섹션 자체를 안 그린다(세션595, 전 섹션 기본 · `DataSectionBlock`).
  /** 섹션 제목 옆 ? 도움말 "보는 법" 카피 (세션 411). 채운 섹션만 HelpHint 노출 — 다른 탭 섹션도 hint만 추가하면 자동 적용. */
  hint?: string;
}
