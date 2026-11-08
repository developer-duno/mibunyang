import { describe, it, expect } from "vitest";
import { buildRegulationTimeline } from "./regulationTimeline";
import { GRANDFATHER_RULES, STRESS_RATE_LOCAL_UNTIL, dayAfter } from "@/constants/loanRules";
import { METRO_LOAN_CAP_SINCE } from "@/constants/regulations";

// 시각은 전부 밖에서 고정한다 — KST 2026-11-08 정오(흐르는 시간에 기대지 않는다)
const NOW = new Date("2026-11-08T03:00:00Z");
/** KST 그날 정오 */
const kstNoon = (iso: string) => new Date(`${iso}T03:00:00Z`);

const base = {
  zone: "overheated" as const,
  region: "서울",
  gu: "중구",
  moveIns: [] as unknown[],
  now: NOW,
};

describe("buildRegulationTimeline — 사건 순서(A-2)·future(A-3)", () => {
  it("서울 중구 규제 · 첫 공고 2024-05-10 · 입주 2027-03 → notice, metro-cap, designation, today, move-in", () => {
    const t = buildRegulationTimeline({ ...base, firstDate: "2024-05-10", moveIns: ["2027-03"] });
    expect(t.events.map((e) => e.kind)).toEqual(["notice", "metro-cap", "designation", "today", "move-in"]);
    expect(t.events.map((e) => e.date)).toEqual([
      "2024-05-10",
      METRO_LOAN_CAP_SINCE,
      dayAfter(GRANDFATHER_RULES.default.cutoff),
      "2026-11-08",
      "2027-03",
    ]);
    // future 는 입주만
    expect(t.events.filter((e) => e.future).map((e) => e.kind)).toEqual(["move-in"]);
    // mine = 이 단지 날짜(첫 공고·입주)
    expect(t.events.filter((e) => e.mine).map((e) => e.kind)).toEqual(["notice", "move-in"]);
  });

  it("지정 뒤 공고(2026-02-14)면 notice 가 designation 뒤로 간다", () => {
    const t = buildRegulationTimeline({ ...base, firstDate: "2026-02-14", moveIns: ["2029-06"] });
    expect(t.events.map((e) => e.kind)).toEqual(["metro-cap", "designation", "notice", "today", "move-in"]);
    expect(t.events.find((e) => e.kind === "notice")?.note).toBe("지정 뒤라 종전 규정 대상이 아니에요");
  });

  it("지방 비규제 → notice, today, stress-until, move-in (metro-cap·designation 없음)", () => {
    const t = buildRegulationTimeline({
      zone: "normal",
      region: "부산",
      gu: "해운대구",
      firstDate: "2025-08-20",
      moveIns: ["2027-11"],
      now: NOW,
    });
    expect(t.events.map((e) => e.kind)).toEqual(["notice", "today", "stress-until", "move-in"]);
    const su = t.events.find((e) => e.kind === "stress-until")!;
    expect(su.date).toBe(STRESS_RATE_LOCAL_UNTIL);
    expect(su.future).toBe(true);
    expect(su.title).toBe("지방 주담대 스트레스 가산 0.75%p 유예 끝");
    // 비규제 = 첫 공고 note 없음 · 입주 note 없음
    expect(t.events.find((e) => e.kind === "notice")?.note).toBeUndefined();
    expect(t.events.find((e) => e.kind === "move-in")?.note).toBeUndefined();
  });

  it("수도권 비규제 → metro-cap 은 있고 stress-until·designation 은 없다", () => {
    const t = buildRegulationTimeline({ zone: "normal", region: "인천", gu: "연수구", moveIns: [], now: NOW });
    expect(t.events.map((e) => e.kind)).toEqual(["metro-cap", "today"]);
    expect(t.events[0].title).toBe("수도권 주택구입 대출 최대 6억 시행");
    expect(t.events[0].note).toBe("집값과 상관없이 6억까지만 (서울·경기·인천)");
  });

  it("규제인데 공고일 없음 → notice-missing(date null)이 「오늘」 바로 앞", () => {
    const t = buildRegulationTimeline({ ...base, region: "경기", gu: "구리시" });
    expect(t.events.map((e) => e.kind)).toEqual(["metro-cap", "designation", "notice-missing", "today"]);
    const nm = t.events.find((e) => e.kind === "notice-missing")!;
    expect(nm.date).toBeNull();
    expect(nm.mine).toBe(true);
    expect(nm.title).toBe("이 단지 첫 입주자모집공고 · 아직 못 모았어요");
  });

  it("입주월 — 여러 후보 중 가장 이른 것 · 형식 이상은 무시 · 과거면 「입주 시작」 · 없으면 사건 없음", () => {
    const past = buildRegulationTimeline({ ...base, firstDate: "2021-01-05", moveIns: ["미정", "202402", "2025-01"] });
    const mi = past.events.find((e) => e.kind === "move-in")!;
    expect(mi.date).toBe("2024-02");
    expect(mi.title).toBe("이 단지 입주 시작");
    expect(mi.future).toBe(false);
    expect(mi.note).toBe("잔금대출은 분양가가 아니라 입주 때 시세·감정가 기준이에요");
    const fut = buildRegulationTimeline({ ...base, firstDate: "2024-05-10", moveIns: [null, "2027-03"] });
    expect(fut.events.find((e) => e.kind === "move-in")?.title).toBe("이 단지 입주 예정");
    const none = buildRegulationTimeline({ ...base, firstDate: "2024-05-10", moveIns: [null, "미정"] });
    expect(none.events.some((e) => e.kind === "move-in")).toBe(false);
  });

  it("최근 공고가 첫 공고와 다르면 note 끝에 (최근 공고 …)", () => {
    const t = buildRegulationTimeline({ ...base, firstDate: "2024-05-10", latestDate: "2025-03-02" });
    expect(t.events[0].note).toBe("규제지역이 되기 전에 공고했어요 (최근 공고 2025-03-02)");
    const same = buildRegulationTimeline({ ...base, firstDate: "2024-05-10", latestDate: "2024-05-10" });
    expect(same.events[0].note).toBe("규제지역이 되기 전에 공고했어요");
  });

  it("designation 글자 — 기본 / 4구", () => {
    const d = buildRegulationTimeline({ ...base, firstDate: "2024-05-10" }).events.find(
      (e) => e.kind === "designation"
    )!;
    expect(d.title).toBe("규제지역 지정 효력");
    expect(d.note).toBe("이날부터 LTV 40% · 전날까지 공고한 사업장은 종전 규정이 될 수 있어요");
    const g4 = buildRegulationTimeline({ ...base, gu: "송파구", firstDate: "2019-08-19" }).events.find(
      (e) => e.kind === "designation"
    )!;
    expect(g4.date).toBe(dayAfter(GRANDFATHER_RULES.byZone["서울 송파구"].cutoff));
    expect(g4.title).toBe("규제지역 LTV 강화 효력");
    expect(g4.note).toBe("이날부터 LTV 40% · 전날까지 공고한 사업장은 종전 50% 가 될 수 있어요");
  });
});

