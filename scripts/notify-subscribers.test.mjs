// @ts-check
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  pickEvents, addDays, normalizeRegionKey, matchPairs, dedupeByPhone,
  maskPhone, optOutToken, buildMessage, isNightKst, kstHour, hasLiveEnv,
  e164ToLocal, SMS_ADAPTER_READY,
} from "./notify-subscribers.mjs";

const TODAY = "2026-07-06";

/** @param {Partial<Record<string, string|null>>} o */
function schedRow(o = {}) {
  return {
    apartment_id: "ap-1", house_manage_no: "2026000001",
    special_receipt_bgnde: null, general_rank1_bgnde: null, pblanc_url: "https://apply/1",
    ...o,
  };
}

describe("addDays", () => {
  it("월 경계를 넘는다", () => {
    expect(addDays("2026-06-28", 7)).toBe("2026-07-05");
  });
  it("연 경계를 넘는다", () => {
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });
});

describe("pickEvents — 접수 시작 D-0~+7, 미래만", () => {
  it("과거 접수일은 절대 포함하지 않는다 (늦은 알림 0·콜드스타트 차단)", () => {
    const rows = [schedRow({ special_receipt_bgnde: "2026-07-05" })];
    expect(pickEvents(rows, TODAY)).toHaveLength(0);
  });
  it("오늘 시작은 포함한다", () => {
    const rows = [schedRow({ special_receipt_bgnde: TODAY })];
    expect(pickEvents(rows, TODAY)).toHaveLength(1);
  });
  it("D+7 은 포함, D+8 은 제외한다", () => {
    const rows = [
      schedRow({ special_receipt_bgnde: "2026-07-13" }),
      schedRow({ apartment_id: "ap-2", special_receipt_bgnde: "2026-07-14" }),
    ];
    const events = pickEvents(rows, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]?.aptId).toBe("ap-1");
  });
  it("특별공급 시작일이 1순위보다 우선한다", () => {
    const rows = [schedRow({ special_receipt_bgnde: "2026-07-08", general_rank1_bgnde: "2026-07-10" })];
    expect(pickEvents(rows, TODAY)[0]?.receiptDate).toBe("2026-07-08");
  });
  it("특별공급이 없으면 1순위 시작일로 판정한다", () => {
    const rows = [schedRow({ general_rank1_bgnde: "2026-07-09" })];
    expect(pickEvents(rows, TODAY)[0]?.receiptDate).toBe("2026-07-09");
  });
  it("접수일이 둘 다 없으면 제외한다", () => {
    expect(pickEvents([schedRow()], TODAY)).toHaveLength(0);
  });
  it("apartment_id 또는 house_manage_no 없으면 제외한다", () => {
    const rows = [
      schedRow({ apartment_id: null, special_receipt_bgnde: TODAY }),
      schedRow({ house_manage_no: null, special_receipt_bgnde: TODAY }),
    ];
    expect(pickEvents(rows, TODAY)).toHaveLength(0);
  });
  it("같은 공고 중복 행은 빠른 접수일 1건으로 dedupe 한다", () => {
    const rows = [
      schedRow({ special_receipt_bgnde: "2026-07-10" }),
      schedRow({ special_receipt_bgnde: "2026-07-08" }),
    ];
    const events = pickEvents(rows, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]?.receiptDate).toBe("2026-07-08");
  });
  it("같은 단지 차수별 공고(house_manage_no 다름)는 별개 이벤트다", () => {
    const rows = [
      schedRow({ special_receipt_bgnde: "2026-07-08" }),
      schedRow({ house_manage_no: "2026000002", special_receipt_bgnde: "2026-07-09" }),
    ];
    expect(pickEvents(rows, TODAY)).toHaveLength(2);
  });
  it("특별공급이 과거여도 1순위가 윈도우 안이면 1순위 기준으로 알린다 (리뷰 P2-3)", () => {
    const rows = [schedRow({ special_receipt_bgnde: "2026-07-05", general_rank1_bgnde: "2026-07-08" })];
    const events = pickEvents(rows, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]?.receiptDate).toBe("2026-07-08");
  });
});

describe("normalizeRegionKey — REGION_MAP 정규화", () => {
  it("정식명을 약칭으로 통일한다", () => {
    expect(normalizeRegionKey("서울특별시")).toBe("서울");
    expect(normalizeRegionKey("강원도")).toBe("강원");
    expect(normalizeRegionKey("전라북도")).toBe("전북");
  });
  it("약칭은 그대로 둔다", () => {
    expect(normalizeRegionKey("서울")).toBe("서울");
  });
  it("미등재 표기는 null (전국 매칭으로 새지 않음)", () => {
    expect(normalizeRegionKey("서울시")).toBeNull();
    expect(normalizeRegionKey("")).toBeNull();
    expect(normalizeRegionKey(null)).toBeNull();
  });
});

