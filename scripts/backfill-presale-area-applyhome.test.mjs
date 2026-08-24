// @ts-check
/**
 * backfill-presale-area-applyhome.mjs 회귀 가드 — 순수 함수만 검사한다(네트워크·DB 없음).
 *
 * 겨누는 사고:
 *  ① **가격이라는 열쇠를 놓고 "가장 싼 주택형"으로 폴백** — 두 표의 시점이 달라 열에 셋이
 *     10㎡ 넘게 틀린다(대조군 1,395곳: 최저가 기준 69.4% vs 가격근접 95.7%).
 *  ② **공급면적을 전용면적 자리에 넣음** — 같은 행에서 84.5775(공급) vs 59.9801(전용), 1.41배.
 *  ③ 계약면적 오입력·임대 행을 골라 말도 안 되는 크기가 들어감(상식 범위 20~250㎡).
 *  ④ VIEW 가 안 고르는 행을 채워 "채웠는데 화면은 그대로" — seed 행이 있으면 그쪽이 이기고,
 *     presale_ 중에서는 recorded_at 이 가장 늦은 행만 화면에 닿는다.
 *  ⑤ 이미 값이 있는 칸을 덮어써 측정값을 잃음.
 *  ⑥ 동률일 때 표의 행 순서에 답이 흔들려 재실행마다 다른 값이 들어감.
 *
 * ⚠️ ①은 `pickUnitByPrice` 단독 호출로는 절반만 잡힌다 — 실전은 언제나
 * `selectApplyhomeAreaTargets → pickUnitByPrice` 를 지나므로 **배선까지 지나는 가드**를 함께
 * 둔다(.claude/rules/meta/guards-must-be-mutation-tested.md §"테스트가 실제 경로를 지나는가").
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PRICE_GAP_RATIO,
  parseHouseTy,
  pickUnitByPrice,
  selectApplyhomeAreaTargets,
} from "./backfill-presale-area-applyhome.mjs";

/**
 * 청약홈 주택형 한 줄. `house_ty` 는 실제 저장 형식대로 0 패딩 + 뒤 공백을 쓴다.
 * @param {string} houseTy
 * @param {number} topAmount
 * @param {number | null} [supplyArea]
 */
const U = (houseTy, topAmount, supplyArea = null) => ({
  house_ty: houseTy,
  top_amount: topAmount,
  supply_area: supplyArea,
});

/**
 * @param {number} id
 * @param {string} apt
 * @param {unknown} area
 * @param {unknown} price
 * @param {string} houseType
 * @param {string} recordedAt
 */
const P = (id, apt, area, price, houseType, recordedAt) => ({
  id,
  apartment_id: apt,
  area,
  price,
  house_type: houseType,
  recorded_at: recordedAt,
});

describe("parseHouseTy — 청약홈 주택형 문자열", () => {
  it("0 패딩과 뒤 공백을 걷어내고 전용면적을 얻는다", () => {
    expect(parseHouseTy("059.9801 ")).toBeCloseTo(59.9801, 4);
    expect(parseHouseTy("084.9931D")).toBeCloseTo(84.9931, 4);
    expect(parseHouseTy("101.6160A")).toBeCloseTo(101.616, 3);
  });

  it("상식 범위(20~250㎡) 밖은 버린다 — 계약면적 오입력·임대 행 차단", () => {
    expect(parseHouseTy("019.9")).toBeNull();
    expect(parseHouseTy("250.1")).toBeNull();
    expect(parseHouseTy("000.0000 ")).toBeNull();
  });

  it("빈 값·비수치는 null", () => {
    expect(parseHouseTy(null)).toBeNull();
    expect(parseHouseTy(undefined)).toBeNull();
    expect(parseHouseTy("")).toBeNull();
    expect(parseHouseTy("전용")).toBeNull();
  });
});

