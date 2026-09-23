import { describe, it, expect } from "vitest";
import {
  tierMax,
  tierMaxLabel,
  tierMin,
  IC_DIST_TIERS,
  IC_DIST_FALLBACK_LABEL,
  KTX_DIST_TIERS,
  KTX_DIST_FALLBACK_LABEL,
  DEV_SCORE_TIERS,
  DEV_SCORE_NEGATIVE_MULT,
  DEV_SCORE_BASE,
  DEV_NEUTRAL_BAND_PCT,
  DEV_BAND_LABEL,
  AIR_PM10_TIERS,
  AIR_PM10_DEFAULT,
  AIR_O3_TIERS,
  AIR_O3_DEFAULT,
  AIR_O3_BAD_SCORE,
  AIR_QUALITY_TIERS,
  AIR_PM10_LEGEND,
  AIR_O3_LEGEND,
  AIR_ANNUAL_LEGEND,
  NOISE_TIERS,
  CANCEL_RATIO_TIERS,
  CANCEL_RATIO_HIGH_SCORE,
  LAND_COST_TIERS,
  LAND_COST_LOW,
  SUBWAY_DIST_TIERS,
  TRANSIT_DIST_TIERS,
  TRANSIT_DIST_FAR_SCORE,
  CITY_DIST_TIERS,
  DEV_DIST_FAR_SCORE,
  INDUSTRY_DIST_TIERS,
  UNIT_TIERS,
  UNIT_SMALL_SCORE,
  PARKING_TIERS,
  PARKING_LOW_SCORE,
  FAR_TIERS,
  FAR_HIGH_SCORE,
  EXCL_RATIO_TIERS,
  EXCL_LOW_SCORE,
  FLOOR_TIERS,
  FLOOR_LOW_SCORE,
  UNSOLD_RATE_TIERS,
  UNSOLD_HIGH_SCORE,
  LIQUIDITY_TIERS,
  LIQUIDITY_LOW_SCORE,
  HOUSING_SUPPLY_LEVEL_TIERS,
  HOUSING_SUPPLY_HIGH_SCORE,
  POLICE_DIST_TIERS,
  POLICE_DIST_HIGH_SCORE,
  INIT_SALE_TIERS,
  INIT_SALE_HIGH_RISK,
  type Tier,
} from "./scoringTiers";
import { scoreLocation } from "@/scoring/scoreLocation";
import { calcCats } from "@/scoring/engine";
import { SUB_CONTEXT } from "@/constants/subContext";

/**
 * 세션499 정정 가드.
 *
 * 이전: scoreLocation.ts 가 `icDist <= 2 ? "우수" : icDist <= 5 ? "양호" : "보통"` 으로
 * 등급 경계를 점수표와 **따로** 박고 있었다. 그래서 마지막 티어를 넘긴 거리(= 점수 0)까지
 * "보통"으로 표시됐다 — 손님은 "그럭저럭"으로 읽는데 실제 점수는 최하인 거짓.
 *
 * 아래 테스트는 경계값을 하드코딩하지 않고 **티어표에서 읽어** 검사한다. 티어를 조정해도
 * 테스트가 따라오고, 등급을 다시 호출부에 박으면 red 가 된다.
 */

const maxOf = (t: Tier): number => {
  const m = t.max;
  if (m == null) throw new Error("거리 티어에는 max 가 있어야 한다");
  return m;
};
const beyondLastTier = (tiers: readonly Tier[]): number => Math.max(...tiers.map(maxOf)) + 1;

const LABELED_DIST_TIERS = [
  { name: "IC", tiers: IC_DIST_TIERS, fallback: IC_DIST_FALLBACK_LABEL },
  { name: "KTX", tiers: KTX_DIST_TIERS, fallback: KTX_DIST_FALLBACK_LABEL },
] as const;

/**
 * 세션500 결정 고정 가드.
 *
 * 위 테스트들은 전부 티어표에서 값을 **유도**하므로, 경계를 옛 `2/5/10` 으로 되돌려도 하나도
 * 깨지지 않는다. 그러면 이 결정이 조용히 무효화될 수 있어 여기서 경계 자체를 고정한다.
 *
 * ⚠️ 이 숫자를 바꾸려면 이 주석과 scoringTiers.ts 의 IC_DIST_TIERS 근거 블록을 먼저 읽을 것.
 * 되돌리는 게 금지는 아니지만 **의식적으로** 해야 한다.
 *
 * 근거 요약 (전 단지 2,635곳 실측, ic_dist 백필 100% 완료 후):
 *   옛 2/5/10 → 우수 45.3% · 양호 44.1% (열 곳 중 아홉이 위 두 칸) · 점수 표준편차 4.52 = 변별 0
 *   새 1.3/2.5/10 → 우수 26.2% · 양호 31.3% · 보통 40.1% · 원거리 2.4% · 표준편차 5.22
 *   더 올릴 수는 있으나(sd 6.73~7.77) 마지막 경계를 3.4~3.5km 로 당겨야 해서 0점·"원거리" 가
 *   2.4% → 24.8~27.1% 로 늘어난다 — IC 4km(차로 6분)를 "원거리" 라 부르는 거짓이라 기각했다.
 */
describe("IC 경계는 세션500 실측 결정값이다 (되돌릴 때 근거를 읽게 만드는 고정 가드)", () => {
  it("경계 = 1.3 / 2.5 / 10", () => {
    expect(IC_DIST_TIERS.map(maxOf)).toEqual([1.3, 2.5, 10]);
  });

  it("최상위 경계는 실측 p25(1.3km) 라 '우수'가 상위 4분의 1 안에 머문다", () => {
    // 이 프로젝트는 FULL_BUS_ROUTES 주석에서 만점 30.2% 를 "세 곳 중 한 곳 동점 → 변별 불가"
    // 로 기각했다. IC 도 같은 선 아래여야 자기모순이 없다(1.3km → 26.2%).
    expect(maxOf(IC_DIST_TIERS[0])).toBeLessThanOrEqual(1.3);
  });

  it("마지막 경계는 10km 이상이어야 한다 — 4km 를 '원거리'로 표시하지 않기 위한 제약", () => {
    expect(maxOf(IC_DIST_TIERS[IC_DIST_TIERS.length - 1])).toBeGreaterThanOrEqual(10);
  });
});

