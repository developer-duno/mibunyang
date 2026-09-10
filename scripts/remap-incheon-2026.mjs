// @ts-check
/**
 * 인천 2026-07-01 개편에 따른 **저장 데이터 재정합** — 세션546 PR-F2 §2.
 *
 * ## 왜 좌표로 다시 묻나
 *
 * 전남광주(세션545)는 옛 시군구 하나가 새 코드 하나로 **이름을 바꾼** 것이라 5자리 대응표를
 * 만들 수 있었다. 인천은 다르다 — **중구·동구 → 제물포구·영종구**, **서구 → 서해구·검단구** 로
 * 옛 구를 **쪼갰다**. 어느 단지가 제물포인지 영종인지는 이름으로 알 수 없고 **좌표로만** 알 수 있다.
 * 그래서 이 도구는 대상 단지마다 카카오 `coord2regioncode` 를 다시 물어 gu·dong·bjd_code 를 새로 쓴다.
 *
 * ## 왜 지금 필요한가 (에러 없이 0건이 오는 사고)
 *
 * 국토부 실거래가는 옛 코드(28110·28120·28140·28260)에 **에러 대신 0건**을 준다(202605·202608 실측).
 * 건축HUB 도 2026 중 새 코드로 갈아탔다. 그런데 우리 코드표엔 새 구가 없고 `apartments.gu` 는 옛
 * 이름이라, 인천 서구·중구 거래는 202605 이후 **한 건도 안 들어왔고 동구는 처음부터 0건**이었다
 * (동구 코드가 28120 으로 틀려 있었다 — 실제 28140).
 *
 * ## 모드 (배타적 — 하나씩)
 *
 *   node scripts/remap-incheon-2026.mjs                      # (기본) 인천 재정합 계획
 *   node scripts/remap-incheon-2026.mjs --hwaseong           # 경기 화성 표기 통일
 *   node scripts/remap-incheon-2026.mjs --ids=a,b,c          # 지정 id 의 bjd·dong(·gu) 재정합
 *   node scripts/remap-incheon-2026.mjs --trades-cleanup     # 백필 **뒤** 옛 gu 쌍둥이 행 삭제
 *   node scripts/remap-incheon-2026.mjs --normalize-gu       # (옵트인) 전 지역 gu 표기 정규화 목록
 *
 * 공통: `--apply`(쓰기) · `--out=<절대경로>`(계획 JSON, `before` 포함) · `--types=sale,jeonse`(정리 한정)
 *
 * ⚠️ `--out` 은 **절대경로**로. Git Bash `/tmp` 는 node `resolve` 와 다른 폴더를 가리킨다.
 * ⚠️ `--normalize-gu --apply` 는 `--i-reviewed-the-list` 를 함께 줘야 한다 — 208행짜리 전 지역
 *    일괄 변경이라 눈으로 목록을 본 사람만 눌러야 한다.
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY (+ 기본 모드는 KAKAO_KEY)
 */
import { writeFileSync } from "node:fs";
import {
  loadEnv, getSupabase, log, logError, selectAll,
  GU_LAWD_MAP, RETIRED_GU, normalizeGu, resolveRegionName, HWASEONG_BARE_GU,
} from "./collectors/_shared.mjs";
import { fetchRegionDocs, pickRegionDocs } from "./collectors/_kakao-region.mjs";

const PHASE = "remap-incheon";

/** 이 개편이 벌어진 지역 */
export const REGION = "인천";

/**
 * 은퇴한 인천 3구 — **표를 여기 복사하지 않는다**. `_shared.mjs` 의 `RETIRED_GU` 가 진실의 원천이고
 * `getLawdCd` 도 같은 집합을 본다. 복사하면 한쪽만 고쳐져 어긋난다.
 * @type {Set<string>}
 */
export const RETIRED = RETIRED_GU[REGION] ?? new Set();

/** 개편으로 새로 생긴 4구 — trades 쌍둥이 조회의 "새 쪽" */
export const NEW_GU = ["제물포구", "영종구", "서해구", "검단구"];

/**
 * 옛 법정동코드 앞5. 28120(옛 표의 틀린 동구 코드)은 **넣지 않는다** — bjd_code 는 카카오
 * 응답에서만 오므로 우리 표의 오타가 저장될 길이 없고, 실제 DB 에도 0행이다(2026-09-11 실측).
 */
export const OLD_BJD_PREFIX = new Set(["28110", "28140", "28260"]);

