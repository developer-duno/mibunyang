// @ts-check
/**
 * 미분양 「상태」 판정과 그 상태를 손님 말로 옮기는 문구표 — 단일 출처 (세션689 PR-3 · 설계서
 * `docs/superpowers/plans/2026-11-01-govlist-unsold-source.md` §2·§6 · 👤 Q3·Q4·Q7·Q8 · 11/04 막대 「비공개」).
 *
 * 왜 한 파일인가 — 같은 단지의 미분양을 카드 칩·상세 「미분양 세대」·편차 막대 끝 글자·점수 탭 detail·정적 장·허브 줄이
 * 각자 말한다. 자리마다 손으로 적으면 칩은 「비공개」, 정적 장은 「미분양 —」처럼 서로 다른 말을 하게 된다
 * (.claude/rules/meta/score-meaning-and-wording-are-a-pair.md 「밴드를 쓰는 자리는 하나가 아니다」).
 * 화면(.ts·.tsx)과 node 빌드 스크립트(`scripts/postbuild-prerender.mjs`)가 같이 읽어야 해서 `.mjs` 로 둔다
 * (`.vercelignore` 는 `src/**\/*.mjs` 를 통과시킨다 — aptStaticBody.mjs·nearbyComplexes.mjs 와 같은 자리).
 *
 * 판정은 VIEW `apartments_flat` 이 준 칸만 본다 — `unsoldListedHidden`·`unsoldSource`·`unsoldListedAsOf`
 * (마이그 `20261102000002_view_unsold_govlist.sql`). 칸이 없거나(운영 DB 적용 전·옛 JSON) 거짓이면
 * 모든 함수가 **지금 화면과 같은 값**을 낸다.
 */

/**
 * 명단을 내는 기관 — 시도 짧은 이름(`apt.region`) → 기관 이름(목업 그대로).
 * 여기에 없는 시도는 기관을 적지 않는다(칩·상세 모두 「미분양 수 비공개」·「비공개」만 — 지어내지 않는다).
 * @type {Readonly<Record<string, string>>}
 */
export const UNSOLD_LIST_AGENCY = Object.freeze({ 대구: "대구시", 충남: "충남도" });

/**
 * @typedef {Record<string, any> | null | undefined} AptLike
 * @typedef {"hidden" | "listedZero" | "unknown"} UnsoldState
 * @typedef {{ agency: string | null, year: number | null, month: number | null }} UnsoldListSource
 */

/** 지자체 명단에 올라 있으나 수는 비공개인가 — VIEW 가 참이라고 한 것만(칸 없음·false·문자열 "true" 는 아님). @param {AptLike} a */
export function isUnsoldListedHidden(a) {
  return a?.unsoldListedHidden === true;
}

/**
 * 「미분양 있음」으로 세는가 — 「미분양만 보기」(기본 목록)·필터 개수 배지·시장 요약 모집단·허브 정렬·허브 제목
 * 「미분양 남음 N곳」이 모두 이 한 함수를 부른다(👤 Q8 「미분양 있음으로 셈」).
 * `scripts/govlist-screen-impact.mjs` `unsoldFilterPr3` 와 같은 규칙(unsoldState.test.js 가 맞댄다).
 * @param {AptLike} a
 */
export function countsAsUnsold(a) {
  return Number(a?.unsold ?? 0) > 0 || isUnsoldListedHidden(a);
}

/**
 * 문구표가 다루는 상태 — 숫자(1 이상)는 표 밖(기존 「N세대」·「N%」 그대로).
 *   hidden     명단 등재 · 수 비공개(VIEW `unsoldListedHidden`)
 *   listedZero 출처가 명단(`unsoldSource === "govlist"`)인 0 — 「명단 미등재」(PR-4 `--absent-zero` 뒤에만 생긴다)
 *   unknown    그 밖의 0·모름(지금 화면의 「—」)
 * @param {AptLike} a @returns {UnsoldState | null} 숫자(1 이상)면 null
 */
export function unsoldStateOf(a) {
  if (isUnsoldListedHidden(a)) return "hidden";
  const v = a?.unsold;
  if (v != null && Number(v) > 0) return null;
  if (v != null && Number(v) === 0 && a?.unsoldSource === "govlist") return "listedZero";
  return "unknown";
}

/**
 * 명단 기관·기준 연월 — 연월은 `unsoldListedAsOf`(DATE `YYYY-MM-DD`)를 글자로만 자른다(`new Date` 에 넘기지 않는다 —
 * .claude/rules/meta/probe-must-be-self-verified.md §5). 꼴이 어긋나거나 월이 1~12 밖이면 연월 없음.
 * @param {AptLike} a @returns {UnsoldListSource}
 */
export function unsoldListSource(a) {
  const region = typeof a?.region === "string" ? a.region.trim().normalize("NFC") : "";
  const agency = Object.prototype.hasOwnProperty.call(UNSOLD_LIST_AGENCY, region) ? UNSOLD_LIST_AGENCY[region] : null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(typeof a?.unsoldListedAsOf === "string" ? a.unsoldListedAsOf : "");
  const month = m ? Number(m[2]) : NaN;
  if (!m || !(month >= 1 && month <= 12)) return { agency, year: null, month: null };
  return { agency, year: Number(m[1]), month };
}

