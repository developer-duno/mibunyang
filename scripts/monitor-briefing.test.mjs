// @ts-check
import { describe, it, expect } from "vitest";
import { splitRuns, buildBriefing } from "./monitor-briefing.mjs";

const IDEM = new Set(["childcare-detail", "purge-consults"]);

describe("splitRuns — 24h runs 를 정상수집/갱신없음/총합 으로 가름", () => {
  it("ok>0 은 active, 멱등 ok=0 은 idle, 멱등 밖 ok=0 은 무시", () => {
    const runs = [
      { collector: "sync-naver", status: "success", ok_count: 6322 },
      { collector: "childcare-detail", status: "success", ok_count: 0 }, // 멱등 → idle
      { collector: "purge-consults", status: "success", ok_count: 0 }, // 삭제형 → idle
      { collector: "mystery-zero", status: "success", ok_count: 0 }, // 멱등 밖 → 무시
    ];
    const { active, idle, totalOk } = splitRuns(runs, IDEM);
    expect(active).toEqual([{ collector: "sync-naver", ok: 6322 }]);
    expect(idle).toEqual(["childcare-detail", "purge-consults"]);
    expect(totalOk).toBe(6322);
  });

  it("실패(status≠success)는 수집건수에서 제외 (① 가 별도 처리)", () => {
    const runs = [
      { collector: "a", status: "success", ok_count: 10 },
      { collector: "b", status: "failure", ok_count: 999 },
    ];
    const { active, totalOk } = splitRuns(runs, IDEM);
    expect(active).toEqual([{ collector: "a", ok: 10 }]);
    expect(totalOk).toBe(10);
  });

  it("active 는 수집 많은 순 정렬", () => {
    const runs = [
      { collector: "small", status: "success", ok_count: 5 },
      { collector: "big", status: "success", ok_count: 500 },
      { collector: "mid", status: "success", ok_count: 50 },
    ];
    const { active } = splitRuns(runs, IDEM);
    expect(active.map((a) => a.collector)).toEqual(["big", "mid", "small"]);
  });

  it("null/undefined 안전 (collector·ok_count 없음)", () => {
    const runs = [{ status: "success" }, { collector: null, status: "success", ok_count: null }];
    const { active, idle, totalOk } = splitRuns(runs, IDEM);
    expect(active).toEqual([]);
    expect(idle).toEqual([]);
    expect(totalOk).toBe(0);
  });
});

describe("buildBriefing — 매일 아침 현황 브리핑 (정상이어도 발송)", () => {
  const baseRuns = [
    { collector: "sync-naver", status: "success", ok_count: 6322 },
    { collector: "infra", status: "success", ok_count: 2154 },
    { collector: "childcare-detail", status: "success", ok_count: 0 },
  ];

  it("정상일 — 이상 0건, 수집건수·갱신없음·채움률 모두 표시", () => {
    const msg = buildBriefing({
      runs24h: baseRuns,
      idempotentCollectors: IDEM,
      fillRate: 89.6,
      prevSnapshot: null,
      issueCount: 0,
    });
    expect(msg).toMatch(/수집기 현황 브리핑/);
    expect(msg).toMatch(/수집 2종 · 총 8,476건/);
    expect(msg).toMatch(/sync-naver 6,322/);
    expect(msg).toMatch(/갱신 없음\(정상\): childcare-detail/);
    expect(msg).toMatch(/전체 채움률 89.6% \(어제 기록 없음\)/);
    expect(msg).toMatch(/🟢 오늘 이상 0건/);
  });

  it("이상 있는 날 — issueCount 요약줄 (상세는 별도)", () => {
    const msg = buildBriefing({ runs24h: baseRuns, idempotentCollectors: IDEM, fillRate: 88, issueCount: 2 });
    expect(msg).toMatch(/🔴 오늘 이상 2건 \(아래 상세 참조\)/);
    expect(msg).not.toMatch(/🟢 오늘 이상 0건/);
  });

  it("어제 대비 상승 — ▲ 표기", () => {
    const msg = buildBriefing({
      runs24h: baseRuns,
      idempotentCollectors: IDEM,
      fillRate: 89.6,
      prevSnapshot: { fill_rate: 88.1 },
      issueCount: 0,
    });
    expect(msg).toMatch(/전체 채움률 89.6% \(어제 88.1% ▲1.5\)/);
  });

  it("어제 대비 하락 — ▼ 표기", () => {
    const msg = buildBriefing({
      runs24h: baseRuns,
      idempotentCollectors: IDEM,
      fillRate: 85,
      prevSnapshot: { fill_rate: 88 },
      issueCount: 0,
    });
    expect(msg).toMatch(/전체 채움률 85% \(어제 88% ▼3\)/);
  });

  it("장기 미발화 수집기 — 목록 표시", () => {
    const msg = buildBriefing({
      runs24h: baseRuns,
      idempotentCollectors: IDEM,
      fillRate: 89,
      issueCount: 0,
      staleCollectors: ["housing-permits", "migration"],
    });
    expect(msg).toMatch(/🕒 장기 미발화: housing-permits, migration/);
  });

  it("정상 수집 0건 — 경고 문구 (수집기 동작 확인)", () => {
    const msg = buildBriefing({
      runs24h: [{ collector: "purge-consults", status: "success", ok_count: 0 }],
      idempotentCollectors: IDEM,
      fillRate: 89,
      issueCount: 0,
    });
    expect(msg).toMatch(/지난 24시간 정상 수집 0건/);
  });

  it("fillRate null — 채움률 줄 생략", () => {
    const msg = buildBriefing({ runs24h: baseRuns, idempotentCollectors: IDEM, fillRate: null, issueCount: 0 });
    expect(msg).not.toMatch(/전체 채움률/);
  });
});