describe("pickUnitByPrice — 가격을 열쇠로 같은 주택형 찾기", () => {
  const rows = [U("059.9801 ", 41796), U("084.9931D", 54673), U("101.6160A", 66320)];

  it("저장가에 가장 가까운 분양가의 주택형을 고른다", () => {
    // 54,000 은 84㎡(54,673)에 가장 가깝다 — 최저가인 59㎡(41,796)가 아니다.
    expect(pickUnitByPrice(rows, 54000)?.area).toBeCloseTo(84.9931, 4);
    expect(pickUnitByPrice(rows, 65000)?.area).toBeCloseTo(101.616, 3);
    expect(pickUnitByPrice(rows, 42000)?.area).toBeCloseTo(59.9801, 4);
  });

  it("⚠️ 뮤테이션 대상 — 최저가로 폴백하면 이 단언이 깨진다", () => {
    // 저장가가 큰 평형을 가리키는데 최저가를 고르면 25㎡ 작은 값이 들어간다(대조군 p10 = -25.0).
    const picked = pickUnitByPrice(rows, 66000);
    expect(picked?.area).toBeCloseTo(101.616, 3);
    expect(picked?.area).not.toBeCloseTo(59.9801, 4); // 최저가 주택형이면 안 된다
  });

  it("가격이 없으면 고를 근거가 없으므로 null — 지어내지 않는다", () => {
    expect(pickUnitByPrice(rows, null)).toBeNull();
    expect(pickUnitByPrice(rows, undefined)).toBeNull();
    expect(pickUnitByPrice(rows, 0)).toBeNull();
    expect(pickUnitByPrice(rows, -1)).toBeNull();
    expect(pickUnitByPrice(rows, "없음")).toBeNull();
  });

  it("공급면적은 전용면적 자리에 넣지 않는다", () => {
    const picked = pickUnitByPrice([U("059.9801 ", 41796, 84.5775)], 41796);
    expect(picked?.area).toBeCloseTo(59.9801, 4); // 전용
    expect(picked?.supplyArea).toBeCloseTo(84.5775, 4); // 공급은 제 자리에
  });

  it("공급면적이 0·빈값이면 null 로 남긴다(0 을 저장하지 않는다)", () => {
    expect(pickUnitByPrice([U("059.9801 ", 41796, 0)], 41796)?.supplyArea).toBeNull();
    expect(pickUnitByPrice([U("059.9801 ", 41796)], 41796)?.supplyArea).toBeNull();
  });

  it("분양가가 없거나 0 인 행은 후보에서 뺀다 — 임대(보증금/월세) 행 차단", () => {
    const mixed = [U("039.9000 ", 0), U("084.9931D", 54673)];
    expect(pickUnitByPrice(mixed, 1000)?.area).toBeCloseTo(84.9931, 4);
  });

  it("상식 범위 밖 주택형은 후보에서 뺀다", () => {
    const mixed = [U("300.0000 ", 50000), U("084.9931D", 54673)];
    expect(pickUnitByPrice(mixed, 50000)?.area).toBeCloseTo(84.9931, 4);
  });

  it("동률이면 싼 쪽 — 행 순서를 뒤집어도 같은 답(재실행 안정)", () => {
    const tie = [U("084.0000 ", 110), U("059.0000 ", 90)];
    expect(pickUnitByPrice(tie, 100)?.matchedAmount).toBe(90);
    expect(pickUnitByPrice(tie.slice().reverse(), 100)?.matchedAmount).toBe(90);
  });

  it("빈 목록·잘못된 입력은 null", () => {
    expect(pickUnitByPrice([], 50000)).toBeNull();
    expect(pickUnitByPrice(/** @type {any} */ (null), 50000)).toBeNull();
    expect(pickUnitByPrice([/** @type {any} */ (null)], 50000)).toBeNull();
  });

  it("가격 차이를 함께 돌려준다 — 짝이 어긋난 건을 로그로 걸러내기 위해", () => {
    const picked = pickUnitByPrice(rows, 50000);
    expect(picked?.matchedAmount).toBe(54673);
    expect(picked?.gap).toBe(4673);
  });
});