describe("matchPairs — 단지/지역/전국 3분기", () => {
  const events = [{ aptId: "ap-1", houseNo: "h1", receiptDate: "2026-07-08", url: null }];
  const aptById = new Map([["ap-1", { name: "테스트단지", region: "서울" }]]);
  /** @param {Partial<{ id: number, phone: string, region: string|null, apartment_id: string|null }>} o */
  const sub = (o = {}) => ({ id: 1, phone: "+821011112222", region: null, apartment_id: null, ...o });

  it("단지 구독 = id 정확 일치만", () => {
    expect(matchPairs([sub({ apartment_id: "ap-1" })], events, aptById)).toHaveLength(1);
    expect(matchPairs([sub({ apartment_id: "ap-2" })], events, aptById)).toHaveLength(0);
  });
  it("지역 구독 = 정식명 구독과 약칭 단지 region 이 일치한다", () => {
    expect(matchPairs([sub({ region: "서울특별시" })], events, aptById)).toHaveLength(1);
    expect(matchPairs([sub({ region: "부산광역시" })], events, aptById)).toHaveLength(0);
  });
  it("둘 다 null = 전국 구독은 항상 매칭한다", () => {
    expect(matchPairs([sub()], events, aptById)).toHaveLength(1);
  });
  it("미등재 지역 표기는 매칭 0 (전국으로 새지 않음)", () => {
    expect(matchPairs([sub({ region: "서울시" })], events, aptById)).toHaveLength(0);
  });
  it("로스터에 없는 단지 이벤트는 매칭하지 않는다", () => {
    const ev2 = [{ aptId: "ap-없음", houseNo: "h1", receiptDate: "2026-07-08", url: null }];
    expect(matchPairs([sub()], ev2, aptById)).toHaveLength(0);
  });
  it("단지 구독이 있으면 region 은 보지 않는다", () => {
    expect(matchPairs([sub({ apartment_id: "ap-2", region: "서울특별시" })], events, aptById)).toHaveLength(0);
  });
});

describe("dedupeByPhone — 같은 번호 다중 구독행은 발송 1건·로그 전 행", () => {
  const ev = { aptId: "ap-1", houseNo: "h1", receiptDate: "2026-07-08", url: null };
  it("같은 phone 두 구독행 → 1 발송 단위 + subRows 2", () => {
    const pairs = [
      { sub: { id: 1, phone: "+821011112222", region: "서울특별시", apartment_id: null }, ev },
      { sub: { id: 2, phone: "+821011112222", region: null, apartment_id: "ap-1" }, ev },
    ];
    const units = dedupeByPhone(pairs);
    expect(units).toHaveLength(1);
    expect(units[0]?.subRows.map((r) => r.id)).toEqual([1, 2]);
  });
  it("다른 공고면 발송 단위가 갈린다", () => {
    const ev2 = { ...ev, houseNo: "h2" };
    const pairs = [
      { sub: { id: 1, phone: "+821011112222", region: null, apartment_id: null }, ev },
      { sub: { id: 1, phone: "+821011112222", region: null, apartment_id: null }, ev: ev2 },
    ];
    expect(dedupeByPhone(pairs)).toHaveLength(2);
  });
});

describe("maskPhone", () => {
  it("E.164 를 마스킹한다", () => {
    expect(maskPhone("+821012345678")).toBe("+8210****5678");
  });
  it("짧은 문자열은 전체 마스킹한다", () => {
    expect(maskPhone("+82")).toBe("****");
  });
});

describe("optOutToken — api/subscribers.ts DELETE 와 동일 HMAC", () => {
  it("같은 secret+E.164 로 서버 검증값과 일치한다", () => {
    const secret = "test-secret";
    const e164 = "+821012345678";
    const serverSide = crypto.createHmac("sha256", secret).update(e164).digest("hex");
    expect(optOutToken(secret, e164)).toBe(serverSide);
  });
});

describe("e164ToLocal — 수신거부 URL phone 파라미터 계약 (리뷰 P1-2)", () => {
  it("E.164 를 국내 표기로 되돌린다", () => {
    expect(e164ToLocal("+821012345678")).toBe("01012345678");
  });
  it("변환값은 서버 normalizeToE164 의 수용 패턴(010 시작 digits)을 통과한다", () => {
    // api/subscribers.ts:126-131 계약 복제 — digits 스트립 후 ^010\d{7,8}$ 이어야 검증 도달
    const local = e164ToLocal("+821012345678");
    const digits = local.replace(/\D/g, "");
    expect(/^010\d{7,8}$/.test(digits)).toBe(true);
  });
});

describe("SMS_ADAPTER_READY — 어댑터 스텁 상태 live 차단 (리뷰 P1-1)", () => {
  it("PR3 전에는 false — Secrets 만 먼저 주입돼도 live 진입 불가", () => {
    expect(SMS_ADAPTER_READY).toBe(false);
  });
});

describe("isNightKst — 야간 전송 금지 (KST 8~21시 밖)", () => {
  it.each([
    [7, true], [8, false], [14, false], [20, false], [21, true], [23, true], [0, true],
  ])("%i시 → %s", (hour, night) => {
    expect(isNightKst(/** @type {number} */ (hour))).toBe(night);
  });
  it("kstHour 는 0~23 을 반환한다", () => {
    const h = kstHour(new Date("2026-07-06T15:00:00+09:00"));
    expect(h).toBe(15);
  });
});

describe("hasLiveEnv — 실발송 게이트", () => {
  const full = {
    SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SOLAPI_SENDER: "0212345678",
    SUBSCRIBERS_OPT_OUT_SECRET: "x",
  };
  it("4종 전부 있어야 true", () => {
    expect(hasLiveEnv(full)).toBe(true);
  });
  it.each(Object.keys(full))("%s 없으면 false", (key) => {
    const env = { ...full, [key]: "" };
    expect(hasLiveEnv(env)).toBe(false);
  });
});

describe("buildMessage", () => {
  const ev = { receiptDate: "2026-07-08", url: "https://apply/1" };
  it("단지명·접수일·공고·수신거부 링크를 포함한다", () => {
    const text = buildMessage(ev, { name: "테스트단지" }, "https://site/unsubscribe?p=x&t=y");
    expect(text).toContain("테스트단지");
    expect(text).toContain("2026-07-08");
    expect(text).toContain("https://apply/1");
    expect(text).toContain("수신거부");
  });
  it("공고 URL·수신거부가 없으면 해당 줄을 생략한다", () => {
    const text = buildMessage({ receiptDate: "2026-07-08", url: null }, { name: "단지" }, null);
    expect(text).not.toContain("공고:");
    expect(text).not.toContain("수신거부");
  });
});