describe("거리 등급 라벨은 점수표에서 유도된다", () => {
  for (const { name, tiers, fallback } of LABELED_DIST_TIERS) {
    it(`${name}: 모든 티어에 등급 라벨이 있다`, () => {
      for (const t of tiers) {
        expect(t.label, `${name} max=${t.max} 티어에 label 누락`).toBeTruthy();
      }
    });

    it(`${name}: 티어 경계에서 라벨과 점수가 같은 티어를 가리킨다`, () => {
      for (const t of tiers) {
        const v = maxOf(t);
        expect(tierMaxLabel(v, tiers, fallback)).toBe(t.label);
        expect(tierMax(v, tiers, 0)).toBe(t.score);
      }
    });

    it(`${name}: 점수 0 구간에는 등급 라벨이 새지 않는다`, () => {
      const beyond = beyondLastTier(tiers);
      expect(tierMax(beyond, tiers, 0)).toBe(0);
      expect(tierMaxLabel(beyond, tiers, fallback)).toBe(fallback);
      // "보통" 같은 중립 등급이 0점 구간까지 흘러나오면 안 된다 (세션499 진앙)
      for (const t of tiers) {
        expect(tierMaxLabel(beyond, tiers, fallback)).not.toBe(t.label);
      }
    });
  }
});

// --- 호출부 가드: 헬퍼만 만들고 화면 문구는 하드코딩 그대로인 "가짜 통과" 차단 ---

type TransportSub = { name: string; detail: string };

function transportDetail(overrides: Record<string, unknown>): string {
  const apt = {
    region: "경기",
    gu: "수원시",
    subwayDist: 500,
    busRoutes: 10,
    icDist: 5,
    ktxDist: 10,
    ...overrides,
  };
  const res = scoreLocation(apt as never) as unknown as { subs: TransportSub[] };
  return res.subs.find((s) => s.name === "교통")?.detail ?? "";
}

describe("scoreLocation 교통 문구가 점수와 어긋나지 않는다", () => {
  for (const { name, tiers, fallback } of LABELED_DIST_TIERS) {
    const field = name === "IC" ? "icDist" : "ktxDist";

    it(`${name}: 점수 0인 거리는 중립 등급이 아니라 "${fallback}" 로 표시된다`, () => {
      const beyond = beyondLastTier(tiers);
      expect(tierMax(beyond, tiers, 0)).toBe(0); // 전제: 이 거리는 정말 0점이다
      const detail = transportDetail({ [field]: beyond });
      expect(detail).toContain(`${name} ${beyond}km ${fallback}`);
      for (const t of tiers) {
        expect(detail).not.toContain(`${name} ${beyond}km ${t.label}`);
      }
    });

    it(`${name}: 점수가 있는 구간은 그 티어의 등급으로 표시된다`, () => {
      for (const t of tiers) {
        const v = maxOf(t);
        expect(transportDetail({ [field]: v })).toContain(`${name} ${v}km ${t.label}`);
      }
    });
  }
});

