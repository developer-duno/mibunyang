// @ts-check
/**
 * backfill-presale-area.mjs 회귀 가드 — 대상 선별의 순수 함수만 검사한다(네트워크·DB 없음).
 *
 * 겨누는 사고:
 *  ① VIEW 가 안 고르는 행을 채워 "채웠는데 화면은 그대로" — `latest_prices` 는 apartment_id 별로
 *     (presale_% 를 뒤로, recorded_at DESC) 첫 행 하나만 쓴다.
 *  ② 이미 값이 있는 칸을 덮어써 측정값을 잃음.
 *  ③ 네이버 코드가 없는 단지를 대상에 넣어 헛요청(2초씩).
 */
import { describe, it, expect } from "vitest";
import { selectAreaBackfillTargets } from "./backfill-presale-area.mjs";

/**
 * @param {number} id
 * @param {string} apt
 * @param {unknown} area
 * @param {string} houseType
 * @param {string} recordedAt
 */
const P = (id, apt, area, houseType, recordedAt) => ({
  id,
  apartment_id: apt,
  area,
  house_type: houseType,
  recorded_at: recordedAt,
});

/** @param {string[]} ids */
const codes = (ids) =>
  new Map(ids.map((i) => [i, { no: "600" + i, seq: "900" + i, name: i + "단지" }]));

describe("selectAreaBackfillTargets", () => {
  it("면적 비어 있고 네이버 코드 있으면 대상", () => {
    const r = selectAreaBackfillTargets([P(1, "ap-1", null, "presale_min", "2026-08-20")], codes(["ap-1"]));
    expect(r.targets).toEqual([{ rowId: 1, aptId: "ap-1", name: "ap-1단지", no: "600ap-1", seq: "900ap-1" }]);
  });

  it("VIEW 가 고르는 최신 행만 대상 — 옛 행은 건드리지 않는다", () => {
    // 옛 행(id 1)이 아니라 최신 행(id 3)을 고쳐야 화면이 바뀐다
    const r = selectAreaBackfillTargets(
      [
        P(1, "ap-1", null, "presale_min", "2026-07-01"),
        P(3, "ap-1", null, "presale_min", "2026-08-20"),
        P(2, "ap-1", null, "presale_min", "2026-08-01"),
      ],
      codes(["ap-1"]),
    );
    expect(r.targets.map((t) => t.rowId)).toEqual([3]);
  });

  it("청약홈 행이 있으면 대상에서 뺀다 (VIEW 가 그쪽을 먼저 고름)", () => {
    const r = selectAreaBackfillTargets(
      [P(1, "ap-1", 84.9, "seed", "2026-03-20"), P(2, "ap-1", null, "presale_min", "2026-08-20")],
      codes(["ap-1"]),
    );
    expect(r.targets).toEqual([]);
    expect(r.seedWins).toBe(1);
  });

  it("이미 면적이 있으면 덮어쓰지 않는다", () => {
    const r = selectAreaBackfillTargets([P(1, "ap-1", 59.9, "presale_min", "2026-08-20")], codes(["ap-1"]));
    expect(r.targets).toEqual([]);
    expect(r.alreadyFilled).toBe(1);
  });

  it("네이버 코드가 없으면 대상에서 뺀다 (헛요청 차단)", () => {
    const r = selectAreaBackfillTargets([P(1, "ap-9", null, "presale_min", "2026-08-20")], new Map());
    expect(r.targets).toEqual([]);
    expect(r.noNaverCode).toBe(1);
  });

  it("코드가 빈 문자열이어도 대상에서 뺀다", () => {
    const r = selectAreaBackfillTargets(
      [P(1, "ap-1", null, "presale_min", "2026-08-20")],
      new Map([["ap-1", { no: "", seq: "", name: "x" }]]),
    );
    expect(r.targets).toEqual([]);
    expect(r.noNaverCode).toBe(1);
  });

  it("area 가 0 이나 문자열이면 '비어 있음'으로 본다", () => {
    const r = selectAreaBackfillTargets(
      [P(1, "ap-1", 0, "presale_min", "2026-08-20"), P(2, "ap-2", "", "presale_min", "2026-08-20")],
      codes(["ap-1", "ap-2"]),
    );
    expect(r.targets.map((t) => t.aptId).sort()).toEqual(["ap-1", "ap-2"]);
  });

  it("여러 단지를 각각 독립적으로 판정한다", () => {
    const r = selectAreaBackfillTargets(
      [
        P(1, "ap-1", null, "presale_min", "2026-08-20"),
        P(2, "ap-2", 84.9, "presale_min", "2026-08-20"),
        P(3, "ap-3", null, "seed", "2026-08-20"),
      ],
      codes(["ap-1", "ap-2", "ap-3"]),
    );
    expect(r.targets.map((t) => t.aptId)).toEqual(["ap-1"]);
    expect(r.alreadyFilled).toBe(1);
    expect(r.seedWins).toBe(1);
  });

  it("빈 입력은 빈 결과", () => {
    const r = selectAreaBackfillTargets([], new Map());
    expect(r).toEqual({ targets: [], alreadyFilled: 0, noNaverCode: 0, seedWins: 0 });
  });
});
