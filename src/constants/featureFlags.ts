// Feature Flag 공통 헬퍼 — 5 자리 박제 중복 (App.tsx, UpcomingPage.tsx, BottomNav.tsx,
// HeaderSection.tsx) 단일화. 함수형(런타임 평가)으로 vitest vi.stubEnv 호환.
//
// 추가 시 vite-env.d.ts 의 ImportMetaEnv 타입도 동시 박제 의무.
export const isFeatureUpcoming = (): boolean => import.meta.env.VITE_FEATURE_UPCOMING === "true";

export const isFeatureHome = (): boolean => import.meta.env.VITE_FEATURE_HOME === "true";

/**
 * 카드 편차 스트립 (세션 487 시각화 PR-3).
 * 카드 30장이 한 번에 바뀌는 변경이라 플래그 뒤에 둔다 — 배포 후 문제가 보이면
 * 재배포 없이 환경변수만 내려 원상 복구할 수 있다.
 */
export const isFeatureDeviationStrip = (): boolean => import.meta.env.VITE_FEATURE_DEVIATION_STRIP === "true";