/**
 * trades 정리 창 — **절대 월**로 못 박는다. 상대 개월수(`now - 12`)로 쓰면 나중에 이 도구를
 * 다시 돌릴 때 창이 미끄러져 백필하지 않은 달의 옛 행까지 지운다.
 * 하한 = 백필(`collect-trades --months=12`, 2026-09-11 실행)이 덮는 첫 달.
 */
export const TRADE_WINDOW_FROM = "202509";
export const TRADE_WINDOW_TO = "202608";

/**
 * 삭제 fail-close 임계 — 지우려는 옛 행의 **새 gu 쪽 쌍둥이 존재율**이 이 값 미만이면
 * 아무것도 지우지 않는다. 지우는 근거가 "백필이 같은 거래를 새 gu 로 다시 넣었다" 이므로,
 * 쌍둥이가 없으면 그 근거 자체가 무너진다(그 행은 중복이 아니라 유일본이다).
 * 실측 202605: 서구 565/565 · 중구 107/107 = 1.0000.
 */
export const TWIN_RATIO_MIN = 0.99;

/** `.in("id", […])` 한 번에 싣는 id 수 — URL 길이 제한 여유. */
export const ID_CHUNK = 150;

/** trades 타입 — `--types=` 미지정 시 전부 */
export const TRADE_TYPES = ["sale", "jeonse", "presale"];

/**
 * @typedef {{ id: string, region: string | null, gu: string | null, dong: string | null,
 *   bjd_code: string | null, lat: number | null, lng: number | null, name?: string | null }} AptRow
 * @typedef {{ id: number | string, region: string | null, gu: string | null, dong: string | null,
 *   deal_month: string | null, area: number | null, price: number | null, floor: number | null,
 *   trade_type: string | null, apt_name: string | null }} TradeRow
 * @typedef {{ legal: any | null, admin: any | null }} RegionDocs
 * @typedef {{ action: "update" | "unchanged" | "skip", reason?: string,
 *   updates?: Record<string, any>, before?: Record<string, any> }} Verdict
 */

// ── (A) 대상 선정 ──────────────────────────────────────────────
/**
 * 재정합이 필요한 인천 단지를 고른다.
 *
 * 셋 중 하나라도 걸리면 대상이다 — ① gu 가 은퇴한 이름 ② bjd_code 가 없음(애초에 조회 키가 없다)
 * ③ bjd_code 앞5 가 옛 코드. ②를 넣는 이유는 bjd 가 비면 건축HUB·학교알리미 조회가 통째로
 * 안 되기 때문이고, 어차피 좌표를 물어보는 김에 같이 채운다.
 *
 * 좌표가 없으면 판정할 방법이 없으므로 `skipped.noCoord` 로 뺀다 — 추측으로 채우지 않는다.
 *
 * @param {AptRow[]} apts
 * @returns {{ targets: AptRow[], skipped: { noCoord: string[] } }}
 */
export function planIncheonTargets(apts) {
  /** @type {AptRow[]} */
  const targets = [];
  /** @type {string[]} */
  const noCoord = [];
  for (const r of apts) {
    if (r.region !== REGION) continue;
    const bjd = r.bjd_code;
    const hit =
      (r.gu != null && RETIRED.has(r.gu)) ||
      bjd == null ||
      (bjd.length >= 5 && OLD_BJD_PREFIX.has(bjd.slice(0, 5)));
    if (!hit) continue;
    if (r.lat == null || r.lng == null) { noCoord.push(r.id); continue; }
    targets.push(r);
  }
  return { targets, skipped: { noCoord } };
}

// ── (B) 판정 ───────────────────────────────────────────────────
/**
 * 카카오 응답을 보고 인천 단지의 gu·dong·bjd_code 를 새로 정한다.
 *
 * 지역 게이트가 둘인 이유 = 좌표가 인천 밖을 가리키는 행(자리표시 좌표 등)이 섞이면 그 단지를
 * **다른 시도로 옮겨 버린다**. 시도 이름과 법정동코드 접두를 **둘 다** 본다.
 *
 * @param {AptRow} apt
 * @param {RegionDocs} docs 카카오 `coord2regioncode` 응답(테스트가 인자로 주입한다)
 * @returns {Verdict}
 */
