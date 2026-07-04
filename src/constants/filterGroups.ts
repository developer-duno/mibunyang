/**
 * 상세 필터 그룹 메타 — "비슷한 필터끼리 묶어서 관리"의 진실의 원천 (세션 480)
 *
 * DetailPanel 의 토글 필터 10개를 성격별 4그룹으로 묶는 단일 배열.
 * 라벨·aria-label·색은 DetailPanel.tsx 현행값 1:1 복사 (동작·색 무변경, 순수 시각 그룹화).
 *
 * ⚠️ ToggleFilterKey 는 useFilterSort FilterState 의 boolean 토글 키와 1:1 이어야 함.
 *    DetailPanel 이 이 배열로 map 렌더하며 key 로 { value, onToggle } 을 조회하므로,
 *    key 가 props 와 어긋나면 typecheck(DetailPanel 조회 맵) + drift 가드 테스트가 잡는다.
 *
 * 그룹 내 순서 = 라이브 통과율 낮은(고변별) 필터를 위로 (세션 480 실측, 전체 1576단지):
 *   교통: 역세권 28.6% → 병원 80.6% → 공원 81.6%
 *   가족: 육아 78.2% → 학군 96.7%
 *   자금: DSR 15.4% → 혜택 → 비규제 96.5%
 *   안전: 치안 47.8% → 주차 14.6%  (최소점수·시공사등급은 토글 아님 → 이 그룹 상단 인라인)
 */
import { C, F } from "@/theme";

/** DetailPanel 의 boolean 토글 필터 키 (useFilterSort FilterState 와 1:1) */
export type ToggleFilterKey =
  | "benefitOnly"
  | "subwayOnly"
  | "schoolGoodOnly"
  | "dsrPassOnly"
  | "nonRegulatedOnly"
  | "crimeSafeOnly"
  | "childcareGoodOnly"
  | "parkingGoodOnly"
  | "hospitalNearOnly"
  | "parkNearOnly";

/** 활성 색 base 키 (C[color] / C[color+"Light"] 로 조회) — DetailPanel toggleBtnStyle 과 공유 */
export type ToggleColor = "blue" | "red" | "green" | "pink" | "amber" | "indigo" | "purple" | "cyan";

export type ToggleMeta = {
  key: ToggleFilterKey;
  /** 버튼 표시 텍스트 */
  label: string;
  /** 버튼 aria-label (DetailPanel.tsx 현행값 1:1 — 변경 금지, 테스트가 정확일치로 잡음) */
  ariaLabel: string;
  color: ToggleColor;
};

export type FilterGroup = {
  label: string;
  toggles: readonly ToggleMeta[];
};

export const DETAIL_FILTER_GROUPS: readonly FilterGroup[] = [
  {
    label: "교통·생활편의",
    toggles: [
      { key: "subwayOnly", label: "역세권", ariaLabel: "역세권 매물만(500m 이내)", color: "blue" },
      { key: "hospitalNearOnly", label: "병원가까움", ariaLabel: "병원 도보권만(500m 이내)", color: "red" },
      { key: "parkNearOnly", label: "공원가까움", ariaLabel: "공원 도보권만(500m 이내)", color: "green" },
    ],
  },
  {
    label: "가족·교육",
    toggles: [
      {
        key: "childcareGoodOnly",
        label: "육아인프라",
        ariaLabel: "육아 인프라 좋은 곳만(어린이집 5개+ · 500m 이내)",
        color: "pink",
      },
      { key: "schoolGoodOnly", label: "학군 양호", ariaLabel: "학군 양호(A·B등급) 매물만", color: "green" },
    ],
  },
  {
    label: "자금·규제",
    toggles: [
      { key: "dsrPassOnly", label: "DSR 통과", ariaLabel: "DSR 통과 매물만(자금조달 양호)", color: "indigo" },
      { key: "benefitOnly", label: "혜택", ariaLabel: "혜택 있는 매물만", color: "amber" },
      { key: "nonRegulatedOnly", label: "비규제", ariaLabel: "비규제지역 매물만(매매·대출 자유)", color: "purple" },
    ],
  },
  {
    label: "안전·품질",
    toggles: [
      { key: "crimeSafeOnly", label: "치안안전", ariaLabel: "치안 안전한 동네만(범죄 1~3등급)", color: "cyan" },
      { key: "parkingGoodOnly", label: "주차넉넉", ariaLabel: "주차 넉넉한 곳만(1.5대/세대 이상)", color: "blue" },
    ],
  },
] as const;

/** 전체 토글 개수 (drift 가드 대조군 — useFilterSort FILTER_URL_MAP 의 bool 항목 수와 일치해야 함) */
export const TOGGLE_FILTER_COUNT = DETAIL_FILTER_GROUPS.reduce((n, g) => n + g.toggles.length, 0);

/** 그룹 소제목 스타일 (PresetPanel "추천 프리셋" 소제목 패턴 답습, F.micro=10px 하한 준수) */
export const GROUP_LABEL_STYLE = {
  fontSize: F.micro,
  color: C.muted,
  fontWeight: 600,
  marginBottom: 4,
} as const;
