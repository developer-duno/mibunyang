// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 업체 문의 개인정보 고지 정적 가드 (세션578 🔴0)
 *
 * ## 왜 필요한가
 *
 * `api/CLAUDE.md` 의 "알림에 개인정보를 싣는 결정 = 동의 문구와 privacy.html 이 같은 PR"
 * 규칙을 코드로 지킨다. `formatConsultAlert`(api/_lib/telegram.ts)가 회사명·담당자·연락처·
 * 이메일·문의 내용을 텔레그램(해외 서버)으로 실어 나르는데, 이 사실이 (a) 동의 문구
 * (`BIZ_CONSENT_TEXT`)와 (b) 개인정보 처리방침(`public/privacy.html`) 양쪽에 밝혀져 있지
 * 않으면 개인정보 국외 이전 고지 의무를 조용히 어기게 된다.
 *
 * 이 시험은 문구의 "뜻"이 아니라 **필수 단어가 소스에 실제로 박혀 있는지**만 본다 — 누군가
 * 나중에 이 문구를 손보다가 "텔레그램"·"해외 서버"·"국외 이전" 언급을 실수로 지우면 빨간불이
 * 켜진다.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");

const privacyHtml = readFileSync(`${REPO_ROOT}/public/privacy.html`, "utf8");
const bizInquirySrc = readFileSync(`${REPO_ROOT}/src/hooks/useBizInquiry.ts`, "utf8");

describe("privacy.html — 업체 문의 고지", () => {
  it("§1 표에 업체 문의 필수 수집 항목이 있다", () => {
    expect(privacyHtml).toContain("업체 문의: 회사명, 담당자 이름, 연락처, 문의 내용");
  });

  it("텔레그램 전달 사실이 2회 이상 등장한다(§3 보유기간 + §5 국외이전)", () => {
    const count = (privacyHtml.match(/텔레그램/g) ?? []).length;
    expect(count, `실제 등장 횟수 ${count}회 — §3(보유기간)·§5(위탁 및 국외 이전) 양쪽에 있어야 한다`).toBeGreaterThanOrEqual(2);
  });

  it("국외 이전 고지가 있다", () => {
    expect(privacyHtml).toContain("국외 이전");
  });

  it("시행일이 2026년 9월 26일로 갱신되어 있다", () => {
    expect(privacyHtml).toContain("시행일: 2026년 9월 26일");
  });
});

describe("useBizInquiry.ts — 동의 문구", () => {
  it("BIZ_CONSENT_TEXT 에 텔레그램(해외 서버) 전달 사실이 명시되어 있다", () => {
    const m = /export const BIZ_CONSENT_TEXT\s*=\s*\n?\s*"([^"]*)"/.exec(bizInquirySrc);
    expect(m, "BIZ_CONSENT_TEXT 상수를 소스에서 찾지 못했다 — 선언 형태가 바뀌었을 수 있다").not.toBeNull();
    const text = m?.[1] ?? "";
    expect(text).toContain("텔레그램(해외 서버)");
  });
});
