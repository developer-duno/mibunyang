/**
 * DataSections 컴포넌트 props 타입 (M3d).
 *
 * DataSections.jsx L84:
 *   memo(function DataSections({ apt }))
 */
import type { Apt, Profile } from "@/types/scoring";

export interface DataSectionsProps {
  apt: Apt;
  /** 관리자 모드 (세션 405 전문가 대시보드 이식) — 138필드 전수 표 토글 + 138필드 기준 완성도. 기본 false = 기존 화면 무변경. */
  adminMode?: boolean;
  /** 관리자 138필드 표의 프로필 상위 카테고리 ★ 중점 배지용 (구 ExpertDashboard 세션 382 답습). */
  profile?: Profile;
}

/**
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