// ── 괴리도 눈금 — 관측값 앵커 (세션531) ────────────────────────────────────────
//
// ⚠️ **파생 가드만 두면 상수를 아무 값으로 바꿔도 전부 초록이 된다.** 이 저장소는 실제로 그 사고를
// 겪었다 — `LIQUIDITY_TIERS` 를 2,000 → 2,500 으로 바꾸는 뮤테이션에 468건이 전부 green 이었다
// (.claude/rules/meta/guards-must-be-mutation-tested.md §"파생 가드는 상수 변경을 못 잡는다").
// 그래서 아래는 **티어 값이 아니라 관측값**을 적고, 상수가 그 근방에 있는지를 본다.
describe("괴리도 눈금 관측값 앵커 (2026-08-24 실측)", () => {
  // 모집단 = 손님 노출(임대 제외) 중 **평형별 실거래 버킷 경로를 타는** 1,428곳.
  // 폴백군(면적 미상)은 값 자체가 편향돼 있어 앵커로 쓰지 않는다.
  const TRUSTED_P90 = 35.7; // 만점 경계의 근거 — 상위 10%가 만점
  const TRUSTED_P15_ABS = 37.0; // 바닥 경계의 근거 — 하위 15%가 최하
  // 계수를 문서화된 범위 안에서 흔들었을 때 괴리율이 움직이는 폭의 중앙(n=1,537).
  // 미준공 패리티 1.265~1.455(±7.1%) · AGE_PREMIUM 앵커 허용 ±15%.
  const COEFF_SWING_MEDIAN = 11.5;

  it("만점 경계는 신뢰군 p90 의 ±15% 안", () => {
    const ratio = DEV_SCORE_TIERS[0].min / TRUSTED_P90;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("바닥 경계(0점 도달 지점)는 신뢰군 p15 의 ±15% 안", () => {
    const zeroAt = DEV_SCORE_BASE / DEV_SCORE_NEGATIVE_MULT;
    const ratio = zeroAt / TRUSTED_P15_ABS;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("'적정가 수준' 밴드는 우리 추정 흔들림의 ±25% 안", () => {
    // 밴드가 흔들림보다 훨씬 좁으면(옛 ±5) 추정 오차보다 작은 차이로 저렴/비쌈을 단정하게 되고,
    // 훨씬 넓으면 그 라벨이 다른 둘을 삼켜 축이 말을 안 하게 된다.
    const ratio = DEV_NEUTRAL_BAND_PCT / COEFF_SWING_MEDIAN;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });

  // ⚠️ 경계를 **표에서 읽어** 검사하면 표가 밀릴 때 단언도 같이 밀린다(세션529 자책).
  //    리터럴로 못 박는다 — 연속성을 유지한 채 경계만 옮기는 뮤테이션도 red 가 된다.
  it("구간 경계는 리터럴로 고정한다 (표가 밀리면 red)", () => {
    expect(DEV_SCORE_TIERS.map((t) => t.min)).toEqual([35, 18, 9, 0]);
    expect(DEV_SCORE_NEGATIVE_MULT).toBe(1);
    expect(DEV_SCORE_BASE).toBe(35);
    expect(DEV_NEUTRAL_BAND_PCT).toBe(10);
  });

  it("곡선이 이어지고 뒤집히지 않는다 (구간 사이 도약은 만점 진입 한 곳뿐)", () => {
    const tiers = DEV_SCORE_TIERS as Array<{
      min: number;
      score?: number;
      base?: number;
      span?: number;
      range?: number;
    }>;
    const at = (d: number): number => {
      const s =
        d >= tiers[0].min
          ? (tiers[0].score as number)
          : d >= tiers[1].min
            ? (tiers[1].base as number) + ((d - tiers[1].min) / (tiers[1].span as number)) * (tiers[1].range as number)
            : d >= tiers[2].min
              ? (tiers[2].base as number) +
                ((d - tiers[2].min) / (tiers[2].span as number)) * (tiers[2].range as number)
              : d >= tiers[3].min
                ? (tiers[3].base as number) + (d / (tiers[3].span as number)) * (tiers[3].range as number)
                : Math.max(0, DEV_SCORE_BASE + d * DEV_SCORE_NEGATIVE_MULT);
      return Math.max(0, Math.min(s, 100));
    };
    let prev = -1;
    let bigJumps = 0;
    for (let d = -60; d <= 60; d += 0.25) {
      const v = at(d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9); // 단조 증가 — 싸질수록 점수가 내려가면 안 된다
      if (prev >= 0 && v - prev > 2.01) bigJumps++;
      prev = v;
    }
    expect(bigJumps).toBe(1); // 만점 진입(95→97) 한 곳
    expect(at(0)).toBe(DEV_SCORE_BASE);
    expect(at(-DEV_SCORE_BASE / DEV_SCORE_NEGATIVE_MULT)).toBe(0);
  });

  it("밴드 안내 문구가 세 상수를 모두 말한다", () => {
    expect(DEV_BAND_LABEL).toContain(`±${DEV_NEUTRAL_BAND_PCT}%`);
    expect(DEV_BAND_LABEL).toContain(`+${DEV_SCORE_TIERS[0].min}%`);
    expect(DEV_BAND_LABEL).toContain(`−${DEV_SCORE_BASE / DEV_SCORE_NEGATIVE_MULT}%`);
    expect(DEV_BAND_LABEL).not.toContain("주의"); // 음수 쪽 산식과 어긋났던 옛 문구
  });
});

/**
 * 세션561 가드 — PM10·O3 3년 평균 경계.
 *
 * ## 왜 이 가드가 있나
 * 세션560이 PM2.5 를 3년 평균으로 바꿨을 때 PM10·O3 표는 **옛 실시간 척도 그대로** 남아
 * 셋째 칸이 영구 도달 불가였다(PM10 `{max:150}` vs 실측 max 60.49 / O3 `>0.09` vs 실측
 * max 0.05056). 그런데 **테스트가 한 건도 없어** 그 상태로 머지됐고, 검사관이 읽어서야
 * 발견됐다. 이 가드는 같은 일이 조용히 반복되지 않게 한다.
 *
 * ⚠️ 경계를 옮기려면 이 가드가 먼저 빨개진다 — 그때 위 주석의 실측 근거를 다시 읽을 것.
 */
const airMaxOf = (t: Tier) => t.max ?? Infinity;

describe("PM10·O3 경계는 세션561 실측 결정값이다 (사장님 확정 2026-09-22)", () => {
  it("PM10 경계 = 30 / 36 / 열림", () => {
    expect(AIR_PM10_TIERS.map(airMaxOf).slice(0, 2)).toEqual([30, 36]);
  });

  it("O3 경계 = 0.030 / 0.035 / 열림", () => {
    expect(AIR_O3_TIERS.map(airMaxOf).slice(0, 2)).toEqual([0.03, 0.035]);
  });

  it("두 표 모두 3칸이다 — 2칸이면 '나쁨'이 사라져 변별이 죽는다", () => {
    expect(AIR_PM10_TIERS).toHaveLength(3);
    expect(AIR_O3_TIERS).toHaveLength(3);
  });

  it("죽은 칸이 없다 — 가운데 칸 상한이 실측 최댓값 아래여야 마지막 칸에 닿는다", () => {
    // 이 사고의 본질이자, 이 가드에서 가장 틀리기 쉬운 자리다.
    // ⚠️ `tierMax(60.49, …)` 가 마지막 칸 점수를 돌려주는지 보는 것으로는 **못 잡는다** —
    //    그 검사는 마지막 칸 상한을 150 으로 되돌려도 그대로 통과한다(뮤테이션 실증).
    //    진짜 성질은 "**가운데 칸 상한 < 실측 최댓값**" 이다 — 옛 사고표(PM10 30/80/150)는 가운데가
    //    80 이라 실측 최대 60.49 가 셋째 칸에 영영 못 닿았다. 그 형태를 되살리면 이 가드가 빨개진다.
    const PM10_OBSERVED_MAX = 60.49; // 측정소 650곳 3년 평균 실측 (세션561)
    const O3_OBSERVED_MAX = 0.05056; // 측정소 648곳 3년 평균 실측 (세션561)
    // (1) 가운데 칸 상한 < 실측 최댓값 → 셋째 칸에 실제로 값이 들어온다.
    expect(airMaxOf(AIR_PM10_TIERS[1])).toBeLessThan(PM10_OBSERVED_MAX);
    expect(airMaxOf(AIR_O3_TIERS[1])).toBeLessThan(O3_OBSERVED_MAX);
    // (2) 마지막 칸 상한 >= 실측 최댓값 → 실측 최댓값이 fallback 으로 새지 않는다.
    //     (1)이 죽은 칸을 잡는 본체고, (2)는 반대쪽 구멍(표를 넘어 fallback 으로 흐르는 값)을 막는다.
    expect(airMaxOf(AIR_PM10_TIERS[2])).toBeGreaterThanOrEqual(PM10_OBSERVED_MAX);
    expect(airMaxOf(AIR_O3_TIERS[2])).toBeGreaterThanOrEqual(O3_OBSERVED_MAX);
    // 가운데 칸에도 실측값이 실제로 들어와야 한다(한 칸 몰림 방지).
    expect(tierMax(33, AIR_PM10_TIERS, 0)).toBe(AIR_PM10_TIERS[1].score);
    expect(tierMax(0.0322, AIR_O3_TIERS, AIR_O3_BAD_SCORE)).toBe(AIR_O3_TIERS[1].score);
  });

  it("경계값은 `<=` 라 아래 칸에 속한다 (tierMax 규약)", () => {
    expect(tierMax(30, AIR_PM10_TIERS, 0)).toBe(20);
    expect(tierMax(30.1, AIR_PM10_TIERS, 0)).toBe(14);
    expect(tierMax(0.03, AIR_O3_TIERS, AIR_O3_BAD_SCORE)).toBe(20);
    expect(tierMax(0.0301, AIR_O3_TIERS, AIR_O3_BAD_SCORE)).toBe(14);
  });

  it("중립값은 가운데 칸과 같다 — 자료 없음이 감점이 되면 안 된다", () => {
    // 세션560이 PM2.5 에서 12→14 로 고친 것과 같은 원칙(사장님 확정).
    expect(AIR_PM10_DEFAULT).toBe(AIR_PM10_TIERS[1].score);
    expect(AIR_O3_DEFAULT).toBe(AIR_O3_TIERS[1].score);
  });

  it("세 축의 최고점이 같아야 ENV_MAX 척도가 안 흔들린다", () => {
    // airSc = pm25*0.4 + pm10*0.35 + o3*0.25 의 최댓값이 AIR_QUALITY_TIERS 최대(20)와
    // 같아야 한다. ENV_MAX 가 PM2.5 표에서만 파생되므로, 여기가 어긋나면 자연환경 축
    // 전체가 조용히 이동한다.
    const top = (t: readonly Tier[]) => Math.max(...t.map((x) => x.score));
    const blendMax = top(AIR_QUALITY_TIERS) * 0.4 + top(AIR_PM10_TIERS) * 0.35 + top(AIR_O3_TIERS) * 0.25;
    expect(blendMax).toBe(top(AIR_QUALITY_TIERS));
  });

  it("AIR_O3_BAD_SCORE 는 마지막 칸과 같은 값이다 (둘이 어긋날 여지 제거)", () => {
    expect(AIR_O3_BAD_SCORE).toBe(AIR_O3_TIERS[2].score);
  });
});

/**
 * 세션561 가드 — 손님이 보는 설명은 **표에서 유도**된다.
 *
 * 옛 문구는 `" /PM10"`·`" /O3"` 라는 **빈 이름표**였다. 경계 숫자가 아예 없어서, 손님은
 * 그 축이 어떤 기준으로 매겨졌는지 볼 수 없었다(세션561 발견). PM2.5 만 범례가 있었다.
 * 이 가드는 경계를 옮겼을 때 설명이 따라오지 않으면 빨개진다.
 */
describe("PM10·O3 범례는 등급표에서 유도된다 (세션561)", () => {
  it("범례에 실제 경계 숫자가 들어 있다", () => {
    expect(AIR_PM10_LEGEND).toBe("좋음 30 이하, 보통 36 이하, 나쁨 36 초과");
    expect(AIR_O3_LEGEND).toBe("좋음 0.03 이하, 보통 0.035 이하, 나쁨 0.035 초과");
  });

  it("범례 숫자는 표의 경계와 항상 같다 — 손으로 적은 값이 아니다", () => {
    // 표를 바꾸면 범례도 따라와야 한다. 문자열을 직접 쓰면 이 단언이 깨진다.
    expect(AIR_PM10_LEGEND).toContain(String(AIR_PM10_TIERS[0].max));
    expect(AIR_PM10_LEGEND).toContain(String(AIR_PM10_TIERS[1].max));
    expect(AIR_O3_LEGEND).toContain(String(AIR_O3_TIERS[0].max));
    expect(AIR_O3_LEGEND).toContain(String(AIR_O3_TIERS[1].max));
  });

  it("세 범례가 모두 비어 있지 않다 (빈 이름표 회귀 차단)", () => {
    for (const l of [AIR_ANNUAL_LEGEND, AIR_PM10_LEGEND, AIR_O3_LEGEND]) {
      expect(l.length).toBeGreaterThan(10);
      expect(l).toMatch(/좋음 .+ 이하, 보통 .+ 이하, 나쁨 .+ 초과/);
    }
  });
});

describe("scoreLocation 대기질 문구가 점수와 어긋나지 않는다 (세션561)", () => {
  const natOf = (apt: Record<string, unknown>) => {
    const r = scoreLocation(apt) as unknown as { subs: { name: string; detail: string }[] };
    return r.subs.find((x) => x.name === "자연환경")!.detail;
  };

  it("3년 평균이 있으면 PM10·O3 경계가 문구에 보인다", () => {
    const d = natOf({
      airQuality: { pm25: 15, grade: "보통", annual: { pm25: 17.4, pm10: 33, o3: 0.032 } },
      view: "블루",
      noise: 40,
    });
    expect(d).toContain(`/PM10 ${AIR_PM10_LEGEND}`);
    expect(d).toContain(`/O3 ${AIR_O3_LEGEND}`);
    // 옛 빈 이름표가 되살아나면 빨개진다.
    expect(d).not.toMatch(/\/PM10(?! )/);
  });

  it("3년 평균이 없으면(76곳) 세 축 모두 '미수집(중립 N점)' 으로 **밝힌다**", () => {
    // ⚠️ 세션561 적대검증 🔴 정정: 옛 단언은 "아예 안 쓴다" 였는데 **사실과 달랐다.**
    //    pm10Sc/o3Sc 가 null 이어도 점수에는 중립값이 0.35·0.25 몫으로 **그대로 들어간다**.
    //    쓰면서 안 밝히면 손님은 "그 축은 안 봤다"로 읽는다 — PM2.5 와 같은 문형으로 대칭화했다.
    const d = natOf({ airQuality: { pm25: 15, grade: "보통" }, view: "블루", noise: 40 });
    expect(d).toContain("대기질:미수집");
    expect(d).toContain("/PM10 미수집");
    expect(d).toContain("/O3 미수집");
    // 없는 경계 숫자를 지어내지는 않는다.
    expect(d).not.toContain("/PM10 좋음");
    expect(d).not.toContain("/O3 좋음");
  });
});

/**
 * 세션565 가드 — NOISE_TIERS · CANCEL_RATIO_TIERS · LAND_COST_TIERS 경계 변경.
 *
 * docs/whitepaper/judgments.md "죽은 칸" 절(세션562 전수조사)이 찾은 3개 죽은 칸을
 * 세션565에서 사장님이 "셋 다 고치기"로 결정해 반영했다. 관측값 앵커는 **리터럴**로
 * 적는다(파생 가드는 상수 변경을 못 잡는다 — guards-must-be-mutation-tested §"파생 가드").
 */
describe("NOISE_TIERS 경계는 세션565 실측 결정값이다 (관측값 앵커)", () => {
  // noise 는 실측 소음도가 아니라 10 단위 구간 대표값 — 고유값이 딱 4종뿐이다(세션562 전수조사).
  const OBSERVED_NOISE_VALUES = [40, 50, 60, 70];

  it("경계 = 40 / 50 / 60 / 70 (리터럴 고정 — 되돌리면 red)", () => {
    expect(NOISE_TIERS.map((t) => t.max)).toEqual([40, 50, 60, 70]);
    expect(NOISE_TIERS.map((t) => t.score)).toEqual([30, 22, 15, 8]);
  });

  it("죽은 칸이 없다 — 관측값 4종이 전부 서로 다른 칸에 떨어진다", () => {
    const hitTierIndex = (v: number) => NOISE_TIERS.findIndex((t) => v <= (t.max as number));
    const hits = OBSERVED_NOISE_VALUES.map(hitTierIndex);
    expect(hits).toEqual([0, 1, 2, 3]); // 40→0번 칸 … 70→3번 칸, 겹치는 칸이 없어야 한다
    expect(new Set(hits).size).toBe(NOISE_TIERS.length);
  });

  it("각 관측값이 해당 칸의 점수를 그대로 받는다", () => {
    for (const [i, v] of OBSERVED_NOISE_VALUES.entries()) {
      expect(tierMax(v, NOISE_TIERS, 0)).toBe(NOISE_TIERS[i].score);
    }
  });

  it("50dB 는 40dB 보다 낮은 점수를 받는다 (경계 변경 전 효과 확인, calcCats 경유)", () => {
    const base = { region: "경기", gu: "수원시" };
    const at40 = calcCats({ ...base, noise: 40 } as never).location.subs.find((s) => s.name === "자연환경")!.score;
    const at50 = calcCats({ ...base, noise: 50 } as never).location.subs.find((s) => s.name === "자연환경")!.score;
    expect(at50).toBeLessThan(at40);
  });
});

describe("CANCEL_RATIO_TIERS 경계는 세션565 실측 결정값이다 (분위 재절단, 관측값 앵커)", () => {
  // p25=0.7 · p50=1.2 · p80=1.6 · max=4.4 (세션562 전수조사 실측, 2,457곳)
  const OBSERVED_QUANTILES = { p25: 0.7, p50: 1.2, p80: 1.6, max: 4.4 };

  it("경계 = 0.7 / 1.2 / 1.6 / 5 (리터럴 고정 — 되돌리면 red)", () => {
    expect(CANCEL_RATIO_TIERS.map((t) => t.max)).toEqual([0.7, 1.2, 1.6, 5]);
    expect(CANCEL_RATIO_TIERS.map((t) => t.score)).toEqual([10, 25, 45, 65]);
  });

  it("죽은 칸이 없다 — 분위 관측값 4개가 각자 칸에 들어간다(마지막 칸은 fallback 이 안 잡아야 한다)", () => {
    const { p25, p50, p80, max } = OBSERVED_QUANTILES;
    expect(tierMax(p25, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE)).toBe(CANCEL_RATIO_TIERS[0].score);
    expect(tierMax(p50, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE)).toBe(CANCEL_RATIO_TIERS[1].score);
    expect(tierMax(p80, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE)).toBe(CANCEL_RATIO_TIERS[2].score);
    // 오늘 실측 최댓값(4.4)은 마지막 칸(≤5)에 들어가야 한다 — fallback 으로 새면 안 된다.
    expect(tierMax(max, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE)).toBe(CANCEL_RATIO_TIERS[3].score);
  });

  it("마지막 경계(5)를 넘는 값은 CANCEL_RATIO_HIGH_SCORE 로 떨어진다 (fallback 이 위험 최고점 이상)", () => {
    // scoreRisk.ts 의 tierMax(apt.cancelRatio6m, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE) 와
    // 같은 호출 형태 — fallback 이 마지막 칸(65)보다 낮으면 단조성이 깨진다.
    expect(CANCEL_RATIO_HIGH_SCORE).toBeGreaterThanOrEqual(CANCEL_RATIO_TIERS[CANCEL_RATIO_TIERS.length - 1].score);
    expect(tierMax(999, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE)).toBe(CANCEL_RATIO_HIGH_SCORE);
  });

  it("계약해제율 1.3% 은 0.5% 보다 위험 점수(risk)가 높다 (calcCats 경유, 100-cancelSc 반전 확인)", () => {
    const base = { region: "경기", gu: "수원시" };
    const safe = calcCats({ ...base, cancelRatio6m: 0.5 } as never).risk.subs.find(
      (s) => s.name === "계약해제율"
    )!.score;
    const risky = calcCats({ ...base, cancelRatio6m: 1.3 } as never).risk.subs.find(
      (s) => s.name === "계약해제율"
    )!.score;
    // risk 서브의 score 는 100-cancelSc(위험할수록 낮다) — 1.3%가 0.5%보다 더 위험해야 한다.
    expect(risky).toBeLessThan(safe);
  });
});

describe("LAND_COST_TIERS 경계는 세션565 실측 결정값이다 (관측값 앵커)", () => {
  // 실측 고유값 13종(세션562 전수조사, 2,457곳) — 각 칸에 최소 하나씩 걸려야 한다.
  const OBSERVED_LAND_COST_VALUES = [15, 22, 26, 31, 32, 33, 35, 40, 42, 44, 45, 46, 57];

  it("경계 = min 50 / 40 / 20 (리터럴 고정 — 되돌리면 red)", () => {
    expect(LAND_COST_TIERS.map((t) => t.min)).toEqual([50, 40, 20]);
    expect(LAND_COST_TIERS.map((t) => t.score)).toEqual([80, 60, 40]);
  });

  it("죽은 칸이 없다 — 관측값 13종이 4칸(3표 + fallback) 전부에 최소 하나씩 떨어진다", () => {
    const bucketOf = (v: number): number => {
      const idx = LAND_COST_TIERS.findIndex((t) => v >= (t.min as number));
      return idx === -1 ? LAND_COST_TIERS.length : idx; // fallback 칸은 표 길이 인덱스로 표시
    };
    const buckets = new Set(OBSERVED_LAND_COST_VALUES.map(bucketOf));
    for (let i = 0; i <= LAND_COST_TIERS.length; i++) {
      expect(buckets.has(i), `칸 ${i} 에 떨어지는 관측값이 없다`).toBe(true);
    }
  });

  it("실측 최댓값(57)이 최고점 칸(80점)에 도달한다 — 옛 표(≥60)에서는 0곳이었다", () => {
    expect(tierMin(57, LAND_COST_TIERS, LAND_COST_LOW)).toBe(LAND_COST_TIERS[0].score);
  });

  it("택지비 57% 은 40% 보다 높은 안전 점수를 받는다 (calcCats 경유)", () => {
    const base = { region: "경기", gu: "수원시" };
    const at40 = calcCats({ ...base, landCostRatio: 40 } as never).price.subs.find(
      (s) => s.name === "택지비비율"
    )!.score;
    const at57 = calcCats({ ...base, landCostRatio: 57 } as never).price.subs.find(
      (s) => s.name === "택지비비율"
    )!.score;
    expect(at57).toBeGreaterThan(at40);
  });
});
describe("문구는 경계 숫자를 표에서 읽는다 — 표만 바꾸고 문구를 잊는 사고 방지 (세션565)", () => {
  // 세션565 뮤테이션: 문구를 옛 기준("3% 이하 안전"·"50dB 이하 최고점")으로 되돌려도 시험 2,431개가 전부 초록이었다.
  const base = { region: "경기", gu: "수원시" };

  it("점수 탭 기준 문구(소음·계약해제율)가 표의 첫 경계를 그대로 말한다", () => {
    expect(SUB_CONTEXT.location["자연환경"].benchmark).toContain(`소음은 ${NOISE_TIERS[0].max}dB 이하 최고점`);
    expect(SUB_CONTEXT.risk["계약해제율"].benchmark).toBe(`${CANCEL_RATIO_TIERS[0].max}% 이하 안전`);
  });

  it("계약해제율 설명(detail)이 표의 경계를 그대로 말한다 (calcCats 경유)", () => {
    const d = calcCats({ ...base, cancelRatio6m: 1.3 } as never).risk.subs.find((s) => s.name === "계약해제율")!.detail;
    expect(d).toContain(`안전 ${CANCEL_RATIO_TIERS[0].max}%↓`);
    expect(d).toContain(`위험 ${CANCEL_RATIO_TIERS[3].max}%↑`);
  });

  it("택지비비율 설명(detail)이 표의 경계를 그대로 말한다 (calcCats 경유)", () => {
    const d = calcCats({ ...base, landCostRatio: 57 } as never).price.subs.find((s) => s.name === "택지비비율")!.detail;
    expect(d).toContain(`${LAND_COST_TIERS[0].min}%↑안정`);
    expect(d).toContain(`${LAND_COST_TIERS[2].min}%↓위험`);
  });
});

/**
 * 세션566 가드 — "죽은 칸 없다" 전수조사(23개 `Tier[]` 표) 신규 가드 14종.
 *
 * ## 왜 이 가드가 있나
 * docs/whitepaper/judgments.md "죽은 칸" 절(세션562)이 23개 표 전체를 전수조사했을 때는
 * SCHOOL_WALK_BONUS 하나만 죽은 칸이 있었다(별도 세션이 수정 중). 그런데 그 결과를 **지키는
 * 가드는 없었다** — 경계를 실수로 옮겨도(특히 가운데 칸 상한을 옆 칸 값 쪽으로 밀면) 테스트
 * 전체가 초록인 채 칸이 죽는다. 아래는 각 표마다 **관측값을 리터럴로 못 박아**(파생 가드는
 * 상수 변경을 못 잡는다 — guards-must-be-mutation-tested.md) 그 사고를 잡는다.
 *
 * 값은 2026-09-23 `apartments_flat`(n=2,456) 실측 각 칸의 **최빈값**이다. 경계 상수 자체를
 * 재적는 게 아니라 "그 경계가 실제로 이 관측값을 그 칸에 떨어뜨리는가"를 확인하는 것이므로
 * 표를 조금 조정해도(관측값이 여전히 같은 칸에 속하면) 가드는 통과한다 — 경계를 **옆 칸으로
 * 넘길 만큼** 옮기면 비로소 빨개진다.
 */
describe("죽은 칸 없음 — 거리·개수 계열 표 (세션566, tierMax/tierMin 직접 호출)", () => {
  it("SUBWAY_DIST_TIERS: 관측값 5종이 5칸에 각각 떨어진다", () => {
    const obs = [277, 301, 574, 895, 1217]; // 칸0~4 최빈값
    const expected = SUBWAY_DIST_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, SUBWAY_DIST_TIERS, 0))).toEqual(expected);
    // fallback(1500m 초과)도 표의 점수(0)로 떨어진다 — 표를 넘어선 값이 새 칸으로 오인되지 않는다.
    expect(tierMax(1509, SUBWAY_DIST_TIERS, 0)).toBe(0);
  });

  it("KTX_DIST_TIERS: 관측값 3종 + fallback이 서로 다른 칸에 떨어진다", () => {
    expect(tierMax(2.7, KTX_DIST_TIERS, 0)).toBe(KTX_DIST_TIERS[0].score);
    expect(tierMax(5.1, KTX_DIST_TIERS, 0)).toBe(KTX_DIST_TIERS[1].score);
    expect(tierMax(13.6, KTX_DIST_TIERS, 0)).toBe(KTX_DIST_TIERS[2].score);
    expect(tierMax(16.9, KTX_DIST_TIERS, 0)).toBe(0); // 15km 초과 — fallback
  });

  it("TRANSIT_DIST_TIERS: 관측값 6종 + fallback이 7칸(6표+fallback) 전부에 떨어진다", () => {
    const obs = [0.5, 0.6, 1.3, 1.8, 2.9, 3.5];
    const expected = TRANSIT_DIST_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, TRANSIT_DIST_TIERS, TRANSIT_DIST_FAR_SCORE))).toEqual(expected);
    expect(tierMax(4.2, TRANSIT_DIST_TIERS, TRANSIT_DIST_FAR_SCORE)).toBe(TRANSIT_DIST_FAR_SCORE);
  });

  it("CITY_DIST_TIERS: 관측값 4종 + fallback이 5칸 전부에 떨어진다", () => {
    const obs = [0.5, 0.7, 1.1, 2.1];
    const expected = CITY_DIST_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, CITY_DIST_TIERS, DEV_DIST_FAR_SCORE))).toEqual(expected);
    expect(tierMax(3.4, CITY_DIST_TIERS, DEV_DIST_FAR_SCORE)).toBe(DEV_DIST_FAR_SCORE);
  });

  it("INDUSTRY_DIST_TIERS: 관측값 4종이 4칸 전부에 떨어진다 (fallback 0건 — 마지막 칸이 상한을 덮는다)", () => {
    const obs = [0.6, 1.9, 2.1, 3.5];
    const expected = INDUSTRY_DIST_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, INDUSTRY_DIST_TIERS, DEV_DIST_FAR_SCORE))).toEqual(expected);
  });

  it("POLICE_DIST_TIERS: 관측값 4종이 4칸 전부에 떨어진다 (fallback 0건)", () => {
    const obs = [279, 662, 1431, 2111];
    const expected = POLICE_DIST_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, POLICE_DIST_TIERS, POLICE_DIST_HIGH_SCORE))).toEqual(expected);
  });
});

