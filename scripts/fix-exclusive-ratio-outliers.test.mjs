// @ts-check
/**
 * fix-exclusive-ratio-outliers.mjs 테스트 — 전용률 이상치 판정 순수 함수 검증 (세션538/539)
 *
 * ⚠️ 뮤테이션 대상 (`.claude/rules/meta/guards-must-be-mutation-tested.md`):
 *   이 가드는 "고장 내서 잡히는지"를 실제로 돌려 확인한 것이다(세션 실증 기록 참조).
 *
 * ★★가장 중요한 가드 = "오피스텔 5곳이 안 건드려지는가"★★ — 라이브 실측(2026-09-01)에서
 * 확인된 실제 5곳(하나스테이대명 56.1 · 대전관평예미지어반코어 2곳 50 · 힐스테이트송파더그리드 58 ·
 * 중화역라온프라이빗센트로(오) 58)은 전부 `presale_housing_type`="오피스텔"이고 청약홈·prices
 * 재료가 아예 없다. 이 5곳이 하나라도 fix/clear 로 가면 규칙 구현이 틀린 것이다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  isOutlier,
  decideOutlier,
  GROUP_DISAGREE_MAX,
  OWN_MATERIAL_DISAGREE_MIN,
  CLEAR_REASON,
} from "./fix-exclusive-ratio-outliers.mjs";

describe("isOutlier — 타당 범위 밖 저장값만 대상", () => {
  it("타당 범위 안이면 애초에 대상 아님", () => {
    expect(isOutlier(60)).toBe(false);
    expect(isOutlier(75)).toBe(false);
    expect(isOutlier(90)).toBe(false);
  });
  it("범위 밖 non-null 이면 대상", () => {
    expect(isOutlier(59.9)).toBe(true);
    expect(isOutlier(90.1)).toBe(true);
    expect(isOutlier(48.5)).toBe(true);
    expect(isOutlier(100)).toBe(true);
  });
  it("null/undefined 는 대상 아님(빈칸은 backfill 소관)", () => {
    expect(isOutlier(null)).toBe(false);
    expect(isOutlier(undefined)).toBe(false);
  });
});

describe("decideOutlier — 규칙 1 재계산", () => {
  it("그룹 재료 중앙값이 타당 범위 안이면 채택한다 (자기 prices 재료 없음)", () => {
    // 실사례 답습: 소사역 프라힐스 — 자기 house_ty 는 있으나 supply_area 가 null 이라 자기
    // 재료로는 계산 불가, 같은 region+gu+house_ty 를 쓰는 다른 회차 값을 빌려온다.
    const d = decideOutlier(48.5, null, { groupCandidates: [73.4, 73.4, 73.6, 73.6] });
    expect(d.action).toBe("fix");
    expect(d.value).toBe(73.5);
  });

  it("그룹 재료가 타당 범위 밖인 것만 있으면 재계산되지 않는다(중앙값 자체가 null)", () => {
    const d = decideOutlier(48.5, null, { groupCandidates: [40, 45, 96] });
    expect(d.action).not.toBe("fix");
  });

  it("규칙1 재료충돌로 미채택 — 자기 prices 재료가 그룹 중앙값과 5%p 넘게 어긋나면 기각", () => {
    // 실사례 답습: 아크로리츠카운티 — groupMedian=76.2, ownPrice=67.4 (차이 8.8%p > 5)
    const d = decideOutlier(50.7, "아파트", {
      groupCandidates: [67.4, 75.3, 76.2, 76.2, 76.3, 79.2],
      ownPrice: 67.4,
    });
    expect(d.action).not.toBe("fix");
    // 기각 후 규칙2(b) 로 넘어가 비워진다(아파트 계열)
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.APT_LIKE_OUT_OF_RANGE);
  });

  it("자기 prices 재료가 5%p 이내로 일치하면 그대로 채택한다(경계값 포함)", () => {
    const d = decideOutlier(50, null, {
      groupCandidates: [75, 75],
      ownPrice: 75 - GROUP_DISAGREE_MAX, // 정확히 5%p 차이 — 초과가 아니라 경계
    });
    expect(d.action).toBe("fix");
  });

  it("자기 prices 재료가 타당 범위 밖이면 애초에 충돌 판정에서 빠진다(그룹값 그대로 채택)", () => {
    const d = decideOutlier(48.5, null, { groupCandidates: [73.5, 73.5], ownPrice: 30 });
    expect(d.action).toBe("fix");
    expect(d.value).toBe(73.5);
  });

  it("그룹 재료 자체가 없으면 규칙1 통과 못함", () => {
    const d = decideOutlier(50, "오피스텔", { groupCandidates: [] });
    expect(d.action).not.toBe("fix");
  });
});

describe("decideOutlier — 규칙 2 비움", () => {
  it("(a) 저장값 100 이상 — 정의상 불가능", () => {
    const d = decideOutlier(100, "오피스텔", {});
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.GE_100);
  });
  it("(a) 100 초과도 비운다", () => {
    expect(decideOutlier(150, null, {}).action).toBe("clear");
  });
  it("(a) 99.9는 아직 100 미만이라 (a) 로는 안 걸린다(다른 규칙으로 갈릴 수 있음)", () => {
    const d = decideOutlier(99.9, null, {});
    expect(d.reason).not.toBe(CLEAR_REASON.GE_100);
  });

  it("(b) 아파트 계열(아파트)인데 타당 범위 밖", () => {
    const d = decideOutlier(53, "아파트", {});
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.APT_LIKE_OUT_OF_RANGE);
  });
  it("(b) 아파트 계열(주상복합)도 동일하게 비운다", () => {
    const d = decideOutlier(41.9, "주상복합", {});
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.APT_LIKE_OUT_OF_RANGE);
  });
  it("(b) 아파트 계열이 아니면 이 사유로는 안 걸린다", () => {
    const d = decideOutlier(53, "오피스텔", {});
    expect(d.reason).not.toBe(CLEAR_REASON.APT_LIKE_OUT_OF_RANGE);
  });

  it("(c) 재료와 따로 놈 — 청약홈·prices 둘 다 있고 둘 다 타당범위 안인데 저장값이 둘 다와 3%p+ 다름", () => {
    const d = decideOutlier(50, "오피스텔", {
      ownApplyhome: [75, 76],
      ownPrice: 74,
    });
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.DISAGREES_WITH_OWN_MATERIALS);
  });
  it("(c) 재료 중 하나만 있어도 그것과 3%p+ 다르면 비운다", () => {
    const d = decideOutlier(50, null, { ownPrice: 74 });
    expect(d.action).toBe("clear");
    expect(d.reason).toBe(CLEAR_REASON.DISAGREES_WITH_OWN_MATERIALS);
  });
  it("(c) 재료 중 하나라도 저장값과 3%p 이내로 가까우면 비우지 않는다(some 아닌 every)", () => {
    // ⚠️ 뮤테이션 표적 — every 를 some 으로 바꾸면 이 케이스가 거짓으로 clear 된다.
    // 두 재료 모두 그 자체로 타당 범위(60~90) 안이어야 "재료"로 인정된다 — 60 은 하한 경계.
    const d = decideOutlier(58, "오피스텔", {
      ownApplyhome: [60], // |58-60| = 2%p < 3 → 이 재료와는 가깝다
      ownPrice: 75,        // |58-75| = 17%p → 이 재료와는 멀다
    });
    expect(d.action).toBe("keep");
  });
  it("(c) 정확히 3%p 차이는 '이상'이라 비운다(경계 포함)", () => {
    const material = 60; // 타당 범위 하한(경계) — 재료로 유효
    const current = material - OWN_MATERIAL_DISAGREE_MIN; // 정확히 3%p 밖
    const d = decideOutlier(current, null, { ownPrice: material });
    expect(d.action).toBe("clear");
  });
  it("(c) 재료가 타당 범위 밖이면 재료로 안 쓴다 — 있어도 없는 것과 같다", () => {
    // 실사례 답습: 중화역라온프라이빗센트로(오) — ownPrice=58(타당범위 60~90 밖) → 재료 무효
    const d = decideOutlier(58, "오피스텔", { ownPrice: 58 });
    expect(d.action).toBe("keep");
  });
});

describe("decideOutlier — 규칙 3 놔둠 (★가장 중요한 회귀 가드★)", () => {
  it("오피스텔 5곳(라이브 실측값) — 재료가 아예 없으면 절대 건드리지 않는다", () => {
    const officetels = [
      { current: 56.1, name: "하나스테이대명" },
      { current: 50, name: "대전관평예미지어반코어(1356)" },
      { current: 50, name: "대전관평예미지어반코어(1345)" },
      { current: 58, name: "힐스테이트송파더그리드" },
      { current: 58, name: "중화역라온프라이빗센트로(오)" },
    ];
    for (const o of officetels) {
      const d = decideOutlier(o.current, "오피스텔", { groupCandidates: [], ownApplyhome: [], ownPrice: null });
      expect(d.action).toBe("keep");
    }
  });

  it("유형 미상(null)이고 재료도 없으면 놔둔다", () => {
    const d = decideOutlier(53, null, {});
    expect(d.action).toBe("keep");
  });

  it("mat 자체를 아예 안 넘겨도(옵션 필드 전부 생략) 안전하게 놔둔다", () => {
    const d = decideOutlier(53, "오피스텔", {});
    expect(d.action).toBe("keep");
  });
});

describe("상수 — 리터럴로 못 박는다", () => {
  it("규칙1 그룹 충돌 문턱 = 5%p", () => {
    expect(GROUP_DISAGREE_MAX).toBe(5);
  });
  it("규칙2(c) 자기재료 불일치 문턱 = 3%p", () => {
    expect(OWN_MATERIAL_DISAGREE_MIN).toBe(3);
  });
});

describe("배선 — main 이 실제로 이 판정을 쓰는가", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fix-exclusive-ratio-outliers.mjs"),
    "utf8",
  );

  it("main 이 decideOutlier 를 호출한다 (좌변까지 고정 — 선언부 오매칭 방지)", () => {
    expect(src).toMatch(/const\s+d\s*=\s*decideOutlier\(/);
  });
  it("대상 선정에 isOutlier 를 쓴다", () => {
    expect(src).toMatch(/apts\.filter\(\s*\(a\)\s*=>\s*isOutlier\(/);
  });
  it("재료를 청약홈·prices·apartments 세 곳에서 모두 읽는다", () => {
    expect(src).toContain('.from("applyhome_unit_supply")');
    expect(src).toContain('.from("prices")');
    expect(src).toContain('.from("apartments")');
  });
  it("청약홈 select 문자열에 커서 키·region·gu·house_ty·supply_area 가 들어 있다", () => {
    expect(src).toContain('"id, apartment_id, house_ty, supply_area"');
    expect(src).toContain('"id, name, exclusive_ratio, presale_housing_type, region, gu"');
  });
  it("큰 표를 고유키 커서로 훑는다 (무정렬 페이징 금지)", () => {
    expect(src.match(/sb,\s*\n\s*"id",/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
  it("--apply 없이는 쓰지 않는다 (기본 dry-run)", () => {
    expect(src).toMatch(/const\s+apply\s*=\s*process\.argv\.includes\("--apply"\)/);
    expect(src).toMatch(/if\s*\(!apply\)\s*\{/);
  });
  it("전량을 로그로 찍는다 (15건 상한 없음 — 결과 재현 불가 사고 답습)", () => {
    expect(src).not.toMatch(/\.slice\(0,\s*15\)/);
  });
  it("반영 시 exclusive_ratio 와 updated_at 을 함께 갱신한다", () => {
    expect(src).toMatch(/update\(\{\s*exclusive_ratio:\s*r\.to,\s*updated_at:/);
    expect(src).toMatch(/update\(\{\s*exclusive_ratio:\s*null,\s*updated_at:/);
  });
});
