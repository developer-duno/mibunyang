// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanRatesSection } from "./LoanRatesSection";

/**
 * 다른 금융권 접힘 — 펼침→접음→펼침 때 우리 API 호출 수 (세션593 후속 F2).
 *
 * `LoanRatesSection.test.jsx` 는 `useLoanRates` 를 통째로 가짜로 바꿔 "부르나/안 부르나"만 본다.
 * 여기서는 **진짜 훅**에 fetch 만 가짜로 넣어, 접었다 다시 펼칠 때 같은 권역을 또 부르는지 센다
 * (옛 판은 접으면 내용을 내려 훅의 기억이 사라져 펼칠 때마다 또 불렀다).
 */

/** 펼침 단추 이름 — 끝에 "▼" 가 붙어 읽히므로 앞부분으로 찾는다 */
const LABEL = /^저축은행 · 여신전문 · 보험 금리 보기/;

/** @type {import('vitest').Mock} */
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async (/** @type {string} */ url) => {
    const grp = new URL(url, "http://x").searchParams.get("topFinGrpNo") ?? "";
    return {
      ok: true,
      json: async () => ({
        ok: true,
        disclosureMonth: "202609",
        data: [{ bank: `가짜${grp}`, product: "상품", rateMin: 5.5, rateMax: 7.2 }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** 그 권역을 부른 횟수 */
const callsFor = (/** @type {string} */ grp) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes(`topFinGrpNo=${grp}`)).length;

describe("LoanRatesSection — 접었다 펼쳐도 다시 부르지 않는다 (세션593 후속 F2)", () => {
  it("처음 펼치기 전 호출 0", () => {
    render(<LoanRatesSection />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ⚠️ 변이 대상: 접을 때 내용을 내리면(옛 `showRates && <OtherGroupRates />`) 다시 펼칠 때 2회째 호출로 빨강.
  it("펼침 → 접음 → 펼침 = 저축은행(030300) 호출 1회", async () => {
    render(<LoanRatesSection />);
    const toggle = screen.getByRole("button", { name: LABEL });

    fireEvent.click(toggle);
    expect(await screen.findByText("가짜030300")).toBeTruthy();
    expect(callsFor("030300")).toBe(1);

    fireEvent.click(toggle); // 접음
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle); // 다시 펼침
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("가짜030300")).toBeTruthy();
    expect(callsFor("030300")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("접은 동안에는 숨긴다 — 화면 읽기의 탭 목록에서도 빠지고, 다시 펼치면 고른 권역이 그대로", async () => {
    render(<LoanRatesSection />);
    const toggle = screen.getByRole("button", { name: LABEL });
    fireEvent.click(toggle);
    await screen.findByText("가짜030300");
    fireEvent.click(screen.getByRole("tab", { name: "보험" }));
    await screen.findByText("가짜050000");

    fireEvent.click(toggle); // 접음
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    const tablist = screen.getByRole("tablist", { hidden: true, name: "금융권역" });
    expect(tablist.closest("[hidden]")).not.toBeNull();

    fireEvent.click(toggle); // 다시 펼침
    expect(screen.getByRole("tab", { name: "보험" }).getAttribute("aria-selected")).toBe("true");
    expect(callsFor("030300")).toBe(1);
    expect(callsFor("050000")).toBe(1);
  });
});
