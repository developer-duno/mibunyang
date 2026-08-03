import { defineConfig, devices } from "@playwright/test";

// 시각 회귀 스펙 파일 패턴 — `visual.spec.ts` 와 `visual-card.spec.ts` 를 함께 잡는다.
// ⚠️ 이 정규식은 세 곳(visual 프로젝트 testMatch + chromium/mobile testIgnore)이 **같은 값**을
//    써야 한다. 하나만 좁으면 baseline 없는 OS(CI 리눅스)에서 시각 스펙이 실행돼 깨진다
//    (세션 487: 새 파일을 `visual-card.spec.ts` 로 만들 때 실제로 걸린 함정).
const VISUAL_SPECS = /visual.*\.spec\.ts/;

// 시각 회귀 전용 프로젝트 — PW_VISUAL=1 일 때만 projects 에 포함 (CI 기본 비활성).
const visualProjects = process.env.PW_VISUAL
  ? [
      {
        name: "visual",
        testMatch: VISUAL_SPECS,
        // 시각 캡처는 순차 실행. 워커 여러 개가 같은 dev 서버를 동시에 때리면 렌더 타이밍이
        // 흔들려 같은 화면이 몇 픽셀씩 다르게 찍힌다(세션 487 실측: 5워커 병렬에서 5건 중
        // 2건 실패 → 순차 실행에서 전부 통과). 시각 스펙은 몇 건뿐이라 속도 손해가 없다.
        fullyParallel: false,
        use: { ...devices["Desktop Chrome"] },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./e2e",
  tsconfig: "./e2e/tsconfig.e2e.json",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.PW_BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // @visual baseline 은 OS별 픽셀이 달라 win32 로컬 전용 → 일반 e2e 에서 제외.
      // visual.spec 은 testMatch 로 chromium/mobile 진입 자체를 막는다(아래 testIgnore).
      grepInvert: /@mobile/,
      testIgnore: VISUAL_SPECS,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      grep: /@mobile/,
      testIgnore: VISUAL_SPECS,
    },
    // 시각 회귀 전용 프로젝트는 PW_VISUAL=1 일 때만 활성 (아래 visualProjects spread).
    // 로컬 명시 실행만: `PW_VISUAL=1 npx playwright test --project=visual`.
    // baseline 생성: `PW_VISUAL=1 npx playwright test --project=visual --update-snapshots`.
    // CI(Linux)는 win32 baseline 과 픽셀이 달라 기본 비활성.
    ...visualProjects,
  ],
  webServer: {
    command: "npm run dev",
    url: process.env.PW_BASE_URL || "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    // CI e2e.yml 에서 VITE_USE_SUPABASE=true / SUPABASE 키 / FEATURE_UPCOMING 주입 →
    // npm run dev (Vite) 가 import.meta.env 로 받기 위해 명시 전달 의무.
    // 미전달 시 dev 서버는 기본 JSON 폴백 모드로 실행 → CI 의도-실제 불일치.
    env: {
      VITE_USE_SUPABASE: process.env.VITE_USE_SUPABASE ?? "false",
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
      VITE_FEATURE_UPCOMING: process.env.VITE_FEATURE_UPCOMING ?? "false",
      VITE_FEATURE_HOME: process.env.VITE_FEATURE_HOME ?? "false",
      VITE_FEATURE_DEVIATION_STRIP: process.env.VITE_FEATURE_DEVIATION_STRIP ?? "false",
    },
  },
});