/** 「대구시 9월」 — 칩용(연도 없음). 기관이 없으면 null(기관 없이 달만 적지 않는다). @param {UnsoldListSource} s */
function shortList(s) {
  if (!s.agency) return null;
  return s.month != null ? `${s.agency} ${s.month}월` : s.agency;
}

/** 「대구시 2026년 9월말」 — 상세·정적 장·점수 detail 용. @param {UnsoldListSource} s */
function longList(s) {
  if (!s.agency) return null;
  return s.year != null && s.month != null ? `${s.agency} ${s.year}년 ${s.month}월말` : s.agency;
}

/** 「대구시 2026-09」 — 미등재 꼬리(설계서 §2 글자 그대로). @param {UnsoldListSource} s */
function dashList(s) {
  if (!s.agency) return null;
  return s.year != null && s.month != null ? `${s.agency} ${s.year}-${String(s.month).padStart(2, "0")}` : s.agency;
}

/**
 * @typedef {(s: UnsoldListSource) => string} LabelFn
 * @typedef {{ chip: LabelFn | null, field: LabelFn, hub: LabelFn, scoreInfo: LabelFn | null, scoreDetail: LabelFn | null, admin: LabelFn }} UnsoldStateLabels
 */

/**
 * 상태 3 × 자리 문구표. 자리:
 *   chip        카드 칩(`src/constants/cardChips.ts`) — null 이면 칩 없음
 *   field       상세 「미분양 세대」 값(`FIELD_META.unsold.fmt`) · 정적 장 기본 정보 줄의 「미분양 …」 꼬리(`aptStaticBody.mjs`)
 *   hub         지역 허브 단지 줄(`postbuild-prerender.mjs` hubUnsoldText)
 *   scoreInfo   점수 탭 미분양률 info(`scoreRisk.ts`) — null 이면 기존 숫자 경로(listedZero = 0%)
 *   scoreDetail 점수 탭 미분양률 detail(`scoreRisk.ts`) — 점수는 그대로 「모름 40」(👤 Q3)
 *   admin       관리자 점수 분해표의 「미분양 상태」 한 줄
 * 편차 막대 끝 글자(「비공개」)는 막대 줄의 말(「미수집」 자리)이라 `UNSOLD_DEVIATION_HIDDEN_TEXT` 로 따로 둔다.
 * @type {Readonly<Record<UnsoldState, UnsoldStateLabels>>}
 */
export const UNSOLD_STATE_LABEL = Object.freeze({
  hidden: {
    chip: (s) => `미분양 수 비공개${shortList(s) ? ` · ${shortList(s)} 명단` : ""}`,
    field: (s) => `비공개${longList(s) ? ` (${longList(s)} 명단)` : ""}`,
    hub: (s) => `미분양 ${UNSOLD_STATE_LABEL.hidden.field(s)}`,
    scoreInfo: () => "미분양 수 비공개 (중립)",
    scoreDetail: (s) => `미분양 수 비공개${longList(s) ? ` · ${longList(s)} 명단` : ""} (중립 40점)`,
    admin: (s) => `명단 등재 · 수 비공개${longList(s) ? ` (${longList(s)} 명단)` : ""}`,
  },
  listedZero: {
    chip: null,
    field: (s) => `0 (${dashList(s) ? `${dashList(s)} ` : ""}명단 미등재)`,
    hub: (s) => `미분양 ${UNSOLD_STATE_LABEL.listedZero.field(s)}`,
    scoreInfo: null,
    scoreDetail: null,
    admin: (s) => `명단 미등재 0${dashList(s) ? ` (${dashList(s)} 명단)` : ""}`,
  },
  unknown: {
    chip: null,
    field: () => "—",
    hub: () => "미분양 —",
    scoreInfo: () => "미분양 자료 없음 (중립)",
    scoreDetail: () => "미분양 자료 없음 (중립 40점)",
    admin: () => "모름",
  },
});

/** 편차 막대 「미분양」 줄 끝 글자 — 비공개 등재면 「미수집」 대신(👤 11/04 「'비공개'로」). */
export const UNSOLD_DEVIATION_HIDDEN_TEXT = "비공개";

/**
 * 상세 「미분양 세대」 값 — 정적 장(`aptStaticBody.mjs` unsoldFieldText)이 이 함수를 부른다. 화면 상세 `FIELD_META.unsold.fmt`
 * (`fieldMeta.ts` unsold.fmt)는 같은 판정·문구표를 따로 쓰는 쌍둥이라 두 글자가 같은지는 `aptStaticBody.test.jsx`(unsoldFieldText ↔ fmt)가 지킨다.
 * 숫자(1 이상)는 기존 꼴 `N세대`(천 단위 쉼표), 그 밖은 문구표.
 * @param {unknown} v @param {AptLike} [a]
 */
export function unsoldFieldLabel(v, a) {
  const st = unsoldStateOf({ ...(a ?? {}), unsold: v });
  if (st == null) return `${Number(v).toLocaleString("ko-KR")}세대`;
  return UNSOLD_STATE_LABEL[st].field(unsoldListSource(a));
}
