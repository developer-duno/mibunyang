import { test, expect, Page } from "@playwright/test";

// 관리자 대시보드 E2E 테스트 — API 모킹 기반 (실제 Vercel KV 불필요)

/** 모킹용 사용자 데이터 팩토리 */
function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    email: "test@example.com",
    name: "테스트 전문가",
    status: "pending",
    specialty: "부동산 중개",
    affiliation: "테스트 부동산",
    phone: "010-1234-5678",
    license: "공인중개사",
    experience: 5,
    bio: "테스트 자기소개입니다.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const MOCK_PENDING = [
  createMockUser(),
  createMockUser({ email: "user2@example.com", name: "김전문가", specialty: "감정평가" }),
];
const MOCK_APPROVED = [
  createMockUser({ email: "approved@example.com", name: "승인된 전문가", status: "approved" }),
];
const MOCK_REJECTED = [
  createMockUser({ email: "rejected@example.com", name: "거부된 전문가", status: "rejected" }),
];
const MOCK_SUSPENDED = [
  createMockUser({ email: "suspended@example.com", name: "정지된 전문가", status: "suspended" }),
];

/** admin API 모킹 설정 */
async function setupAdminMocks(page: Page) {
  // 로그인 API — admin 역할 반환
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, token: "mock-admin-jwt", user: { email: "admin@test.com" }, role: "admin" }),
    });
  });

  // verify API — admin 인증 유효
  await page.route("**/api/auth/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { email: "admin@test.com" }, role: "admin" }),
    });
  });

  // 로그아웃 API
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "로그아웃되었습니다" }),
    });
  });

  // admin/users API — status 파라미터에 따라 분기
  await page.route("**/api/admin/users*", async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status") || "pending";
    const map: Record<string, unknown[]> = {
      pending: MOCK_PENDING,
      approved: MOCK_APPROVED,
      rejected: MOCK_REJECTED,
      suspended: MOCK_SUSPENDED,
      all: [...MOCK_PENDING, ...MOCK_APPROVED, ...MOCK_REJECTED, ...MOCK_SUSPENDED],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, users: map[status] || [] }),
    });
  });

  // admin/review API — 항상 성공
  await page.route("**/api/admin/review", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "처리되었습니다" }),
    });
  });
}

