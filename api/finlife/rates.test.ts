// @vitest-environment node
/**
 * finlife/rates.ts — 금리 공시월(disclosureMonth) 전달 (세션593 D4).
 * finlife 오픈API 명세: baseList·optionList 의 dcls_month = "공시 제출월 [YYYYMM]".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pickDisclosureMonth } from "../_lib/finlife.js";

vi.mock("../_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const { default: handlerImport } = await import("./rates.js");
const handler = handlerImport as any;

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  } as any;
}

function finlife(months: Array<string | undefined>) {
  return {
    result: {
      err_cd: "000",
      err_msg: "",
      baseList: months.map((m, i) => ({
        dcls_month: m,
        fin_co_no: `C${i}`,
        fin_prdt_cd: `P${i}`,
        kor_co_nm: `은행${i}`,
        fin_prdt_nm: `상품${i}`,
      })),
      optionList: months.map((_, i) => ({
        fin_co_no: `C${i}`,
        fin_prdt_cd: `P${i}`,
        mrtg_type_nm: "아파트",
        rpay_type_nm: "분할상환방식",
        lend_rate_min: 4 + i / 10,
        lend_rate_max: 6,
      })),
    },
  };
}

async function call(months: Array<string | undefined>) {
  process.env.FINLIFE_API_KEY = "test-key";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(finlife(months)) }));
  const res = makeRes();
  await handler({ method: "GET", query: { type: "mortgage", topFinGrpNo: "020000" }, headers: {} }, res);
  return res.json.mock.calls[0][0];
}

beforeEach(() => {
  delete process.env.FINLIFE_API_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finlife/rates — 공시월", () => {
  it("상품마다 공시월이 다르면 가장 최근 값을 싣는다", async () => {
    const body = await call(["202608", "202609", "202607"]);
    expect(body.ok).toBe(true);
    expect(body.disclosureMonth).toBe("202609");
    expect(body.data).toHaveLength(3);
  });

  it("공시월이 없으면 null", async () => {
    const body = await call([undefined, undefined]);
    expect(body.disclosureMonth).toBeNull();
  });
});

describe("pickDisclosureMonth — 형식 검사", () => {
  it("6자리·월 1~12 만 받는다", () => {
    expect(pickDisclosureMonth([{ dcls_month: "202613" }, { dcls_month: "20269" }, { dcls_month: "2026-09" }])).toBeNull();
    expect(pickDisclosureMonth([{ dcls_month: "202600" }, { dcls_month: "202512" }])).toBe("202512");
    expect(pickDisclosureMonth([])).toBeNull();
  });
});
