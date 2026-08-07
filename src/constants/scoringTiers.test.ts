import { describe, it, expect } from "vitest";
import {
  tierMax,
  tierMaxLabel,
  IC_DIST_TIERS,
  IC_DIST_FALLBACK_LABEL,
  KTX_DIST_TIERS,
  KTX_DIST_FALLBACK_LABEL,
  type Tier,
} from "./scoringTiers";
import { scoreLocation } from "@/scoring/scoreLocation";

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
