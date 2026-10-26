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

/** 권역 → 가짜 최저 금리. 화면 큰 글자 "5.50% ~ 7.20%" 로 어느 권역이 그려졌는지 본다 */
/** @type {Record<string, number>} */
const RATE_MIN = { "030300": 5.5, "050000": 4.73 };
/** @param {string} grp */
const rangeText = (grp) => `${(RATE_MIN[grp] ?? 5.0).toFixed(2)}% ~ 7.20%`;

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
        // 권역마다 최저를 달리해 화면 글자로 권역을 가른다(세션665 — 회사 이름은 화면에 없다)
        data: [
          {
            bank: `가짜${grp}`,
            product: "상품",
            mortgageType: "아파트",
            repayType: "분할상환방식",
            rateMin: RATE_MIN[grp] ?? 5.0,
            rateMax: 7.2,
          },
        ],
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
    expect(await screen.findByText(rangeText("030300"))).toBeTruthy();
    expect(callsFor("030300")).toBe(1);

    fireEvent.click(toggle); // 접음
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle); // 다시 펼침
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText(rangeText("030300"))).toBeTruthy();
    expect(callsFor("030300")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("접은 동안에는 숨긴다 — 화면 읽기의 탭 목록에서도 빠지고, 다시 펼치면 고른 권역이 그대로", async () => {
    render(<LoanRatesSection />);
    const toggle = screen.getByRole("button", { name: LABEL });
    fireEvent.click(toggle);
    await screen.findByText(rangeText("030300"));
    fireEvent.click(screen.getByRole("tab", { name: "보험" }));
    await screen.findByText(rangeText("050000"));

    fireEvent.click(toggle); // 접음
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    const tablist = screen.getByRole("tablist", { hidden: true, name: "금융권역" });
    expect(tablist.closest("[hidden]")).not.toBeNull();

    fireEvent.click(toggle); // 다시 펼침
    expect(screen.getByRole("tab", { name: "보험" }).getAttribute("aria-selected")).toBe("true");
    expect(callsFor("030300")).toBe(1);
    expect(callsFor("050000")).toBe(1);
  });

  // ⚠️ 변이 대상: 범위 조건에서 `!ratesError` 를 빼면 저축은행 숫자가 "1개 보험사" 이름표로 남아 빨강(세션665 검사관 🟠).
  it("권역을 바꿨는데 조회가 실패하면 앞 권역 숫자를 새 이름표로 남기지 않는다", async () => {
    const okImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (/** @type {string} */ url) =>
      String(url).includes("topFinGrpNo=050000") ? { ok: false, status: 500, json: async () => ({}) } : okImpl?.(url)
    );
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByRole("button", { name: LABEL }));
    await screen.findByText(rangeText("030300"));

    fireEvent.click(screen.getByRole("tab", { name: "보험" }));
    expect(await screen.findByText(/금리 정보를 불러올 수 없습니다/)).toBeTruthy();
    expect(screen.queryByText(rangeText("030300"))).toBeNull();
    expect(screen.queryByTestId("group-rate-row")).toBeNull();
  });

  // ⚠️ 변이 대상: 훅 캐시 분기의 `setError(null)` 을 빼면 오류 문구가 남고 범위 줄이 안 나와 빨강(세션666 검사관 🟠).
  it("조회가 실패한 뒤 캐시된 권역으로 돌아가면 오류를 지우고 그 권역 숫자를 다시 그린다", async () => {
    const okImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (/** @type {string} */ url) =>
      String(url).includes("topFinGrpNo=050000") ? { ok: false, status: 500, json: async () => ({}) } : okImpl?.(url)
    );
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByRole("button", { name: LABEL }));
    await screen.findByText(rangeText("030300"));

    fireEvent.click(screen.getByRole("tab", { name: "보험" }));
    await screen.findByText(/금리 정보를 불러올 수 없습니다/);

    fireEvent.click(screen.getByRole("tab", { name: "저축은행" }));
    expect(await screen.findByText(rangeText("030300"))).toBeTruthy();
    expect(screen.queryByText(/금리 정보를 불러올 수 없습니다/)).toBeNull();
    expect(callsFor("030300")).toBe(1); // 캐시에서 꺼냈다 — 다시 부르지 않는다
  });

  // ⚠️ 변이 대상: 훅 조회 분기의 `setError(null)` 을 빼면 성공한 권역에도 오류 문구가 남아 빨강.
  it("조회가 실패한 뒤 다른 권역 조회가 성공하면 오류를 지운다", async () => {
    const okImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (/** @type {string} */ url) =>
      String(url).includes("topFinGrpNo=030300") ? { ok: false, status: 500, json: async () => ({}) } : okImpl?.(url)
    );
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByRole("button", { name: LABEL }));
    await screen.findByText(/금리 정보를 불러올 수 없습니다/);

    fireEvent.click(screen.getByRole("tab", { name: "보험" }));
    expect(await screen.findByText(rangeText("050000"))).toBeTruthy();
    expect(screen.queryByText(/금리 정보를 불러올 수 없습니다/)).toBeNull();
  });
});