describe("죽은 칸 없음 — 비율·세대수 계열 표 (세션566, calcCats 경유)", () => {
  const base = { region: "경기", gu: "수원시" };

  it("UNIT_TIERS: 관측값 4종 + fallback이 5칸 전부에 떨어진다 (상품성 '세대수' 서브)", () => {
    const obs = [1622, 1370, 998, 660];
    const expected = UNIT_TIERS.map((t) => t.score);
    const got = obs.map((v) => tierMin(v, UNIT_TIERS, UNIT_SMALL_SCORE));
    expect(got).toEqual(expected);
    expect(tierMin(2, UNIT_TIERS, UNIT_SMALL_SCORE)).toBe(UNIT_SMALL_SCORE);
    // calcCats 경유로도 순위가 뒤집히지 않는다 — 큰 값일수록 세대수 서브 점수가 높다.
    const small = calcCats({ ...base, units: 660 } as never).product.subs.find((s) => s.name === "세대수")!.score;
    const big = calcCats({ ...base, units: 1622 } as never).product.subs.find((s) => s.name === "세대수")!.score;
    expect(big).toBeGreaterThan(small);
  });

  it("PARKING_TIERS: 관측값 3종 + fallback이 4칸 전부에 떨어진다 (상품성 '주차' 서브)", () => {
    const obs = [1.51, 1.31, 1.2];
    const expected = PARKING_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMin(v, PARKING_TIERS, PARKING_LOW_SCORE))).toEqual(expected);
    expect(tierMin(1, PARKING_TIERS, PARKING_LOW_SCORE)).toBe(PARKING_LOW_SCORE);
    const low = calcCats({ ...base, parkingRatio: 1.0 } as never).product.subs.find((s) => s.name === "주차")!.score;
    const high = calcCats({ ...base, parkingRatio: 1.51 } as never).product.subs.find((s) => s.name === "주차")!.score;
    expect(high).toBeGreaterThan(low);
  });

  it("FAR_TIERS: 관측값 2종 + fallback이 3칸 전부에 떨어진다 (상품성 '용적률' 서브 — 낮을수록 높은 점수)", () => {
    const obs = [199, 249];
    const expected = FAR_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, FAR_TIERS, FAR_HIGH_SCORE))).toEqual(expected);
    expect(tierMax(299, FAR_TIERS, FAR_HIGH_SCORE)).toBe(FAR_HIGH_SCORE);
    const low = calcCats({ ...base, floorAreaRatio: 199 } as never).product.subs.find(
      (s) => s.name === "용적률"
    )!.score;
    const high = calcCats({ ...base, floorAreaRatio: 299 } as never).product.subs.find(
      (s) => s.name === "용적률"
    )!.score;
    expect(low).toBeGreaterThan(high);
  });

  it("EXCL_RATIO_TIERS: 관측값 3종 + fallback이 4칸 전부에 떨어진다 (상품성 '전용률' 서브)", () => {
    const obs = [81, 77, 76];
    const expected = EXCL_RATIO_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMin(v, EXCL_RATIO_TIERS, EXCL_LOW_SCORE))).toEqual(expected);
    expect(tierMin(73, EXCL_RATIO_TIERS, EXCL_LOW_SCORE)).toBe(EXCL_LOW_SCORE);
    const low = calcCats({ ...base, exclusiveRatio: 73 } as never).product.subs.find((s) => s.name === "전용률")!.score;
    const high = calcCats({ ...base, exclusiveRatio: 81 } as never).product.subs.find(
      (s) => s.name === "전용률"
    )!.score;
    expect(high).toBeGreaterThan(low);
  });

  it("FLOOR_TIERS: 관측값 3종 + fallback이 4칸 전부에 떨어진다 (상품성 '구조' 서브)", () => {
    const obs = [35, 25, 15];
    const expected = FLOOR_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMin(v, FLOOR_TIERS, FLOOR_LOW_SCORE))).toEqual(expected);
    expect(tierMin(14, FLOOR_TIERS, FLOOR_LOW_SCORE)).toBe(FLOOR_LOW_SCORE);
    const low = calcCats({ ...base, maxFloor: 14 } as never).product.subs.find((s) => s.name === "구조")!.score;
    const high = calcCats({ ...base, maxFloor: 35 } as never).product.subs.find((s) => s.name === "구조")!.score;
    expect(high).toBeGreaterThan(low);
  });

  it("UNSOLD_RATE_TIERS: 관측값 4종 + fallback이 5칸 전부에 떨어진다 (안전도 '미분양률' 서브 — 위험 반전)", () => {
    const obs = [0.4, 6.3, 25, 50];
    const expected = UNSOLD_RATE_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE))).toEqual(expected);
    expect(tierMax(100, UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE)).toBe(UNSOLD_HIGH_SCORE);
    // units>1 이어야 tierMax 가 실제로 불린다(units<=1은 UNSOLD_UNKNOWN_SCORE 로 분기).
    const safe = calcCats({ ...base, units: 500, unsoldRate: 0.4 } as never).risk.subs.find(
      (s) => s.name === "미분양률"
    )!.score;
    const risky = calcCats({ ...base, units: 500, unsoldRate: 50 } as never).risk.subs.find(
      (s) => s.name === "미분양률"
    )!.score;
    // risk 서브 score 는 100-위험점수(값이 클수록 안전) — 미분양률 50%가 0.4%보다 덜 안전해야 한다.
    expect(risky).toBeLessThan(safe);
  });

  it("LIQUIDITY_TIERS: 관측값 3종 + fallback이 4칸 전부에 떨어진다 (안전도 '거래량' 서브)", () => {
    const obs = [4094, 1780, 1506];
    const expected = LIQUIDITY_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMin(v, LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE))).toEqual(expected);
    expect(tierMin(676, LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE)).toBe(LIQUIDITY_LOW_SCORE);
    const low = calcCats({ ...base, recentTrades6m: 676 } as never).risk.subs.find((s) => s.name === "거래량")!.score;
    const high = calcCats({ ...base, recentTrades6m: 4094 } as never).risk.subs.find((s) => s.name === "거래량")!.score;
    // risk 서브 score 는 100-위험점수 — 거래가 많을수록(유동성 높을수록) 더 안전해야 한다.
    expect(high).toBeGreaterThan(low);
  });

  it("HOUSING_SUPPLY_LEVEL_TIERS: 관측값 3종 + fallback이 4칸 전부에 떨어진다 (안전도 '공급량' 서브)", () => {
    const obs = [93.9, 99.4, 102.5];
    const expected = HOUSING_SUPPLY_LEVEL_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_SCORE))).toEqual(expected);
    expect(tierMax(112.4, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_SCORE)).toBe(HOUSING_SUPPLY_HIGH_SCORE);
    const low = calcCats({ ...base, housingSupplyLevel: 93.9 } as never).risk.subs.find(
      (s) => s.name === "공급량"
    )!.score;
    const high = calcCats({ ...base, housingSupplyLevel: 112.4 } as never).risk.subs.find(
      (s) => s.name === "공급량"
    )!.score;
    // risk 서브 score 는 100-위험점수 — 보급률이 높을수록(주택이 남을수록) 미분양 위험이 커
    // 안전 점수는 낮아야 한다.
    expect(low).toBeGreaterThan(high);
  });

  it("INIT_SALE_TIERS: 관측값 4종 + fallback이 5칸 전부에 떨어진다 (안전도 '초기분양률' 서브)", () => {
    const obs = [100, 80.8, 55.7, 48.2];
    const expected = INIT_SALE_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMin(v, INIT_SALE_TIERS, INIT_SALE_HIGH_RISK))).toEqual(expected);
    expect(tierMin(17.2, INIT_SALE_TIERS, INIT_SALE_HIGH_RISK)).toBe(INIT_SALE_HIGH_RISK);
    const risky = calcCats({ ...base, initialSaleRate: 17.2 } as never).risk.subs.find(
      (s) => s.name === "초기분양률"
    )!.score;
    const safe = calcCats({ ...base, initialSaleRate: 100 } as never).risk.subs.find(
      (s) => s.name === "초기분양률"
    )!.score;
    // risk 서브 score 는 100-위험점수 — 초기분양률이 낮을수록 더 위험해 안전 점수가 낮아야 한다.
    expect(safe).toBeGreaterThan(risky);
  });
});

describe("죽은 칸 없음 — AIR_QUALITY_TIERS(PM2.5) (세션566, calcCats 경유)", () => {
  it("관측값 3종이 3칸 전부에 떨어진다 (자연환경 서브, airQuality.annual.pm25 경유)", () => {
    const obs = [14.6, 18.63, 20.74];
    const expected = AIR_QUALITY_TIERS.map((t) => t.score);
    expect(obs.map((v) => tierMax(v, AIR_QUALITY_TIERS, 0))).toEqual(expected);
  });

  it("좋음(14.6)이 나쁨(20.74)보다 자연환경 점수가 높다 (calcCats 경유)", () => {
    const base = { region: "경기", gu: "수원시" };
    const good = calcCats({
      ...base,
      airQuality: { pm25: 14.6, grade: "보통", annual: { pm25: 14.6, pm10: 30, o3: 0.03 } },
    } as never).location.subs.find((s) => s.name === "자연환경")!.score;
    const bad = calcCats({
      ...base,
      airQuality: { pm25: 20.74, grade: "보통", annual: { pm25: 20.74, pm10: 30, o3: 0.03 } },
    } as never).location.subs.find((s) => s.name === "자연환경")!.score;
    expect(good).toBeGreaterThan(bad);
  });
});
