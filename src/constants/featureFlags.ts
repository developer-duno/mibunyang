// Feature Flag 공통 헬퍼 — 5 자리 박제 중복 (App.tsx, UpcomingPage.tsx, BottomNav.tsx,
// HeaderSection.tsx) 단일화. 함수형(런타임 평가)으로 vitest vi.stubEnv 호환.
//
// 추가 시 vite-env.d.ts 의 ImportMetaEnv 타입도 동시 박제 의무.
export const isFeatureUpcoming = (): boolean => import.meta.env.VITE_FEATURE_UPCOMING === "true";

export const isFeatureHome = (): boolean => import.meta.env.VITE_FEATURE_HOME === "true";