export function buildIncheonUpdate(apt, docs) {
  const legal = docs?.legal ?? null;
  const admin = docs?.admin ?? null;
  if (!legal) return { action: "skip", reason: "noLegal" };

  const sido = String(legal.region_1depth_name ?? "");
  const code = String(legal.code ?? "");
  if (!sido.startsWith(REGION) || !code.startsWith("28")) {
    return { action: "skip", reason: "outOfRegion" };
  }

  const rawGu = admin?.region_2depth_name ?? legal.region_2depth_name ?? null;
  const gu = rawGu ? normalizeGu(REGION, rawGu) : null;
  // 은퇴 키는 표에 남아 있으므로 hasOwnProperty 만으로는 못 거른다 — 명시적으로 뺀다.
  if (!gu || RETIRED.has(gu) || !Object.prototype.hasOwnProperty.call(GU_LAWD_MAP[REGION] ?? {}, gu)) {
    return { action: "skip", reason: "unknownGu" };
  }

  const dong = admin?.region_3depth_name ?? legal.region_3depth_name ?? null;
  if (apt.gu === gu && apt.dong === dong && apt.bjd_code === code) {
    return { action: "unchanged" };
  }
  return {
    action: "update",
    updates: { gu, dong, bjd_code: code },
    before: { gu: apt.gu, dong: apt.dong, bjd_code: apt.bjd_code },
  };
}

/**
 * `--ids` 모드 판정 — 인천 전용이 아니라 **아무 지역이나** 온다(전남·광주·경기 실측 6곳).
 *
 * 그래서 게이트가 다르다: 좌표가 가리키는 지역이 **그 단지의 현재 region 과 같아야** 한다.
 * `resolveRegionName` 을 쓰는 이유 = 전남광주통합특별시는 시도 이름만으로 못 갈리고 시군구까지
 * 봐야 광주/전남이 정해지기 때문이다(지석동→남구→광주, 신기동→여수시→전남).
 *
 * gu 는 **다를 때만** 바꾼다 — 이 모드의 목적은 bjd·dong 을 채우는 것이고, gu 변경은
 * `화성특례시`→`화성시` 같은 표기 오염을 곁다리로 고치는 것이다.
 *
 * @param {AptRow} apt
 * @param {RegionDocs} docs
 * @returns {Verdict}
 */
export function buildIdsUpdate(apt, docs) {
  const legal = docs?.legal ?? null;
  const admin = docs?.admin ?? null;
  if (!legal) return { action: "skip", reason: "noLegal" };

  const guForRegion = admin?.region_2depth_name ?? legal.region_2depth_name ?? null;
  const resolved = resolveRegionName(String(legal.region_1depth_name ?? ""), guForRegion);
  if (!resolved || resolved !== apt.region) {
    return { action: "skip", reason: "outOfRegion" };
  }

  const code = String(legal.code ?? "");
  if (!/^\d{10}$/.test(code)) return { action: "skip", reason: "badCode" };
  const dong = admin?.region_3depth_name ?? legal.region_3depth_name ?? null;

  /** @type {Record<string, any>} */
  const updates = { bjd_code: code, dong };
  /** @type {Record<string, any>} */
  const before = { bjd_code: apt.bjd_code, dong: apt.dong };

  const rawGu = admin?.region_2depth_name ?? null;
  const nextGu = rawGu ? normalizeGu(apt.region ?? "", rawGu) : null;
  if (nextGu && nextGu !== apt.gu) {
    updates.gu = nextGu;
    before.gu = apt.gu;
  }

  const same = updates.bjd_code === apt.bjd_code && updates.dong === apt.dong && updates.gu === undefined;
  return same ? { action: "unchanged" } : { action: "update", updates, before };
}

// ── (C) 경기 화성 표기 ─────────────────────────────────────────
/**
 * 화성 **한정** 필터. `normalizeGu(region,gu) !== gu` 전체로 넓히면 경기 일반구 130행이 딸려온다
 * (권선구·오정구·처인구…) — 그건 별개 판단이 필요한 변경이라 `--normalize-gu` 로 갈라 뒀다.
 *
 * @param {AptRow[]} apts
 * @returns {Array<{ id: string, from: string, to: string }>}
 */
export function planHwaseongGu(apts) {
  /** @type {Array<{ id: string, from: string, to: string }>} */
  const out = [];
  for (const r of apts) {
    if (r.region !== "경기" || !r.gu) continue;
    const isHwaseong =
      r.gu === "화성특례시" || r.gu.startsWith("화성시 ") || HWASEONG_BARE_GU.has(r.gu);
    if (!isHwaseong) continue;
    const to = normalizeGu("경기", r.gu);
    if (!to || to === r.gu) continue;
    out.push({ id: r.id, from: r.gu, to });
  }
  return out;
}

// ── (D) 전 지역 gu 표기 정규화 (옵트인) ────────────────────────
/**
 * `normalizeGu` 가 바꿔 놓을 행 전부. **목록만** 낸다 — `--apply` 는 `--i-reviewed-the-list` 동반 시에만.
 * @param {AptRow[]} apts
 * @returns {Array<{ id: string, region: string, from: string, to: string }>}
 */