describe("buildRegulationTimeline — 결론(A-4·A-5)", () => {
  it("grandfather-may — 4구(송파 · 2019-08-19) 는 종전 50%", () => {
    const v = buildRegulationTimeline({ ...base, gu: "송파구", firstDate: "2019-08-19" }).verdict;
    expect(v).toEqual({
      kind: "grandfather-may",
      text: "첫 공고가 지정보다 앞서요 → 집단대출은 종전 50% 가 될 수 있어요(금융사 심사)",
    });
  });

  it("경기 구리시 — cutoff 당일(2026-06-30)은 종전 대상, 다음 날은 지금 규정", () => {
    const cutoff = GRANDFATHER_RULES.byZone["경기 구리시"].cutoff;
    const g = { ...base, region: "경기", gu: "구리시" };
    expect(buildRegulationTimeline({ ...g, firstDate: "2026-05-01" }).verdict.kind).toBe("grandfather-may");
    // 경계: first === cutoff → 종전 대상(<= 를 < 로 바꾸면 빨강)
    expect(buildRegulationTimeline({ ...g, firstDate: cutoff }).verdict.kind).toBe("grandfather-may");
    const after = buildRegulationTimeline({ ...g, firstDate: dayAfter(cutoff) }).verdict;
    expect(after).toEqual({ kind: "current-only", text: "지정 뒤에 공고한 단지라 지금 규정(LTV 40%)이 그대로예요" });
    expect(buildRegulationTimeline({ ...g, firstDate: "2026-05-01" }).verdict.text).toContain("종전 70%");
  });

  it("경기 3곳(화성 동탄·용인 기흥·구리) cutoff 는 같은 날, 기본(10·15)과 다르다", () => {
    for (const gu of ["화성시", "용인시 기흥구", "구리시"]) {
      const t = buildRegulationTimeline({ ...base, region: "경기", gu, firstDate: "2025-12-01" });
      expect(t.verdict.kind).toBe("grandfather-may");
      expect(t.events.find((e) => e.kind === "designation")?.date).toBe(
        dayAfter(GRANDFATHER_RULES.byZone["경기 구리시"].cutoff)
      );
    }
    // 기본 지역(수원 등)은 같은 날짜 공고면 지정 뒤
    expect(
      buildRegulationTimeline({ ...base, region: "경기", gu: "수원시 영통구", firstDate: "2025-12-01" }).verdict.kind
    ).toBe("current-only");
  });

  it("notice-missing — 규제 & 공고 없음", () => {
    expect(buildRegulationTimeline({ ...base }).verdict).toEqual({
      kind: "notice-missing",
      text: "첫 공고일을 아직 못 모아 종전 규정 해당 여부는 공고문으로 확인하세요",
    });
  });

  it("local-stress — 지방 비규제 · 오늘 ≤ 유예 끝(당일 포함)", () => {
    const loc = { zone: "normal" as const, region: "부산", gu: "해운대구", moveIns: [] };
    expect(buildRegulationTimeline({ ...loc, now: NOW }).verdict).toEqual({
      kind: "local-stress",
      text: "12월 31일까지는 지방 스트레스 가산이 낮아요 · 그 뒤는 미정",
    });
    expect(buildRegulationTimeline({ ...loc, now: kstNoon(STRESS_RATE_LOCAL_UNTIL) }).verdict.kind).toBe(
      "local-stress"
    );
  });

  it("local-stress-ended — 유예 끝 다음 날", () => {
    const t = buildRegulationTimeline({
      zone: "normal",
      region: "대구",
      gu: "수성구",
      moveIns: [],
      now: kstNoon(dayAfter(STRESS_RATE_LOCAL_UNTIL)),
    });
    expect(t.verdict).toEqual({
      kind: "local-stress-ended",
      text: "지방 스트레스 가산 유예(12월 31일)가 끝났어요 · 새 가산은 금융사에서 확인하세요",
    });
    // 유예 끝은 이제 지난 일 — 「오늘」 앞, future 아님
    expect(t.events.map((e) => e.kind)).toEqual(["stress-until", "today"]);
    expect(t.events[0].future).toBe(false);
  });

  it("metro-free — 수도권 비규제", () => {
    expect(
      buildRegulationTimeline({ zone: "normal", region: "경기", gu: "평택시", moveIns: [], now: NOW }).verdict
    ).toEqual({ kind: "metro-free", text: "비규제라 LTV 70% 예요 · 수도권은 집값과 상관없이 6억까지" });
  });
});

