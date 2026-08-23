import {
  tierMax,
  TRANSIT_OPEN,
  TRANSIT_CERTAINTY,
  TRANSIT_CERTAINTY_DEFAULT,
  TRANSIT_DIST_TIERS,
  TRANSIT_DIST_FAR_SCORE,
  TRANSIT_GRADE,
  TRANSIT_GRADE_DEFAULT,
  TRANSIT_LINE_TYPE,
  TRANSIT_DEV_PATTERN,
  CITY_DEV_PATTERN,
  CITY_DIST_TIERS,
  INDUSTRY_DEV_PATTERN,
  INDUSTRY_DIST_TIERS,
  DEV_DIST_FAR_SCORE,
  FUTURE_WEIGHTS,
  FUTURE_RAW_MAX,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

// --- 세션511: 키워드 부분매칭 전면 폐기 ---
//
// 옛 산식은 세 축을 전부 **이름 문자열 키워드**로 훑었다. 그 결과:
//   - 교통: 키워드 20개 중 **14개가 어떤 문자열에도 안 닿는 죽은 값**이었고, 만점(100)이
//           도달 불가능한 가지에 걸려 5개월간 아무도 못 받았다.
//   - 도시: 거리를 아예 안 봐서 값 보유 111곳이 **전부 80점**.
//   - 산업: 값 보유 239곳 중 **206곳이 같은 35점**.
//
// 이제 세 축 모두 수집기가 만든 문자열을 **파싱**해 표(`scoringTiers.ts`)에서 등급을 찾는다.
// 형식이 안 맞으면 0점 — "무슨 호재인지 모르는데 점수는 있다"를 만들지 않는다.
// ⚠️ 수집기 출력 형식과 `*_DEV_PATTERN` 은 **한 쌍**이다. 한쪽만 바꾸면 점수가 조용히 0이 된다.

/**
 * 미래가치 점수 (0~100). 4축(인구·교통·도시·산업) **고정 가중치** 합산 후 0~100 정규화.
 *
 * 세션511에 동적 재분배를 폐기했다. 옛 구조는 호재가 없으면 그 몫을 100% 인구로 보내서
 * **호재를 가진 단지가 구조적으로 손해**를 봤다(보유 762곳 중 486곳이 그 호재를 지웠을 때보다 낮음,
 * corr(총점, 교통서브) = −0.097). 고정 가중치에서는 각 항이 비음수 가산이라 **채우면 오르기만 한다.**
 *
 * 가중치 = `FUTURE_WEIGHTS` (pop .55 · tr .225 · city .135 · ind .09, 호재 몫 0.45).
 * 0.45 는 실측으로 고른 값 — 0.35 면 인구 설명력 85.0%(현행 75.7%보다 악화), 0.45 면 70.1%.
 *
 * 핵심 산식:
 *   - trSc: `"{노선} {역}역 {상태}"` 파싱 → 확실성(공사중·착공 40 / 추진 22) + 근접(≤0.5km 40 …
 *           4km↑ 0) + 노선급(GTX 20 / 도시철도 15 / 지하철연장 12 / 경전철 8 / 트램 6). 합 최대 100.
 *           **개통(TRANSIT_OPEN)은 0** — 입지 축이 같은 역을 이미 센다(이중 계상 차단).
 *           형식 불일치도 0 — "무슨 호재인지 모르는데 점수는 있다"를 만들지 않는다.
 *   - citySc: `"{지구명} {거리}km"` 파싱 → 개발지구(LH 사업지구 + 지구단위)까지 500m 100 / 1km 70 / 2km 40 / 3km 20 / 그 밖 0.
 *   - indSc: `"{단지명} {거리}km"` 파싱 → 산업단지까지 1km 100 / 2km 75 / 3km 50 / 5km 25 / 그 밖 0.
 *           ⚠️ 두 표가 다른 이유 = 스케일이 다르다. 최근접 중앙이 LH 1.03km vs 산업 3.28km 라
 *           같은 표를 쓰면 한쪽이 죽는다(2,696단지 실측).
 *   - popSc 7단계: null 35 / ≥1.0 95 / ≥0.5 80 / ≥0 65 / ≥-0.3 50 / ≥-0.8 35 / ≥-2.0 20 / 그 외 10.
 *   - netMigration 보정: > 0 → popSc + 10 (상한 100), ≤ -5000 → popSc - 5 (하한 0).
 *
 * 정규화: `raw / FUTURE_RAW_MAX * 100`. 네 축이 전부 0~100 이 된 지금은 `FUTURE_RAW_MAX = 100`
 * 이라 항등이지만, 축 상한이 바뀌면 자동으로 따라간다(손으로 적은 수를 안 쓴다).
 *
 * @example
 * // 호재를 채우면 절대 내려가지 않는다 (단조성 — 정의로 보장)
 * scoreFuture(apt).total >= scoreFuture({ ...apt, transitDev: null, cityDev: null, industryDev: null }).total
 */
export function scoreFuture(apt: Apt): Res {
  const transitDev = (apt.transitDev ?? "") as string;
  const cityDev = (apt.cityDev ?? "") as string;
  const devDist = (apt.devDist ?? 99) as number;

  // 교통개발 — 확실성 + 근접 + 노선급 가산 (합 최대 100, 세션511)
  //
  // `transit_dev` 는 `transit-match.mjs` 가 만든 `"{노선} {역}역 {상태}"` 문자열이다.
  // 노선 종류가 문자열에 없어서 노선명으로 되찾는다(TRANSIT_LINE_TYPE).
  // 형식이 안 맞으면 0 — 억지로 부분 점수를 주면 "무슨 호재인지 모르는데 점수는 있다"가 된다.
  const trMatch = transitDev && transitDev !== "없음" ? transitDev.trim().match(TRANSIT_DEV_PATTERN) : null;
  const trStatus = trMatch?.[2] ?? "";
  const trSc =
    !trMatch || TRANSIT_OPEN.includes(trStatus) // 개통은 입지 축이 이미 셈 — 이중 계상 차단
      ? 0
      : (TRANSIT_CERTAINTY[trStatus] ?? TRANSIT_CERTAINTY_DEFAULT) +
        tierMax(devDist, TRANSIT_DIST_TIERS, TRANSIT_DIST_FAR_SCORE) +
        (TRANSIT_GRADE[TRANSIT_LINE_TYPE[trMatch[1]] ?? ""] ?? TRANSIT_GRADE_DEFAULT);

  // 도시개발 — 개발지구까지 거리 등급 (세션511; 세션520에 지구단위 합류)
  // 옛 산식은 이름 키워드만 봐서 값 보유 111곳이 **전부 80점**이었다(거리를 아예 안 봄).
  // 출처는 LH 사업지구(V-WORLD)에 네이버 지구단위가 더해진 것이라 "LH" 로 못 박아 말하지 않는다.
  const cityMatch = cityDev ? cityDev.trim().match(CITY_DEV_PATTERN) : null;
  const citySc = cityMatch ? tierMax(parseFloat(cityMatch[2]), CITY_DIST_TIERS, DEV_DIST_FAR_SCORE) : 0;

  // 인구 (기본 30%) — 한국 현실 기반 7단계
  let popSc =
    apt.popGrowth == null
      ? 35
      : apt.popGrowth >= 1.0
        ? 95
        : apt.popGrowth >= 0.5
          ? 80
          : apt.popGrowth >= 0
            ? 65
            : apt.popGrowth >= -0.3
              ? 50
              : apt.popGrowth >= -0.8
                ? 35
                : apt.popGrowth >= -2.0
                  ? 20
                  : 10;
  if (apt.netMigration != null && apt.netMigration > 0) popSc = Math.min(popSc + 10, 100);
  if (apt.netMigration != null && apt.netMigration <= -5000) popSc = Math.max(popSc - 5, 0);

  // 산업개발 — 산업단지까지 거리 등급 (세션511)
  // 옛 산식은 이름 키워드만 봐서 값 보유 239곳 중 **206곳이 같은 35점**이었다.
  // ⚠️ 산업단지는 LH 지구보다 드물어(최근접 중앙 3.28km vs 1.03km) **등급표가 다르다.**
  const indDev = apt.industryDev as string | string[] | undefined;
  const indStr = Array.isArray(indDev) ? (indDev[0] ?? "") : String(indDev ?? "");
  const indMatch = indStr ? indStr.trim().match(INDUSTRY_DEV_PATTERN) : null;
  const indSc = indMatch ? tierMax(parseFloat(indMatch[2]), INDUSTRY_DIST_TIERS, DEV_DIST_FAR_SCORE) : 0;

  // 고정 가중치 + 0~100 정규화 (세션511 — 동적 재분배 폐기)
  //
  // 옛 동적 재분배는 호재가 없으면 그 몫을 100% 인구로 보냈다. 인구는 실측 중앙 75인데 교통 상한은
  // 72라, **호재를 가진 단지가 구조적으로 손해**를 봤다(보유 762곳 중 486곳 역전).
  // 고정 가중치에서는 각 항이 비음수 가산이라 채우면 오르기만 한다 — 실측이 아니라 정의로 보장된다.
  //
  // 정규화는 축 상한이 100 이 아닐 때를 대비한 안전장치다. 지금은 네 축이 전부 0~100 이라
  // FUTURE_RAW_MAX = 100 이고 이 나눗셈은 항등이지만, 축 상한이 바뀌면 자동으로 따라간다.
  const raw =
    popSc * FUTURE_WEIGHTS.pop + trSc * FUTURE_WEIGHTS.tr + citySc * FUTURE_WEIGHTS.city + indSc * FUTURE_WEIGHTS.ind;
  const total = (raw / FUTURE_RAW_MAX) * 100;
  const pg = apt.popGrowth;
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))),
    subs: [
      {
        name: "교통개발",
        score: Math.round(trSc),
        info: transitDev || "없음",
        // 문구는 점수표에서 뽑는다 — 숫자를 박으면 표만 바뀌었을 때 "0점인데 만점 설명"이 남는다
        // (세션499 등급 문구 사고와 같은 자리).
        detail: !trMatch
          ? "교통개발 없음 (0점)"
          : TRANSIT_OPEN.includes(trStatus)
            ? `${transitDev} — 이미 개통해 입지 점수(지하철 거리)에 반영됩니다 (미래가치 0점)`
            : `${transitDev} · ${devDist}km — 확실성 ${TRANSIT_CERTAINTY[trStatus] ?? TRANSIT_CERTAINTY_DEFAULT}점` +
              ` + 거리 ${tierMax(devDist, TRANSIT_DIST_TIERS, TRANSIT_DIST_FAR_SCORE)}점` +
              ` + ${TRANSIT_LINE_TYPE[trMatch[1]] ?? "기타"} ${TRANSIT_GRADE[TRANSIT_LINE_TYPE[trMatch[1]] ?? ""] ?? TRANSIT_GRADE_DEFAULT}점`,
      },
      {
        name: "도시개발",
        score: Math.round(citySc),
        info: cityDev || "없음",
        detail: cityMatch
          ? `${cityDev} — 개발지구까지 ${cityMatch[2]}km (500m내 100점 · 1km 70 · 2km 40 · 3km 20 · 그 밖 0)`
          : "반경 5km 안에 개발지구 없음 (0점)",
      },
      {
        name: "인구",
        score: Math.round(popSc),
        info: pg != null ? `${pg > 0 ? "+" : ""}${pg}%` : "정보 없음",
        detail:
          pg != null
            ? `${pg > 0 ? "+" : ""}${pg}% (성장 +1%↑=95점, 안정 0%↑=65점, 감소 -2%↓=10점)`
            : "데이터 없음 (기본 35점)",
      },
      {
        name: "산업개발",
        score: Math.round(indSc),
        // 값이 있으면 그대로 보여준다 — 점수가 0이라고 "없음"이라 쓰면 거짓이 된다
        // (세션510: "427곳이 값을 갖고도 '없음' 표시" 와 같은 자리)
        info: indStr || "없음",
        // 산업단지는 LH 지구보다 드물어(최근접 중앙 3.28km) 등급 간격이 넓다
        detail: indMatch
          ? `${indStr} — 산업단지까지 ${indMatch[2]}km (1km내 100점 · 2km 75 · 3km 50 · 5km 25 · 그 밖 0)`
          : "반경 5km 안에 산업단지 없음 (0점)",
      },
    ],
  };
}