export function planNormalizeGu(apts) {
  /** @type {Array<{ id: string, region: string, from: string, to: string }>} */
  const out = [];
  for (const r of apts) {
    if (!r.region || !r.gu) continue;
    const to = normalizeGu(r.region, r.gu);
    if (!to || to === r.gu) continue;
    out.push({ id: r.id, region: r.region, from: r.gu, to });
  }
  return out;
}

// ── (E) trades 쌍둥이 정리 ─────────────────────────────────────
/**
 * 같은 거래인지 판정하는 열쇠 — region·gu 는 뺀다(그게 바로 갈린 축이므로).
 *
 * `apt_name` 은 jeonse 에서 늘 null 이다(`collect-trades.mjs` 의 `buildRow` 가 안 넣는다).
 * 옛 행도 새 행도 똑같이 null 이라 키는 일치한다 — 그래서 null 을 `""` 로 접는다.
 *
 * @param {TradeRow} r
 * @returns {string}
 */
export function tradeTwinKey(r) {
  return [r.dong, r.deal_month, r.area, r.price, r.floor, r.trade_type, r.apt_name]
    .map((v) => (v == null ? "" : String(v)))
    .join("|");
}

/**
 * 창 안인가 — 문자열 `YYYYMM` 사전순 비교(자릿수가 같아 안전).
 * @param {string | null | undefined} month
 * @returns {boolean}
 */
export function inTradeWindow(month) {
  if (!month) return false;
  const m = String(month);
  return m >= TRADE_WINDOW_FROM && m <= TRADE_WINDOW_TO;
}

/**
 * 창 + 타입으로 거른다. 서버 필터와 **같은 상수**를 쓰므로 한쪽만 바뀌면 테스트가 잡는다.
 * @param {TradeRow[]} rows
 * @param {string[] | null} [types] null 이면 전부
 * @returns {TradeRow[]}
 */
export function filterTradeRows(rows, types = null) {
  return rows.filter(
    (r) => inTradeWindow(r.deal_month) && (types == null || types.includes(String(r.trade_type))),
  );
}

/**
 * 옛 gu 행마다 새 gu 쪽에 같은 거래가 있는지 센다.
 * @param {TradeRow[]} oldRows 은퇴 gu 행(삭제 후보)
 * @param {TradeRow[]} newRows 새 4구 행(백필 결과)
 * @returns {{ total: number, twins: number, ratio: number, passes: boolean,
 *   twinIds: Array<number|string>, nonTwinSamples: TradeRow[] }}
 */
export function computeTwinRatio(oldRows, newRows) {
  const have = new Set(newRows.map(tradeTwinKey));
  /** @type {Array<number|string>} */
  const twinIds = [];
  /** @type {TradeRow[]} */
  const nonTwinSamples = [];
  let twins = 0;
  for (const r of oldRows) {
    if (have.has(tradeTwinKey(r))) { twins++; twinIds.push(r.id); }
    else if (nonTwinSamples.length < 20) nonTwinSamples.push(r);
  }
  const total = oldRows.length;
  const ratio = total === 0 ? 0 : twins / total;
  return { total, twins, ratio, passes: total > 0 && ratio >= TWIN_RATIO_MIN, twinIds, nonTwinSamples };
}

// ── 쓰기 보조 ──────────────────────────────────────────────────
/**
 * @param {Array<number|string>} ids
 * @param {number} [size]
 * @returns {Array<Array<number|string>>}
 */
