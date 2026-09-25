import { test, expect } from "@playwright/test";

// 문의 창구 통합 (세션 577 A-12) — 메뉴 "문의" = 문의 모달(의견 보내기 · 🏢 업체 문의 탭).
// 비로그인 손님: 의견 탭은 로그인 안내 버튼만, 업체 문의 탭은 로그인 없이 제출된다.
// /api/consults 는 route 로 가로채 201 을 준다 — 실제 저장·텔레그램 0.
test.describe("문의하기", () => {
  test("비로그인: 메뉴 '문의' → 업체 문의 탭 제출 → 토스트 + 본문 consultType 업체문의", async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null;
    await page.route("**/api/consults", async (route) => {
      if (route.request().method() === "POST") {
        postedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await page.goto("/");
    // 데스크톱 = 헤더 네비, 휴대폰 = 하단 네비. 둘 중 보이는 쪽 하나만 있다(떠 있는 버튼은 이름이 "문의하기").
    await page.getByRole("button", { name: "문의", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "문의하기" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "카카오 로그인하고 의견 보내기" })).toBeVisible();

    await dialog.getByRole("tab", { name: /🏢 업체 문의/ }).click();
    await expect(dialog.getByLabel("회사명", { exact: true })).toBeVisible();

    await dialog.getByLabel("회사명", { exact: true }).fill("이로움건설");
    await dialog.getByLabel("담당자", { exact: true }).fill("김담당");
    await dialog.getByLabel("연락처", { exact: true }).fill("010-0123-4567");
    await dialog.getByLabel("이메일 (선택)", { exact: true }).fill("biz@example.com");
    await dialog.getByLabel("관련 단지 (선택)", { exact: true }).fill("힐스테이트 앞산 센트럴");
    await dialog.getByLabel("내용", { exact: true }).fill("분양 홍보 협의 문의드립니다");
    await dialog.getByRole("checkbox").check();

    const posted = page.waitForRequest((req) => req.url().includes("/api/consults") && req.method() === "POST");
    await dialog.getByRole("button", { name: "보내기", exact: true }).click();
    await posted;

    await expect(page.getByText("문의를 보냈어요")).toBeVisible();
    expect(postedBody).not.toBeNull();
    expect((postedBody as unknown as Record<string, unknown>).consultType).toBe("업체문의");
    await expect(dialog).toBeHidden();
  });
});
