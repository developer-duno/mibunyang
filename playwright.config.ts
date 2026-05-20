import { defineConfig, devices } from "@playwright/test";

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
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      grep: /@mobile/,
    },
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
    },
  },
});