describe("selectApplyhomeAreaTargets — VIEW 가 고르는 행만, 실전 경로로", () => {
  /** @param {string[]} ids @param {Array<ReturnType<typeof U>>} rows */
  const supply = (ids, rows) => new Map(ids.map((id) => [id, rows]));
  const threeUnits = [U("059.9801 ", 41796), U("084.9931D", 54673), U("101.6160A", 66320)];

  it("면적이 빈 최신 presale 행을 대상으로 잡는다", () => {
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, 54000, "presale_min", "2026-08-01")],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].rowId).toBe(1);
    expect(r.targets[0].area).toBeCloseTo(84.9931, 4);
  });

  it("⚠️ 뮤테이션 대상 — price 를 안 넘기면(최저가 폴백) 이 단언이 깨진다", () => {
    // 실전 경로(select → pick) 전체를 지나는 가드. 함수 단독 테스트로는 배선 되돌림을 못 잡는다.
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, 66000, "presale_min", "2026-08-01")],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets[0].area).toBeCloseTo(101.616, 3);
    expect(r.targets[0].area).not.toBeCloseTo(59.9801, 4);
  });

  it("이미 면적이 있으면 덮어쓰지 않는다", () => {
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", 84.5, 54000, "presale_min", "2026-08-01")],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.alreadyFilled).toBe(1);
  });

  it("seed 행이 있으면 VIEW 가 그쪽을 고르므로 건드리지 않는다", () => {
    const r = selectApplyhomeAreaTargets(
      [
        P(1, "ap-1", null, 54000, "presale_min", "2026-08-01"),
        P(2, "ap-1", 84.5, 55000, "seed", "2026-01-01"),
      ],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.seedWins).toBe(1);
  });

  it("presale 행이 여럿이면 recorded_at 이 가장 늦은 것만 채운다", () => {
    const r = selectApplyhomeAreaTargets(
      [
        P(1, "ap-1", null, 50000, "presale_min", "2026-06-01"),
        P(2, "ap-1", null, 54000, "presale_min", "2026-08-01"),
      ],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].rowId).toBe(2);
  });

  it("가격이 없는 단지는 건너뛰고 따로 센다 — 열쇠 없이 지어내지 않는다", () => {
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, null, "presale_min", "2026-08-01")],
      supply(["ap-1"], threeUnits),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.noPrice).toBe(1);
  });

  it("청약홈 표가 없는 단지는 건너뛰고 따로 센다", () => {
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, 54000, "presale_min", "2026-08-01")],
      new Map(),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.noSupply).toBe(1);
  });

  it("표는 있으나 쓸 수 있는 주택형이 없으면 따로 센다", () => {
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, 54000, "presale_min", "2026-08-01")],
      supply(["ap-1"], [U("300.0000 ", 50000)]),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.noMatch).toBe(1);
  });

  it("가격이 문턱보다 벌어지면 채우지 않고 따로 센다 — 두 표가 다른 집을 가리킨다", () => {
    // 저장가 1,641 ↔ 청약홈 42,542 (25배) — 운영에서 실제로 나온 건(임대 보증금이 섞인 것으로 보임)
    const r = selectApplyhomeAreaTargets(
      [P(1, "ap-1", null, 1641, "presale_min", "2026-08-01")],
      supply(["ap-1"], [U("059.6100 ", 42542)]),
    );
    expect(r.targets).toHaveLength(0);
    expect(r.farGap).toBe(1);
  });

  it("문턱 경계 — 30% 이하는 채우고, 넘으면 안 채운다", () => {
    /** @param {number} amount */
    const run = (amount) =>
      selectApplyhomeAreaTargets(
        [P(1, "ap-1", null, 100, "presale_min", "2026-08-01")],
        supply(["ap-1"], [U("059.9801 ", amount)]),
      );
    expect(run(129).targets).toHaveLength(1); // 차이 29% — 통과
    expect(run(130).targets).toHaveLength(1); // 차이 30% — 경계는 포함
    expect(run(131).targets).toHaveLength(0); // 차이 31% — 제외
    expect(run(131).farGap).toBe(1);
    expect(run(70).targets).toHaveLength(1); // 반대 방향 30% 도 같게 다룬다
    expect(run(69).targets).toHaveLength(0);
  });

  it("⚠️ 뮤테이션 대상 — 문턱값은 리터럴로 못 박는다(관측값 앵커)", () => {
    // 상수에서 읽어 검사하면 상수를 바꿔도 단언이 따라가 아무것도 안 지킨다
    // (.claude/rules/meta/guards-must-be-mutation-tested.md §"파생 가드는 상수 변경을 못 잡는다").
    //
    // 30% 인 근거 = 대조군 518곳 구간별 실측(2026-08-25):
    //   10~30% 구간 1㎡ 일치 93.6% / 10㎡ 넘게 틀림 3.5%
    //   30~100% 구간          38.7% /              35.5%  ← 여기서 절벽
    // 이 값을 옮기려면 그 표를 다시 재고 이 주석과 함께 옮긴다.
    expect(MAX_PRICE_GAP_RATIO).toBe(0.3);
  });

  it("여러 단지를 섞어도 각 무리가 제 칸으로 간다", () => {
    const r = selectApplyhomeAreaTargets(
      [
        P(1, "ap-A", null, 54000, "presale_min", "2026-08-01"), // 대상
        P(2, "ap-B", 84.5, 54000, "presale_min", "2026-08-01"), // 이미 채워짐
        P(3, "ap-C", null, null, "presale_min", "2026-08-01"), // 가격 없음
        P(4, "ap-D", null, 54000, "presale_min", "2026-08-01"), // 표 없음
      ],
      supply(["ap-A", "ap-B", "ap-C"], threeUnits),
    );
    expect(r.targets.map((t) => t.aptId)).toEqual(["ap-A"]);
    expect(r.alreadyFilled).toBe(1);
    expect(r.noPrice).toBe(1);
    expect(r.noSupply).toBe(1);
  });
});