export function chunkIds(ids, size = ID_CHUNK) {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunkIds: size 는 1 이상 정수여야 한다 (받은 값 ${size})`);
  }
  /** @type {Array<Array<number|string>>} */
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * 되읽기 대조 — 우리가 쓴 값이 **실제로 그 값인지** DB 에서 다시 읽어 확인한다.
 * 계획 단계 재실행으로는 부족하다(skip 행이 영원히 대상으로 남아 가짜 잔여를 만든다).
 * @param {AptRow[]} afterRows
 * @param {Array<{ id: string, updates: Record<string, any> }>} applied
 * @returns {string[]} 값이 어긋난 id
 */
export function verifyApplied(afterRows, applied) {
  const byId = new Map(afterRows.map((r) => [r.id, r]));
  /** @type {string[]} */
  const bad = [];
  for (const u of applied) {
    const r = /** @type {any} */ (byId.get(u.id));
    if (!r) { bad.push(u.id); continue; }
    for (const [k, v] of Object.entries(u.updates)) {
      if (r[k] !== v) { bad.push(u.id); break; }
    }
  }
  return bad;
}

/**
 * 되읽기 판정 — 남으면 안 되는 잔여를 문장으로(빈 배열 = 통과).
 *
 * ⚠️ `leftCount` 가 null/undefined 면 **실패**다. Supabase 의 `head:true` 조회는 표가 없거나
 * 조회가 어긋나도 `count: null` 을 조용히 돌려준다 — `?? 0` 으로 받으면 "0건 남음 = 성공" 으로
 * 뒤집혀 읽힌다(probe-must-be-self-verified §4-1).
 *
 * @param {{ mismatched?: string[], leftCount?: number | null, checkCount?: boolean, applied?: boolean }} r
 * @returns {string[]}
 */
export function verifyResiduals(r) {
  /** @type {string[]} */
  const problems = [];
  const mism = r.mismatched ?? [];
  if (mism.length > 0) problems.push(`되읽기 불일치 ${mism.length}곳: ${mism.slice(0, 10).join(", ")}`);
  if (r.checkCount) {
    if (r.leftCount == null) problems.push("재조회 실패 — count 가 null (0 으로 읽지 않는다)");
    else if (r.applied && r.leftCount > 0) problems.push(`trades 잔여 ${r.leftCount}행`);
  }
  return problems;
}

// ── 인자 ───────────────────────────────────────────────────────
/**
 * @param {string[]} argv
 * @returns {{ mode: string, apply: boolean, outPath: string | null, ids: string[],
 *   types: string[] | null, reviewed: boolean, error: string | null }}
 */
export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const reviewed = argv.includes("--i-reviewed-the-list");
  const outArg = argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : null;
  const idsArg = argv.find((a) => a.startsWith("--ids="));
  const ids = idsArg
    ? idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const typesArg = argv.find((a) => a.startsWith("--types="));
  const types = typesArg
    ? typesArg.slice("--types=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  /** @type {string[]} */
  const modes = [];
  if (argv.includes("--hwaseong")) modes.push("hwaseong");
  if (idsArg) modes.push("ids");
  if (argv.includes("--trades-cleanup")) modes.push("trades-cleanup");
  if (argv.includes("--normalize-gu")) modes.push("normalize-gu");

  const known = (/** @type {string} */ a) =>
    a === "--apply" || a === "--hwaseong" || a === "--trades-cleanup" ||
    a === "--normalize-gu" || a === "--i-reviewed-the-list" ||
    a.startsWith("--out=") || a.startsWith("--ids=") || a.startsWith("--types=");
  const unknown = argv.filter((a) => !known(a));

  let error = null;
  if (unknown.length) error = `모르는 인자: ${unknown.join(" ")}`;
  else if (modes.length > 1) error = `모드는 하나씩만: ${modes.join(" + ")}`;
  else if (outArg && !outPath) error = "--out= 에 경로가 없습니다 (절대경로 필요)";
  else if (idsArg && ids.length === 0) error = "--ids= 에 id 가 없습니다";
  else if (types && types.some((t) => !TRADE_TYPES.includes(t))) {
    error = `--types= 는 ${TRADE_TYPES.join("/")} 만 (받은 값: ${types.join(",")})`;
  } else if (types && modes[0] !== "trades-cleanup") {
    error = "--types= 는 --trades-cleanup 에서만 씁니다";
  } else if (modes[0] === "normalize-gu" && apply && !reviewed) {
    error = "--normalize-gu --apply 는 --i-reviewed-the-list 를 함께 줘야 합니다 (전 지역 일괄 변경)";
  }

  return { mode: modes[0] ?? "incheon", apply, outPath, ids, types, reviewed, error };
}

// ── 출력 ───────────────────────────────────────────────────────
/**
 * @param {Array<string|number>} ids
 * @param {number} [max]
 * @returns {string}
 */
function idList(ids, max = 20) {
  if (ids.length === 0) return "(없음)";
  return ids.length <= max
    ? ids.join(", ")
    : `${ids.slice(0, max).join(", ")} … 외 ${ids.length - max}건`;
}

const APT_COLUMNS = "id, region, gu, dong, bjd_code, lat, lng, name";
const TRADE_COLUMNS = "id, region, gu, dong, deal_month, area, price, floor, trade_type, apt_name";

/**
 * @param {any} sb
 * @param {string[] | null} ids
 * @returns {Promise<AptRow[]>}
 */
async function fetchApts(sb, ids = null) {
  if (!ids) {
    return /** @type {AptRow[]} */ (
      await selectAll((s) => s.from("apartments").select(APT_COLUMNS), sb, "id")
    );
  }
  /** @type {AptRow[]} */
  const out = [];
  for (const chunk of chunkIds(ids)) {
    const rows = /** @type {AptRow[]} */ (
      await selectAll((s) => s.from("apartments").select(APT_COLUMNS).in("id", chunk), sb, "id")
    );
    out.push(...rows);
  }
  return out;
}

// ── 메인 ───────────────────────────────────────────────────────
async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { logError(PHASE, args.error); process.exit(1); }
  const { mode, apply, outPath, types } = args;

  log(PHASE, `=== ${mode} · ${apply ? "APPLY (쓰기)" : "DRY-RUN (읽기만)"} ===`);
  const sb = getSupabase();

  /** @type {Array<{ id: string, updates: Record<string, any>, before: Record<string, any> }>} */
  const applied = [];
  /** @type {Record<string, any>} */
  const plan = { generatedAt: new Date().toISOString(), mode };
  /** @type {{ oldIds: Array<number|string>, passes: boolean } | null} */
  let tradePlan = null;

  if (mode === "incheon") {
    const kakaoKey = process.env.KAKAO_KEY;
    if (!kakaoKey) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

    const apts = (await fetchApts(sb)).filter((r) => r.region === REGION);
    log(PHASE, `인천 apartments: ${apts.length}곳`);
    const { targets, skipped } = planIncheonTargets(apts);
    log(PHASE, `재정합 대상: ${targets.length}곳 (좌표 없음 ${skipped.noCoord.length}곳)`);

    /** @type {Record<string, number>} */
    const skipReasons = { noCoord: skipped.noCoord.length };
    let unchanged = 0;
    let dongChanged = 0;
    let done = 0;
    for (const apt of targets) {
      done++;
      /** @type {RegionDocs} */
      let docs;
      try {
        docs = pickRegionDocs(await fetchRegionDocs(Number(apt.lat), Number(apt.lng), kakaoKey));
      } catch (err) {
        skipReasons.kakaoFail = (skipReasons.kakaoFail ?? 0) + 1;
        logError(PHASE, `${apt.id} 카카오 실패: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const v = buildIncheonUpdate(apt, docs);
      if (v.action === "unchanged") { unchanged++; continue; }
      if (v.action === "skip") {
        const why = v.reason ?? "unknown";
        skipReasons[why] = (skipReasons[why] ?? 0) + 1;
        logError(PHASE, `[skip:${why}] ${apt.id} ${apt.name ?? ""} (gu=${apt.gu ?? ""} bjd=${apt.bjd_code ?? ""})`);
        continue;
      }
      const u = /** @type {Record<string, any>} */ (v.updates);
      const b = /** @type {Record<string, any>} */ (v.before);
      if (u.dong !== b.dong) dongChanged++;
      applied.push({ id: apt.id, updates: u, before: b });
      if (applied.length <= 15) {
        log(PHASE, `     ${apt.id}: gu ${b.gu ?? "∅"}→${u.gu} · dong ${b.dong ?? "∅"}→${u.dong ?? "∅"} · bjd ${b.bjd_code ?? "∅"}→${u.bjd_code}`);
      }
      if (done % 10 === 0) log(PHASE, `  … ${done}/${targets.length}`);
    }
    log(PHASE, `갱신 ${applied.length}곳 · 변경 없음 ${unchanged}곳 · dong 표기 변경 ${dongChanged}곳`);
    log(PHASE, `skip 사유: ${Object.entries(skipReasons).map(([k, n]) => `${k}=${n}`).join(" · ") || "(없음)"}`);
    Object.assign(plan, {
      incheonRows: apts.length, targets: targets.length, unchanged, dongChanged,
      skipReasons, updates: applied,
    });
  } else if (mode === "ids") {
    const kakaoKey = process.env.KAKAO_KEY;
    if (!kakaoKey) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

    const apts = await fetchApts(sb, args.ids);
    const found = new Set(apts.map((r) => r.id));
    const missing = args.ids.filter((id) => !found.has(id));
    if (missing.length) logError(PHASE, `없는 id ${missing.length}건: ${idList(missing)}`);
    log(PHASE, `--ids 대상: ${apts.length}곳 (요청 ${args.ids.length})`);

    /** @type {Record<string, number>} */
    const skipReasons = missing.length ? { notFound: missing.length } : {};
    let unchanged = 0;
    for (const apt of apts) {
      if (apt.lat == null || apt.lng == null) {
        skipReasons.noCoord = (skipReasons.noCoord ?? 0) + 1;
        logError(PHASE, `[skip:noCoord] ${apt.id}`);
        continue;
      }
      /** @type {RegionDocs} */
      let docs;
      try {
        docs = pickRegionDocs(await fetchRegionDocs(Number(apt.lat), Number(apt.lng), kakaoKey));
      } catch (err) {
        skipReasons.kakaoFail = (skipReasons.kakaoFail ?? 0) + 1;
        logError(PHASE, `${apt.id} 카카오 실패: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const v = buildIdsUpdate(apt, docs);
      if (v.action === "unchanged") { unchanged++; continue; }
      if (v.action === "skip") {
        const why = v.reason ?? "unknown";
        skipReasons[why] = (skipReasons[why] ?? 0) + 1;
        logError(PHASE, `[skip:${why}] ${apt.id} (region=${apt.region ?? ""} gu=${apt.gu ?? ""})`);
        continue;
      }
      const u = /** @type {Record<string, any>} */ (v.updates);
      const b = /** @type {Record<string, any>} */ (v.before);
      applied.push({ id: apt.id, updates: u, before: b });
      log(PHASE, `     ${apt.id}: bjd ${b.bjd_code ?? "∅"}→${u.bjd_code} · dong ${b.dong ?? "∅"}→${u.dong ?? "∅"}` +
        (u.gu !== undefined ? ` · gu ${b.gu ?? "∅"}→${u.gu}` : ""));
    }
    log(PHASE, `갱신 ${applied.length}곳 · 변경 없음 ${unchanged}곳`);
    log(PHASE, `skip 사유: ${Object.entries(skipReasons).map(([k, n]) => `${k}=${n}`).join(" · ") || "(없음)"}`);
    Object.assign(plan, { requested: args.ids, unchanged, skipReasons, updates: applied });
  } else if (mode === "hwaseong") {
    const apts = await fetchApts(sb);
    const rows = planHwaseongGu(apts);
    log(PHASE, `경기 화성 표기 통일: ${rows.length}곳`);
    for (const r of rows) log(PHASE, `     ${r.id}: ${r.from} → ${r.to}`);
    for (const r of rows) applied.push({ id: r.id, updates: { gu: r.to }, before: { gu: r.from } });
    Object.assign(plan, { aptRows: apts.length, updates: applied });
  } else if (mode === "normalize-gu") {
    const apts = await fetchApts(sb);
    const rows = planNormalizeGu(apts);
    /** @type {Record<string, number>} */
    const byRegion = {};
    for (const r of rows) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1;
    log(PHASE, `gu 표기 정규화 대상: ${rows.length}곳`);
    log(PHASE, `지역별: ${Object.entries(byRegion).map(([k, n]) => `${k}=${n}`).join(" · ") || "(없음)"}`);
    for (const r of rows.slice(0, 40)) log(PHASE, `     ${r.id}: ${r.region} ${r.from} → ${r.to}`);
    if (rows.length > 40) log(PHASE, `     … 외 ${rows.length - 40}건`);
    if (!args.reviewed) {
      log(PHASE, "※ 이 모드는 전 지역 일괄 변경이다 — 반영하려면 목록을 눈으로 본 뒤");
      log(PHASE, "  `--normalize-gu --apply --i-reviewed-the-list` 로 다시 부른다.");
    }
    for (const r of rows) applied.push({ id: r.id, updates: { gu: r.to }, before: { gu: r.from } });
    Object.assign(plan, { aptRows: apts.length, byRegion, updates: applied });
  } else if (mode === "trades-cleanup") {
    const wantTypes = types ?? null;
    const oldRaw = /** @type {TradeRow[]} */ (
      await selectAll(
        (s) => s.from("trades").select(TRADE_COLUMNS)
          .eq("region", REGION).in("gu", [...RETIRED])
          .gte("deal_month", TRADE_WINDOW_FROM).lte("deal_month", TRADE_WINDOW_TO),
        sb, "id",
      )
    );
    const newRaw = /** @type {TradeRow[]} */ (
      await selectAll(
        (s) => s.from("trades").select(TRADE_COLUMNS)
          .eq("region", REGION).in("gu", NEW_GU)
          .gte("deal_month", TRADE_WINDOW_FROM).lte("deal_month", TRADE_WINDOW_TO),
        sb, "id",
      )
    );
    const oldRows = filterTradeRows(oldRaw, wantTypes);
    const newRows = filterTradeRows(newRaw, wantTypes);
    const d = computeTwinRatio(oldRows, newRows);
    log(PHASE, `창 ${TRADE_WINDOW_FROM}~${TRADE_WINDOW_TO} · 타입 ${wantTypes ? wantTypes.join("/") : "전부"}`);
    log(
      PHASE,
      `옛 gu(${[...RETIRED].join("/")}) ${d.total}행 · 새 gu 4구 ${newRows.length}행 · ` +
        `쌍둥이 ${d.twins}행 · 비율 ${(d.ratio * 100).toFixed(2)}% · 임계 ${(TWIN_RATIO_MIN * 100).toFixed(0)}% → ` +
        (d.passes ? "통과(삭제 가능)" : "중단(fail-close)"),
    );
    if (!d.passes) {
      log(PHASE, "  쌍둥이 없는 행 표본(최대 20):");
      for (const r of d.nonTwinSamples) {
        log(PHASE, `     id=${r.id} ${r.gu ?? ""} ${r.dong ?? ""} ${r.deal_month ?? ""} ${r.trade_type ?? ""} ${r.area ?? ""}㎡ ${r.price ?? ""} ${r.floor ?? ""}층`);
      }
      log(PHASE, "  → 백필이 아직 안 끝났거나 타입이 안 맞는다. `--types=sale,jeonse` 로 좁혀 다시 본다.");
    }
    tradePlan = { oldIds: d.twinIds, passes: d.passes };
    Object.assign(plan, {
      window: { from: TRADE_WINDOW_FROM, to: TRADE_WINDOW_TO }, types: wantTypes,
      oldRows: d.total, newRows: newRows.length, twins: d.twins, ratio: d.ratio, passes: d.passes,
      twinIds: d.twinIds,
      nonTwinSamples: d.nonTwinSamples.map((r) => ({
        id: r.id, gu: r.gu, dong: r.dong, deal_month: r.deal_month,
        trade_type: r.trade_type, area: r.area, price: r.price, floor: r.floor,
      })),
    });
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
    log(PHASE, `계획 저장: ${outPath}`);
  }

  if (!apply) {
    log(PHASE, "dry-run 완료 — 쓰기 없음 (--apply 로 반영)");
    return;
  }

  // ── 쓰기 (여기부터는 --apply 일 때만 도달한다) ──
  if (mode === "trades-cleanup") {
    if (!tradePlan || !tradePlan.passes) {
      logError(PHASE, "쌍둥이 비율 미달 — 아무것도 지우지 않았습니다 (fail-close)");
      process.exit(1);
    }
    let deleted = 0;
    for (const chunk of chunkIds(tradePlan.oldIds)) {
      const { error } = await sb.from("trades").delete().in("id", chunk);
      if (error) { logError(PHASE, `삭제(${chunk.length}행): ${error.message}`); process.exit(1); }
      deleted += chunk.length;
    }
    const { count: leftCount, error: leftErr } = await sb
      .from("trades").select("*", { count: "exact", head: true })
      .eq("region", REGION).in("gu", [...RETIRED])
      .gte("deal_month", TRADE_WINDOW_FROM).lte("deal_month", TRADE_WINDOW_TO);
    if (leftErr) logError(PHASE, `재조회 오류: ${leftErr.message}`);
    log(PHASE, `삭제 ${deleted}행 · 창 안 옛 gu 잔여 ${leftCount ?? "(count 없음)"}`);
    // ⚠️ `--types=` 로 좁혀 돌렸으면 다른 타입이 남는 게 정상 — 그때는 잔여를 실패로 세지 않는다.
    const problems = verifyResiduals({ leftCount, checkCount: true, applied: types == null });
    if (problems.length) { logError(PHASE, `재조회 결과가 기대와 다릅니다 — ${problems.join(" · ")}`); process.exit(1); }
    log(PHASE, "apply 완료");
    return;
  }

  let wrote = 0;
  for (const u of applied) {
    const { error } = await sb.from("apartments").update(u.updates).eq("id", u.id);
    if (error) { logError(PHASE, `${u.id}: ${error.message}`); process.exit(1); }
    wrote++;
  }
  const after = await fetchApts(sb, applied.map((u) => u.id));
  const mismatched = verifyApplied(after, applied);
  log(PHASE, `쓰기 ${wrote}곳 · 되읽기 불일치 ${mismatched.length}곳`);
  const problems = verifyResiduals({ mismatched });
  if (problems.length) {
    logError(PHASE, `불일치 id: ${idList(mismatched)}`);
    logError(PHASE, `재조회 결과가 기대와 다릅니다 — ${problems.join(" · ")}`);
    process.exit(1);
  }
  log(PHASE, "apply 완료");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
