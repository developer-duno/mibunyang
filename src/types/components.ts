/**
 * 컴포넌트 공통 타입 (M3a a-1).
 *
 * components/* 가 import 하여 .tsx 변환 시 props 타입에 사용.
 * 도메인 타입 (Apt/Cats/Profile/...) = src/types/scoring.ts 에서 박제.
 */

import type { Apt, Cats, ProfileWeights } from "./scoring";

/**
 * 핵심 데이터 prop — 대부분 카드/모달 컴포넌트 공통.
 */
export interface ScoringResult {
  total: number;
  cats: Cats;
}

/**
 * 콜백 prop 묶음 (AptCard / DetailModal 등).
 */
export type DetailHandler = (_apt: Apt) => void;
export type CompareHandler = (_apt: Apt) => void;
export type FavoriteHandler = (_apt: Apt) => void;
export type ExpertViewHandler = (_apt: Apt, _res: ScoringResult) => void;

/**
 * 반응형 상태 prop (대부분 컴포넌트 공통).
 */
export interface ResponsiveProps {
  isDesktop?: boolean;
  isPC?: boolean;
}

/**
 * 인증 상태 prop (LoginPromptModal 트리거).
 */
export interface AuthProps {
  isLoggedIn?: boolean;
}

/**
 * 모달 닫기 콜백 (DetailModal / CompareSheet / ShareSheet 공통).
 */
export type CloseHandler = () => void;

/**
 * 비교 시트 props 일부 (CompareSheet).
 */
export interface CompareItem {
  apt: Apt;
  res: ScoringResult;
}

/**
 * 가중치 prop (PROFILES[profile].w).
 */
export type Weights = ProfileWeights;
