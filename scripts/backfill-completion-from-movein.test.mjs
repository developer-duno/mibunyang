// @ts-check
/**
 * backfill-completion-from-movein.mjs 테스트 — 잘린 completion 복구 대상 선별 (세션530)
 *
 * ⚠️ 뮤테이션 대상: `isCompletionYm` 게이트나 `parsePresaleCompletion` 결과 검사를 지우면
 *    아래가 red 여야 한다. 특히 "정상 값은 손대지 않는다" 는 지우면 236건이 통째로 덮인다.
 */
import { describe, it, expect } from "vitest";
import { selectBackfillTargets } from "./backfill-completion-from-movein.mjs";

describe("selectBackfillTargets", () => {
  it("잘린 값을 원문에서 복구한다 (운영 실측 사례)", () => {
    const { targets } = selectBackfillTargets([
      { id: "ap-6027084", name: "남양주왕숙 A19 사전청약", completion: "2030 미", presale_move_in: "2029-12" },
      { id: "ap-6027478", name: "오티에르반포", completion: "미정", presale_move_in: "2027-07" },
    ]);
    expect(targets.map((t) => [t.id, t.to])).toEqual([
      ["ap-6027084", "202912"],
      ["ap-6027478", "202707"],
    ]);
  });

  it("이미 정상인 YYYYMM 은 건드리지 않는다 — 원문과 어긋나도", () => {
    // 운영에 236건 있는 상태(입주예정일 연기 등). 어느 쪽이 참인지는 별개 문제라 범위 밖.
    const { targets } = selectBackfillTargets([
      { id: "ah-2020910003", name: "쌍용 더 플래티넘 오목천역", completion: "202209", presale_move_in: "2028-10" },
    ]);
    expect(targets).toEqual([]);
  });

  it("원문도 월 미상이면 지어내지 않고 남겨 둔다", () => {
    const { targets, brokenUnrecoverable, missing } = selectBackfillTargets([
      { id: "ap-1", name: "가", completion: "미정", presale_move_in: "미정" },
      { id: "ap-2", name: "나", completion: "2029 미", presale_move_in: "2029 미정" },
      { id: "ap-3", name: "다", completion: null, presale_move_in: null },
    ]);
    expect(targets).toEqual([]);
    // ⚠️ 깨진 값(2)과 애초에 미수집(1)을 갈라 센다 — 뭉치면 결함 규모가 부풀어 보인다
    expect(brokenUnrecoverable).toBe(2);
    expect(missing).toBe(1);
  });

  it("completion 이 NULL 이어도 원문이 확실하면 채운다", () => {
    const { targets } = selectBackfillTargets([
      { id: "ap-4", name: "라", completion: null, presale_move_in: "2027.03" },
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].to).toBe("202703");
    expect(targets[0].from).toBeNull();
  });

  it("원문이 규약을 어긴 월이면 복구하지 않는다 (13월 등)", () => {
    const { targets, brokenUnrecoverable } = selectBackfillTargets([
      { id: "ap-5", name: "마", completion: "미정", presale_move_in: "2027-13" },
    ]);
    expect(targets).toEqual([]);
    expect(brokenUnrecoverable).toBe(1);
  });

  it("빈 목록은 빈 결과", () => {
    expect(selectBackfillTargets([])).toEqual({ targets: [], brokenUnrecoverable: 0, missing: 0 });
  });
});
