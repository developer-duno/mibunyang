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
  FUTURE_WEIGHTS,
  FUTURE_RAW_MAX,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

// --- scoreFuture 키워드 배열 (Clean-3, src/scoring/CLAUDE.md L101~L113) ---
// ⚠️ 교통 키워드 3종(TRANSIT_ACTIVE/PLANNED/HIGH)은 세션511에 폐기됐다 — 상태·노선급을 문자열
//    부분매칭으로 추측하는 대신 `TRANSIT_DEV_PATTERN` 으로 파싱해 표에서 찾는다(scoringTiers.ts).
//    옛 배열은 20개 키워드 중 14개가 어떤 문자열에도 안 닿는 죽은 값이었다.
/** 고가치 도시개발. citySc 80. `includes()` 부분 매칭 주의: "신도" → "신도시"+"신도심" 모두 매칭. */
const CITY_HIGH = [
  "테크노",
  "주거타운",
  "신도시",
  "신도심",
  "복합도시",
  "재건축",
  "혁신",
  "스마트시티",
  "자족도시",
  "행정중심",
  "경제자유구역",
  "국가산단",
];
/** 중가치 도시개발. citySc 50. 미매칭 시 30. */
const CITY_MID = [
  "재생",
  "리모델링",
  "관광",
  "산업단지",
  "공항",
  "특구",
  "메디컬",
  "역세권개발",
  "도시정비",
  "택지개발",
  "물류단지",
  "연구단지",
];
/** `keywords.some(k => str.includes(k))` 부분 매칭. str=null 호출 금지(상위에서 가드). */
const matchAny = (str: string, keywords: string[]): boolean => keywords.some((k) => str.includes(k));

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
 *   - citySc: CITY_HIGH 80 / CITY_MID 50 / 기타 30. cityDev 빈 값 → 0.
 *   - popSc 7단계: null 35 / ≥1.0 95 / ≥0.5 80 / ≥0 65 / ≥-0.3 50 / ≥-0.8 35 / ≥-2.0 20 / 그 외 10.
 *   - netMigration 보정: > 0 → popSc + 10 (상한 100), ≤ -5000 → popSc - 5 (하한 0).
 *   - indSc: industryDev (배열/문자열 모두 허용) → CITY_HIGH 80 / CITY_MID 55 / 기타 35.
 *
 * 정규화: `raw / FUTURE_RAW_MAX * 100`. 도시·산업 최고 등급이 80이라 raw 는 95.5 를 못 넘는데,
 * 그대로 두면 다른 카테고리(0~100)와 눈금이 어긋난다. 나누기는 단조라 **순위를 안 바꾼다.**
 *
 * `includes()` 부분 매칭 함정: "신도" 키워드 → "신도시"+"신도심" 모두 매칭됨(도시·산업축 한정).
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

  // 도시개발 (기본 30%)
  const citySc =
    !cityDev || cityDev === "" ? 0 : matchAny(cityDev, CITY_HIGH) ? 80 : matchAny(cityDev, CITY_MID) ? 50 : 30;

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

  // 산업개발 (4번째 축)
  const indDev = apt.industryDev as string | string[] | undefined;
  const hasInd = !!indDev && (Array.isArray(indDev) ? indDev.length > 0 : String(indDev).trim().length > 0);
  let indSc = 0;
  if (hasInd) {
    const indStr = Array.isArray(indDev) ? indDev.join(" ") : String(indDev);
    indSc = matchAny(indStr, CITY_HIGH) ? 80 : matchAny(indStr, CITY_MID) ? 55 : 35;
  }

  // 고정 가중치 + 0~100 정규화 (세션511 — 동적 재분배 폐기)
  //
  // 옛 동적 재분배는 호재가 없으면 그 몫을 100% 인구로 보냈다. 인구는 실측 중앙 75인데 교통 상한은
  // 72라, **호재를 가진 단지가 구조적으로 손해**를 봤다(보유 762곳 중 486곳 역전).
  // 고정 가중치에서는 각 항이 비음수 가산이라 채우면 오르기만 한다 — 실측이 아니라 정의로 보장된다.
  //
  // 정규화가 필요한 이유: 도시·산업 축의 최고 등급이 80이라 raw 총점은 95.5 를 못 넘는다.
  // 그대로 두면 다른 카테고리(전부 0~100)와 눈금이 어긋난다. 나누기는 단조라 순위는 안 바뀐다.
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
        detail: cityDev ? `${cityDev} (신도시/테크노 80점, 재생/특구 50점, 기타 30점)` : "도시개발 없음 (0점)",
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
        info: hasInd ? (Array.isArray(indDev) ? indDev.join(", ") : String(indDev)) : "없음",
        detail: hasInd
          ? `${Array.isArray(indDev) ? indDev.join(", ") : String(indDev)} (국가산단 80점, 산업단지 55점, 기타 35점)`
          : "산업개발 없음 (0점)",
      },
    ],
  };
}
