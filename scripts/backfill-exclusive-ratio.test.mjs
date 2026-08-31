// @ts-check
/**
 * backfill-exclusive-ratio.mjs 테스트 — 전용률 판정 순수 함수 검증 (세션537)
 *
 * ⚠️ 뮤테이션 대상 (`.claude/rules/meta/guards-must-be-mutation-tested.md`):
 *   이 가드는 "고장 내서 잡히는지"를 실제로 돌려 확인한 것이다. 목록은 세션 기록 참조.
 *   경쟁 후보값(내가 기각한 범위)도 포함한다 — 옛 값 복원만 시험하면 이번 결정은 무방비다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  parseExclusiveArea,
  ratioFrom,
  isPlausible,
  median,
  decide,
  HOLD,
  VALID_MIN,
  VALID_MAX,
  MATERIAL_DISAGREE_MAX,
} from "./backfill-exclusive-ratio.mjs";

describe("parseExclusiveArea — 청약홈 주택형 코드에서 전용면적", () => {
  it("영문 접미가 붙은 표준형", () => {
    expect(parseExclusiveArea("084.9478B")).toBe(84.9478);
  });
  it("접미 없는 형태", () => {
    expect(parseExclusiveArea("120.7345")).toBe(120.7345);
  });
  it("앞 0 이 붙어도 숫자로", () => {
    expect(parseExclusiveArea("059.9302A")).toBe(59.9302);
  });
  it("숫자로 시작하지 않으면 null", () => {
    expect(parseExclusiveArea("A084")).toBeNull();
    expect(parseExclusiveArea("")).toBeNull();
    expect(parseExclusiveArea(null)).toBeNull();
    expect(parseExclusiveArea(undefined)).toBeNull();
  });
  it("0 은 면적이 아니다", () => {
    expect(parseExclusiveArea("000.0000")).toBeNull();
  });
});

describe("ratioFrom — 전용률 계산", () => {
  it("실제 청약홈 값으로 계산 (84.9478 / 112.726)", () => {
    expect(ratioFrom(84.9478, 112.726)).toBe(75.4);
  });
  it("소수점 1자리로 반올림", () => {
    expect(ratioFrom(60, 80)).toBe(75);
    expect(ratioFrom(59.9302, 81.8419)).toBe(73.2);
  });
  it("공급면적이 0 이거나 없으면 null — 0 으로 나누지 않는다", () => {
    expect(ratioFrom(84, 0)).toBeNull();
    expect(ratioFrom(84, null)).toBeNull();
    expect(ratioFrom(84, undefined)).toBeNull();
  });
  it("전용면적이 없으면 null", () => {
    expect(ratioFrom(null, 112)).toBeNull();
    expect(ratioFrom(0, 112)).toBeNull();
  });
});

describe("isPlausible — 물리적 타당 범위", () => {
  it("경계값을 포함한다", () => {
    expect(isPlausible(VALID_MIN)).toBe(true);
    expect(isPlausible(VALID_MAX)).toBe(true);
  });
  it("경계 밖은 거짓", () => {
    expect(isPlausible(VALID_MIN - 0.1)).toBe(false);
    expect(isPlausible(VALID_MAX + 0.1)).toBe(false);
  });
  it("실제로 발견된 오염값들을 걸러낸다", () => {
    // 라이브 실측 사례 — 아파트인데 전용률이 40~59%로 적혀 있던 곳들
    for (const v of [40, 41.8, 45, 47.3, 52.2, 54, 56.4, 59]) {
      expect(isPlausible(v)).toBe(false);
    }
    // 상한 밖 사례 (서초비버리캐슬 92.4, prices/DB 의 100)
    expect(isPlausible(92.4)).toBe(false);
    expect(isPlausible(100)).toBe(false);
  });
  it("정상 범위 값은 통과한다", () => {
    for (const v of [61.2, 69.9, 74.8, 78.1, 82.6, 83.3]) {
      expect(isPlausible(v)).toBe(true);
    }
  });
  it("숫자가 아니면 거짓", () => {
    expect(isPlausible(null)).toBe(false);
    expect(isPlausible(undefined)).toBe(false);
    expect(isPlausible(NaN)).toBe(false);
  });
});

describe("median", () => {
  it("홀수 개", () => expect(median([70, 75, 80])).toBe(75));
  it("짝수 개는 가운데 둘의 평균", () => expect(median([70, 74, 76, 80])).toBe(75));
  it("빈 배열은 null", () => expect(median([])).toBeNull());
  it("원본을 바꾸지 않는다", () => {
    const src = [80, 70, 75];
    median(src);
    expect(src).toEqual([80, 70, 75]);
  });
  it("극단값 하나에 끌려가지 않는다 (평균과 다름)", () => {
    // 평균이면 76.25 로 밀리지만 중앙값은 74.5 로 버틴다
    expect(median([74, 74, 75, 82])).toBe(74.5);
  });
});

describe("decide — 판정", () => {
  it("빈칸 + 재료 있음 → 채운다", () => {
    const d = decide(null, { applyhome: [75.4, 74.8, 76.0] });
    expect(d.action).toBe("fill");
    expect(d.value).toBe(75.4);
  });
  it("0 도 빈칸으로 본다 (sentinel)", () => {
    expect(decide(0, { applyhome: [75] }).action).toBe("fill");
  });
  it("범위 밖 기존값 + 재료 있음 → 정정한다", () => {
    const d = decide(45, { applyhome: [78.1] });
    expect(d.action).toBe("fix");
    expect(d.value).toBe(78.1);
  });
  it("상한 밖도 정정 대상", () => {
    expect(decide(92.4, { applyhome: [73.4] }).action).toBe("fix");
  });

  // ⚠️ 이 스크립트의 핵심 경계 — 세션536 "기존 값 불변" 원칙
  it("범위 안 기존값은 재료와 크게 달라도 건드리지 않는다", () => {
    expect(decide(62, { applyhome: [80] }).action).toBe("keep");
    expect(decide(88, { applyhome: [70] }).action).toBe("keep");
    expect(decide(VALID_MIN, { applyhome: [85] }).action).toBe("keep");
    expect(decide(VALID_MAX, { applyhome: [65] }).action).toBe("keep");
  });

  it("재료가 아예 없으면 보류", () => {
    const d = decide(null, {});
    expect(d.action).toBe("hold");
    expect(d.reason).toBe(HOLD.NO_MATERIAL);
  });
  it("재료가 전부 타당 범위 밖이면 보류 — 재료도 틀릴 수 있다", () => {
    const d = decide(null, { applyhome: [41.9, 45], prices: 100 });
    expect(d.action).toBe("hold");
    expect(d.reason).toBe(HOLD.MATERIAL_OUT_OF_RANGE);
  });
  it("두 재료가 크게 어긋나면 보류 — 어느 쪽도 못 믿는다", () => {
    const d = decide(null, { applyhome: [75], prices: 75 + MATERIAL_DISAGREE_MAX + 1 });
    expect(d.action).toBe("hold");
    expect(d.reason).toBe(HOLD.MATERIAL_DISAGREE);
  });
  it("두 재료가 허용 오차 안이면 채택한다", () => {
    const d = decide(null, { applyhome: [74], prices: 74 + MATERIAL_DISAGREE_MAX });
    expect(d.action).toBe("fill");
    expect(d.value).toBe(74 + MATERIAL_DISAGREE_MAX / 2);
  });
  it("재료 중 범위 밖인 것만 골라 버리고 나머지로 계산한다", () => {
    // 45 는 버리고 [74, 76] 의 중앙값 75
    const d = decide(null, { applyhome: [45, 74, 76] });
    expect(d.action).toBe("fill");
    expect(d.value).toBe(75);
  });
  it("prices 만 있어도 채운다", () => {
    expect(decide(null, { prices: 73.8 })).toEqual({ action: "fill", value: 73.8 });
  });
});

describe("타당 범위 상수 — 관측값 앵커", () => {
  // 세션537 라이브 실측(2026-08-31): 청약홈·prices 두 독립 출처가 3%p 이내로 일치한
  // 538곳("신뢰 코어")의 분포. 티어 값이 아니라 **관측값**이라 파생 가드가 아니다
  // (`.claude/rules/meta/guards-must-be-mutation-tested.md` §관측값 앵커).
  const CORE_MIN = 61.2;
  const CORE_MAX = 83.3;

  it("경계는 리터럴로 못 박는다 (표에서 읽으면 같이 밀린다)", () => {
    expect(VALID_MIN).toBe(60);
    expect(VALID_MAX).toBe(90);
    expect(MATERIAL_DISAGREE_MAX).toBe(5);
  });

  it("신뢰 코어를 통째로 품는다 — 정상값을 오염으로 잡지 않는다", () => {
    expect(VALID_MIN).toBeLessThanOrEqual(CORE_MIN);
    expect(VALID_MAX).toBeGreaterThanOrEqual(CORE_MAX);
  });

  it("그렇다고 너무 넓지 않다 — 명백한 오류를 놓치지 않는다", () => {
    // 55~95 로 넓히면 의정부역 웰라시티(56.4)·서초비버리캐슬(92.4)을 놓친다
    expect(VALID_MIN).toBeGreaterThan(55);
    expect(VALID_MAX).toBeLessThan(95);
  });
});

describe("배선 — main 이 실제로 이 판정을 쓰는가", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "backfill-exclusive-ratio.mjs"),
    "utf8",
  );

  it("main 이 decide 를 호출한다 (좌변까지 고정 — 선언부에 오매칭 방지)", () => {
    expect(src).toMatch(/const\s+d\s*=\s*decide\(\s*cur\s*,/);
  });
  it("재료를 청약홈·prices 두 곳에서 모두 읽는다", () => {
    expect(src).toContain('.from("applyhome_unit_supply")');
    expect(src).toContain('.from("prices")');
  });
  it("청약홈 select 문자열에 커서 키와 계산 재료가 들어 있다", () => {
    expect(src).toContain('"id, apartment_id, house_ty, supply_area"');
  });
  it("--apply 없이는 쓰지 않는다 (기본 dry-run)", () => {
    expect(src).toMatch(/const\s+apply\s*=\s*process\.argv\.includes\("--apply"\)/);
    expect(src).toMatch(/if\s*\(!apply\)\s*\{/);
  });
  it("큰 표를 고유키 커서로 훑는다 (무정렬 페이징 금지)", () => {
    // unordered-pagination-loses-rows.md §1 — selectAll 3번째 인자가 keyCol
    expect(src.match(/sb,\s*\n\s*"id",/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