/** 로그인 폼을 통해 admin으로 진입 */
async function loginAsAdmin(page: Page) {
  await setupAdminMocks(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // 정보 탭 클릭 → InfoPage → 전문가 로그인 버튼
  const infoTab = page.getByText("정보", { exact: true });
  if (await infoTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await infoTab.click();
  }
  const loginCta = page.getByText("전문가 로그인", { exact: false });
  await expect(loginCta).toBeVisible({ timeout: 5000 });
  await loginCta.click();

  // 로그인 폼 채우기 + submit
  await page.locator('input[type="email"]').fill("admin@test.com");
  await page.locator('input[type="password"]').fill("testpassword");
  await page.locator('button[type="submit"]').click();

  // 관리자 대시보드 표시 대기
  await expect(page.getByText("관리자 대시보드")).toBeVisible({ timeout: 10000 });
}

test.describe("관리자 대시보드", () => {

  test("관리자 로그인 후 대시보드 표시", async ({ page }) => {
    await loginAsAdmin(page);

    // 대시보드 헤더 확인
    await expect(page.getByText("관리자 대시보드")).toBeVisible();

    // STATUS_TABS 5개 확인 (대기중/승인됨/거부됨/정지됨/전체)
    await expect(page.locator("button", { hasText: "대기중" })).toBeVisible();
    await expect(page.locator("button", { hasText: "승인됨" })).toBeVisible();
    await expect(page.locator("button", { hasText: "거부됨" })).toBeVisible();
    await expect(page.locator("button", { hasText: "정지됨" })).toBeVisible();
    await expect(page.locator("button", { hasText: "전체" })).toBeVisible();

    // 가중치 관리 + 전문가 신청 관리 섹션 확인
    await expect(page.getByText("가중치 관리")).toBeVisible();
    await expect(page.getByText("전문가 신청 관리")).toBeVisible();
  });

  test("상태 탭 필터링 — 각 탭 클릭 시 사용자 목록 변경", async ({ page }) => {
    await loginAsAdmin(page);

    // 초기: 대기중 탭 → 2명 표시
    await expect(page.getByText("테스트 전문가")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("김전문가")).toBeVisible();

    // 승인됨 탭
    await page.locator("button", { hasText: "승인됨" }).click();
    await expect(page.getByText("승인된 전문가")).toBeVisible({ timeout: 5000 });

    // 거부됨 탭
    await page.locator("button", { hasText: "거부됨" }).click();
    await expect(page.getByText("거부된 전문가")).toBeVisible({ timeout: 5000 });

    // 정지됨 탭
    await page.locator("button", { hasText: "정지됨" }).click();
    await expect(page.getByText("정지된 전문가")).toBeVisible({ timeout: 5000 });

    // 전체 탭
    await page.locator("button", { hasText: "전체" }).click();
    await expect(page.getByText("테스트 전문가")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("승인된 전문가")).toBeVisible();
  });

  test("대기중 사용자 승인 — review API 호출 확인", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText("테스트 전문가")).toBeVisible({ timeout: 5000 });

    // review API 호출 감시 (클릭 전에 설정)
    const reviewPromise = page.waitForRequest((req) =>
      req.url().includes("/api/admin/review") && req.method() === "POST"
    );

    // "승인" 버튼 — pending 카드 안의 버튼만 선택 (exact text로 "승인됨" 탭 제외)
    const approveBtn = page.getByRole("button", { name: "승인", exact: true }).first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    const req = await reviewPromise;
    const body = req.postDataJSON();
    expect(body.action).toBe("approve");
    expect(body.email).toBe("test@example.com");
  });

  test("대기중 사용자 거부 — review API 호출 확인", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText("테스트 전문가")).toBeVisible({ timeout: 5000 });

    const reviewPromise = page.waitForRequest((req) =>
      req.url().includes("/api/admin/review") && req.method() === "POST"
    );

    // "거부" 버튼 — exact로 "거부됨" 탭 제외
    const rejectBtn = page.getByRole("button", { name: "거부", exact: true }).first();
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();

    const req = await reviewPromise;
    const body = req.postDataJSON();
    expect(body.action).toBe("reject");
  });

  test("승인된 사용자 강제 로그아웃 — review API 호출 확인", async ({ page }) => {
    await loginAsAdmin(page);

    // 승인됨 탭 전환
    await page.locator("button", { hasText: "승인됨" }).click();
    await expect(page.getByText("승인된 전문가")).toBeVisible({ timeout: 5000 });

    const reviewPromise = page.waitForRequest((req) =>
      req.url().includes("/api/admin/review") && req.method() === "POST"
    );

    // "강제 로그아웃" 버튼 (유일한 텍스트)
    const forceLogoutBtn = page.getByRole("button", { name: "강제 로그아웃" });
    await expect(forceLogoutBtn).toBeVisible();
    await forceLogoutBtn.click();

    const req = await reviewPromise;
    const body = req.postDataJSON();
    expect(body.action).toBe("force-logout");
  });

  test("정지/거부 사용자 재승인 — review API 호출 확인", async ({ page }) => {
    await loginAsAdmin(page);

    // 정지됨 탭 전환
    await page.locator("button", { hasText: "정지됨" }).click();
    await expect(page.getByText("정지된 전문가")).toBeVisible({ timeout: 5000 });

    const reviewPromise = page.waitForRequest((req) =>
      req.url().includes("/api/admin/review") && req.method() === "POST"
    );

    // "재승인" 버튼
    const reapproveBtn = page.getByRole("button", { name: "재승인" });
    await expect(reapproveBtn).toBeVisible();
    await reapproveBtn.click();

    const req = await reviewPromise;
    const body = req.postDataJSON();
    expect(body.action).toBe("approve");
  });

  test("가중치 편집 — 합계 100% 검증 + 저장 버튼 상태", async ({ page }) => {
    await loginAsAdmin(page);

    // "편집" 버튼 클릭 (첫 번째 프로필)
    const editBtn = page.getByRole("button", { name: "편집" }).first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // 합계 메시지 표시
    await expect(page.getByText("합계:", { exact: false })).toBeVisible({ timeout: 3000 });

    // 모든 input을 0으로 변경 → 합계 0% → 저장 비활성
    const inputs = page.locator('input[type="number"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      await inputs.nth(i).fill("0");
    }

    // 저장 버튼 비활성 확인
    const saveBtn = page.getByRole("button", { name: "저장" });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // 부족 메시지 확인
    await expect(page.getByText("100%가 되어야 합니다", { exact: false })).toBeVisible();

    // 취소 클릭 → 편집 모드 종료
    await page.getByRole("button", { name: "취소" }).click();
    await expect(page.getByText("합계:", { exact: false })).not.toBeVisible({ timeout: 3000 });
  });

  test("도움말 토글 — 열기/닫기", async ({ page }) => {
    await loginAsAdmin(page);

    // 도움말 버튼 → 패널 열기 (AdminDashboard 내부 버튼, HeaderSection의 IconHelp 제외)
    await page.getByText("도움말", { exact: true }).click();
    await expect(page.getByText("관리자 도움말")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("전문가 승인 관리")).toBeVisible();

    // 닫기 버튼 → 패널 닫기
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByText("관리자 도움말")).not.toBeVisible({ timeout: 3000 });
  });

  test("관리자 로그아웃 — 세션 정리 + 대시보드 사라짐", async ({ page }) => {
    await loginAsAdmin(page);

    const logoutPromise = page.waitForRequest((req) =>
      req.url().includes("/api/auth/logout") && req.method() === "POST"
    );

    // AdminDashboard 내부의 로그아웃 버튼 (HeaderSection의 것과 구분)
    // AdminDashboard 헤더 div 안의 로그아웃 버튼 선택
    const adminLogoutBtn = page.locator("button", { hasText: "로그아웃" }).first();
    await adminLogoutBtn.click();

    await logoutPromise;

    // 대시보드 사라짐 확인
    await expect(page.getByText("관리자 대시보드")).not.toBeVisible({ timeout: 5000 });

    // sessionStorage 비워짐 확인
    const token = await page.evaluate(() => sessionStorage.getItem("expertToken"));
    expect(token).toBeNull();
    const role = await page.evaluate(() => sessionStorage.getItem("userRole"));
    expect(role).toBeNull();
  });

  test("429 레이트리밋 — 토스트 메시지 표시", async ({ page }) => {
    // verify + logout 모킹
    await page.route("**/api/auth/verify", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, role: "admin" }) });
    });
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    // users API → 429 응답
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Too many requests" }),
      });
    });

    // admin 세션 주입 후 페이지 로드
    await page.addInitScript(() => {
      sessionStorage.setItem("expertToken", "mock-admin-jwt");
      sessionStorage.setItem("userRole", "admin");
    });
    await page.goto("/");

    // 토스트 메시지 확인 (2.2초 auto-dismiss이므로 빠르게 확인)
    await expect(page.getByText("요청이 너무 많습니다", { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test("세션 만료 — 401 시 자동 로그아웃", async ({ page }) => {
    // users API → 401 + ok:false 응답 (useAdminMode에서 401 감지 → setAdminLoggedIn(false))
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      });
    });
    await page.route("**/api/auth/verify", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "expired" }),
      });
    });
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.addInitScript(() => {
      sessionStorage.setItem("expertToken", "mock-admin-jwt");
      sessionStorage.setItem("userRole", "admin");
    });
    await page.goto("/");

    // 세션 만료 → 토스트 OR 대시보드 사라짐
    const expired = page.getByText("세션이 만료", { exact: false });
    const dashboard = page.getByText("관리자 대시보드");

    // 만료 토스트가 뜨거나, 대시보드가 사라져야 함
    await Promise.race([
      expect(expired).toBeVisible({ timeout: 10000 }),
      expect(dashboard).not.toBeVisible({ timeout: 10000 }),
    ]);
  });

  test("빈 상태 메시지 — 사용자 없는 탭", async ({ page }) => {
    // verify 모킹
    await page.route("**/api/auth/verify", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, role: "admin" }) });
    });
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    // 모든 상태에 빈 배열 반환
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, users: [] }),
      });
    });

    await page.addInitScript(() => {
      sessionStorage.setItem("expertToken", "mock-admin-jwt");
      sessionStorage.setItem("userRole", "admin");
    });
    await page.goto("/");

    // 대시보드 진입 대기
    await expect(page.getByText("관리자 대시보드")).toBeVisible({ timeout: 10000 });

    // 대기중: "대기중인 신청이 없습니다"
    await expect(page.getByText("대기중인 신청이 없습니다")).toBeVisible({ timeout: 5000 });

    // 정지됨: "정지된 사용자가 없습니다"
    await page.locator("button", { hasText: "정지됨" }).click();
    await expect(page.getByText("정지된 사용자가 없습니다")).toBeVisible({ timeout: 5000 });

    // 승인됨: "해당 상태의 사용자가 없습니다"
    await page.locator("button", { hasText: "승인됨" }).click();
    await expect(page.getByText("해당 상태의 사용자가 없습니다")).toBeVisible({ timeout: 5000 });
  });
});
