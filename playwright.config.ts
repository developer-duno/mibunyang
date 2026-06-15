import { defineConfig, devices } from "@playwright/test";

// 시각 회귀 전용 프로젝트 — PW_VISUAL=1 일 때만 projects 에 포함 (CI 기본 비활성).
const visualProjects = process.env.PW_VISUAL
  ? [
      {
        name: "visual",
        testMatch: /visual\.spec\.ts/,
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
      testIgnore: /visual\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      grep: /@mobile/,
      testIgnore: /visual\.spec\.ts/,
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
    },
  },
});