describe("buildRegulationTimeline — 종전 대상 제외(A-6)", () => {
  const g4 = { ...base, gu: "송파구", firstDate: "2019-08-19" };
  it("비주택 — 오피스텔 유형 · 이름 「…(오)」", () => {
    expect(buildRegulationTimeline({ ...g4, housingType: "오피스텔" }).verdict).toEqual({
      kind: "current-only",
      text: "비주택 담보라 지금 규정(LTV 40%)이 그대로예요",
    });
    expect(buildRegulationTimeline({ ...g4, name: "송파 어떤단지(오)" }).verdict.kind).toBe("current-only");
  });
  it("사전청약 단지", () => {
    expect(buildRegulationTimeline({ ...g4, name: "송파 사전청약 A1" }).verdict.text).toBe(
      "사전청약 단지라 지금 규정(LTV 40%)이 그대로예요"
    );
  });
  it("입주가 시작된 단지(입주 2024-02)", () => {
    expect(buildRegulationTimeline({ ...g4, moveIns: ["2024-02"] }).verdict.text).toBe(
      "입주가 시작된 단지라 지금 규정(LTV 40%)이 그대로예요"
    );
  });
  // 메인 판정 2(세션705) — 제외 사유가 공고일 없음보다 먼저. 공고일 없음 줄(사실)은 그대로 그린다.
  // ⚠️ 변이 대상: 분기 순서를 되돌리면(공고일 없음 먼저) notice-missing 이 나와 빨강.
  it("오피스텔 + 공고일 없음 → notice-missing 이 아니라 current-only(비주택 담보), 공고일 없음 줄은 남는다", () => {
    const t = buildRegulationTimeline({ ...base, housingType: "오피스텔", firstDate: null });
    expect(t.verdict).toEqual({ kind: "current-only", text: "비주택 담보라 지금 규정(LTV 40%)이 그대로예요" });
    expect(t.events.map((e) => e.kind)).toContain("notice-missing");
  });
});
