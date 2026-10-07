// @ts-check
/**
 * 국토부 실거래가 수집기 — trades 테이블 적재
 *
 * 사용법:
 *   node scripts/collectors/collect-trades.mjs          (trades 테이블 적재)
 *   node scripts/collectors/collect-trades.mjs --dry-run (미리보기만)
 *   node scripts/collectors/collect-trades.mjs --months=12 (12개월 수집)
 *   node scripts/collectors/collect-trades.mjs --budget-min=150 (벽시계 예산 분 — 기본 150, 0=무제한)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, MOLIT_KEY
 */
import {
  loadEnv, getMibuyangSupabase, log, logError, sleep,
  upsertBatch, createReporter, recordApiQuota, recordCollectorRun, fetchWithRetry,
  getLawdCd, normalizeGu, budgetExceeded, selectAll, GU_LAWD_CODES,
} from "./_shared.mjs";
import { buildDealRow, isOwnershipRight, dealKey, saveDealsForKey } from "./_trade-deals.mjs";
import { randomUUID } from "node:crypto";

loadEnv();

const PHASE = "trades";

// 벽시계 예산 (분). 원래 collect-trades.yml 의 timeout-minutes(180) 대비 30분 여유였고,
// 남은 30분은 마지막 upsert(약 52만행 batch 500) + 마무리용. 근거: 6/6 성공 run 실측 73.8분
// × 현재 API 지연 1.8배 ≈ 133분 → 예산 150분이면 정상 회차는 예산에 닿지도 않는다.
// ⚠️ 세션 515: 그 yml 은 삭제됐다(MOLIT 해외 IP 차단 → 로컬 러너 매월 6일). 로컬엔 강제 종료가
// 없으므로 이 예산은 이제 "무한정 물지 않게" 스스로 끊는 상한이다 — 값은 그대로 둔다.
const DEFAULT_BUDGET_MIN = 150;

const API_KEY = process.env.MOLIT_KEY;
const API_BASE = "https://apis.data.go.kr/1613000";

/**
 * @typedef {{ region: string; gu: string | null }} RegionGuPair
 * @typedef {{ region: string; gu: string | null; dong: string | null; deal_month: string; area: number; price: number; floor: number | null; build_year: number | null; trade_type?: string; deposit?: number | null; apt_name?: string | null; dealing_type?: string | null; cancel_date?: string | null }} TradeRow
 * @typedef {"sale" | "jeonse" | "presale"} TradeType
 * @typedef {import("./_trade-deals.mjs").DealRow} DealRow
 * @typedef {{ rows: TradeRow[]; deals: DealRow[]; skippedOwnership: number; apiCalls: number; apiFails: number; fallbackUsed: boolean }} FetchResult
 */

/**
 * @param {string} xml
 * @returns {string[]}
 */
function extractItems(xml) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(m => m[0]);
}

// regex 캐싱 — 호출당 new RegExp 생성 방지
/** @type {Record<string, RegExp>} */
const TAG_REGEX_CACHE = {};
/**
 * @param {string} item
 * @param {string} tag
 * @returns {string}
 */
function getTag(item, tag) {
  if (!TAG_REGEX_CACHE[tag]) TAG_REGEX_CACHE[tag] = new RegExp("<" + tag + ">([^<]*)</" + tag + ">");
  const r = item.match(TAG_REGEX_CACHE[tag]);
  return r && r[1] ? r[1].trim() : "";
}

// ── 거래타입별 설정 ──────────────────────────────────────────
/**
 * @typedef {{
 *   endpoint: string;
 *   fallbackEndpoint?: string;
 *   label: string;
 *   priceTag: string;
 *   skipUnregistered?: boolean;
 *   validate: (price: number, area: number, item: string) => boolean;
 *   buildRow: (item: string, base: TradeRow, isFallback: boolean) => TradeRow;
 * }} TradeConfig
 */

/** @type {Record<TradeType, TradeConfig>} */
const TRADE_CONFIGS = {
  sale: {
    endpoint: `${API_BASE}/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`,
    fallbackEndpoint: `${API_BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`,
    label: "매매",
    priceTag: "dealAmount",
    validate: (price, area) => price > 0 && area > 0,
    buildRow: (item, base, isFallback) => {
      /** @type {TradeRow} */
      const row = { ...base, trade_type: "sale", deposit: null };
      if (!isFallback) {
        row.apt_name = getTag(item, "aptNm") || null;
        row.dealing_type = getTag(item, "dealingGbn") || null;
        const cd = getTag(item, "cdealDay");
        row.cancel_date = (cd && cd.trim()) ? cd.trim() : null;
      }
      return row;
    },
  },
  jeonse: {
    endpoint: `${API_BASE}/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`,
    label: "전세",
    priceTag: "deposit",
    validate: (price, area, item) => {
      const monthlyRent = parseInt((getTag(item, "monthlyRent") || "0").replace(/,/g, ""));
      return price > 0 && monthlyRent === 0 && area > 0;
    },
    buildRow: (_item, base) => ({ ...base, trade_type: "jeonse", deposit: base.price }),
  },
  presale: {
    endpoint: `${API_BASE}/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade`,
    label: "분양권",
    priceTag: "dealAmount",
    skipUnregistered: true,
    validate: (price, area) => price > 0 && area > 0,
    buildRow: (item, base) => ({
      ...base, trade_type: "presale", deposit: null,
      apt_name: getTag(item, "aptNm") || null,
    }),
  },
};

/**
 * @param {string} endpoint
 * @param {string} lawdCd
 * @param {string} month
 */
function buildApiUrl(endpoint, lawdCd, month) {
  return `${endpoint}?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=1&numOfRows=9999`;
}

/**
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function fetchXml(url) {
  const res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return res ? await res.text() : null;
}

/**
 * 단일 거래타입의 모든 월 데이터를 수집.
 * @param {string} lawdCd
 * @param {string[]} months
 * @param {TradeType} type
 * @param {RegionGuPair} rg
 * @param {Set<string>} seen
 * @param {boolean} prevFallbackUsed
 * @returns {Promise<FetchResult>}
 *
 * 세션589: 같은 item 으로 `trade_deals` 행(`deals`)도 만든다 — 원문 한 건 = 한 행이라 `seen` 으로 접지 않는다.
 * `trades` 행 만들기·`seen` 열쇠·`validate` 는 그대로다. 분양권 "입"(입주권)은 `deals` 에서만 빠지고
 * `skippedOwnership` 으로 센다(`trades` 행에는 지금처럼 들어간다 — 2u 가 읽는 표의 내용을 바꾸지 않는다).
 * 한 달 응답이 중간에 예외로 끊기면 그 달 `deals` 는 버린다(반쪽 응답으로 열쇠를 교체하지 않게).
 */
export async function fetchTradeRows(lawdCd, months, type, rg, seen, prevFallbackUsed) {
  const config = TRADE_CONFIGS[type];
  /** @type {TradeRow[]} */
  const rows = [];
  /** @type {DealRow[]} */
  const deals = [];
  let skippedOwnership = 0;
  const dealGu = tradeRowGu(rg.region, rg.gu);
  let apiCalls = 0;
  // 세션 503: 실패 횟수를 세어 올린다. 안 세면 "전부 실패해서 0건"과 "부를 게 없어서 0건"이
  // 구분되지 않아, 아래 main() 이 두 경우를 똑같이 성공으로 끝낸다(그게 2개월 공백을 숨겼다).
  let apiFails = 0;
  let fallbackUsed = prevFallbackUsed || false;
  let regionFallback = false;

  for (const month of months) {
    /** @type {DealRow[]} */
    const monthDeals = [];
    let monthOwnership = 0;
    try {
      let xml = await fetchXml(buildApiUrl(config.endpoint, lawdCd, month));

      // sale: AptTradeDev 미등록 → 기존 API 폴백
      if (config.fallbackEndpoint && xml && xml.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
        if (!fallbackUsed) log(PHASE, "AptTradeDev 미등록 — 기존 API 폴백");
        regionFallback = true;
        fallbackUsed = true;
        xml = await fetchXml(buildApiUrl(config.fallbackEndpoint, lawdCd, month));
      }

      // presale: SERVICE_KEY 미등록 시 무시
      if (config.skipUnregistered && xml && xml.includes("SERVICE_KEY_IS_NOT_REGISTERED")) continue;
      if (!xml) continue;

      for (const item of extractItems(xml)) {
        const price = parseInt((getTag(item, config.priceTag) || "0").replace(/,/g, ""));
        const area = parseFloat(getTag(item, "excluUseAr") || "0");
        if (!config.validate(price, area, item)) continue;

        const deal = buildDealRow(item, { type, region: rg.region, gu: dealGu, sggCd: lawdCd, month, getTag });
        if (deal) monthDeals.push(deal);
        else if (type === "presale" && isOwnershipRight(item, getTag)) monthOwnership++;
        const floor = parseInt(getTag(item, "floor") || "0") || null;
        const buildYear = parseInt(getTag(item, "buildYear") || "0") || null;
        const dong = getTag(item, "umdNm") || null;
        // 세션550: 키도 **저장될 값**(tradeRowGu)으로 만든다 — 저장값과 다른 키로 접으면
        // 회차 안 중복 제거와 DB 고유 인덱스가 서로 다른 것을 같다고 보게 된다.
        const rowGu = tradeRowGu(rg.region, rg.gu);
        const key = `${rg.region}|${rowGu}|${month}|${area}|${price}|${floor}|${type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        /** @type {TradeRow} */
        const base = {
          region: rg.region, gu: rowGu, dong, deal_month: month,
          area: Math.round(area * 100) / 100, price, floor, build_year: buildYear,
        };
        rows.push(config.buildRow(item, base, regionFallback));
      }
      deals.push(...monthDeals);
      skippedOwnership += monthOwnership;
      apiCalls++;
    } catch (err) {
      apiFails++;
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${config.label} API 실패 ${lawdCd}/${month}: ${msg}`);
    }
    await sleep(200);
  }
  return { rows, deals, skippedOwnership, apiCalls, apiFails, fallbackUsed };
}

/**
 * 한 (region, gu) 의 LAWD_CD 전부 × 거래 종류 3개를 받는다(세션589 — 화성시는 4코드).
 * `trades` 행은 지금처럼 모아 돌려주고, `trade_deals` 는 (코드·종류) 한 번 받을 때마다 `onDeals` 로 넘긴다
 * (열쇠별 교체 저장은 호출자 — 회차 전체를 메모리에 쥐지 않게).
 *
 * @param {RegionGuPair} rg
 * @param {string[]} codes                    `GU_LAWD_CODES(rg.region, rg.gu)`
 * @param {string[]} months
 * @param {{
 *   seen: Set<string>;
 *   fallbackUsed: boolean;
 *   shouldStop?: () => "interrupt" | "budget" | null;
 *   onDeals?: (lawdCd: string, type: TradeType, result: FetchResult) => Promise<void>;
 * }} ctx
 * @returns {Promise<{ rows: TradeRow[]; apiCalls: number; apiFails: number; fallbackUsed: boolean; stopped: "interrupt" | "budget" | null; dealErrors: number }>}
 */
export async function collectRegion(rg, codes, months, ctx) {
  /** @type {TradeRow[]} */
  const rows = [];
  let apiCalls = 0;
  let apiFails = 0;
  let dealErrors = 0;
  let fallbackUsed = ctx.fallbackUsed;
  /** @type {"interrupt" | "budget" | null} */
  let stopped = null;
  outer: for (const lawdCd of codes) {
    for (const type of /** @type {TradeType[]} */ (["sale", "jeonse", "presale"])) {
      stopped = ctx.shouldStop?.() ?? null;
      if (stopped) break outer;
      // 시세 비교 범위 좁히기 다(세션607 · 사장님 결정 D6/C2): 화성 4코드 응답 **전부** 로 trades 행도 만든다
      //   (가 에서는 41591 응답만 trades 에 넣었다 — 화성 60곳의 유동성·점수가 두 번 바뀌지 않게 다) 점수 전환과 함께 푼다).
      //   행의 gu 는 "화성시" 그대로(tradeRowGu) · 코드가 하나인 다른 시군구는 이 PR 전과 같다.
      const result = await fetchTradeRows(lawdCd, months, type, rg, ctx.seen, fallbackUsed);
      rows.push(...result.rows);
      apiCalls += result.apiCalls;
      apiFails += result.apiFails;
      fallbackUsed = result.fallbackUsed;
      // trade_deals 저장이 예외를 던져도 trades 수집·저장·회차 기록은 계속 돌아야 한다(검사관 C8 — 세션503 꼴)
      if (ctx.onDeals) {
        try {
          await ctx.onDeals(lawdCd, type, result);
        } catch (err) {
          dealErrors++;
          logError(PHASE, `trade_deals 저장 예외 ${lawdCd}|${type}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return { rows, apiCalls, apiFails, fallbackUsed, stopped, dealErrors };
}

/**
 * `trade_deals` 저장기 — `collectRegion` 의 `onDeals` 와 회차 집계를 묶는다(시험이 main 없이 배선을 본다).
 *
 * - (코드·종류) 하나를 받으면 달 열쇠별로 나눠 `saveDealsForKey`. 0건 열쇠는 지우지 않고 센다.
 * - **한 회차에 같은 (코드·종류) 는 한 번만** 저장한다 — 구 없는 시 이름 gu(천안시·창원시 등)가 그 시 첫 구의
 *   코드를 받아 같은 열쇠를 두 번 돌 수 있다(검사관 A5·C9, 운영 16행). 두 번째는 건너뛰고 로그 1줄.
 * - 표가 없으면(PGRST205 — 마이그 적용 전) 첫 1회에 그 회차의 저장을 멈추고 실패 1건만 센다(검사관 A6).
 * - dry-run 이면 세기만 하고 저장하지 않는다.
 *
 * @param {{ sb: any; months: string[]; batchId: string; runStartedAt: string; dryRun: boolean; sleep?: (ms: number) => Promise<void> }} opts
 */
export function makeDealSaver({ sb, months, batchId, runStartedAt, dryRun, sleep: sl }) {
  const stats = { keys: 0, rows: 0, inserted: 0, deleted: 0, skippedOwnership: 0, zeroKeys: 0, failKeys: 0, heldKeys: 0, warnKeys: 0, dupSkips: 0 };
  /** @type {string[]} */
  const zeroKeySamples = [];
  /** @type {string[]} */
  const heldKeySamples = [];
  /** @type {Set<string>} */
  const done = new Set();
  let disabled = false;
  /**
   * @param {string} lawdCd
   * @param {TradeType} type
   * @param {FetchResult} result
   */
  const onDeals = async (lawdCd, type, result) => {
    const once = `${lawdCd}|${type}`;
    if (done.has(once)) {
      stats.dupSkips++;
      log(PHASE, `  trade_deals: ${once} 는 이번 회차에 이미 저장 — 건너뜀(같은 코드를 내는 gu 가 둘)`);
      return;
    }
    done.add(once);
    stats.skippedOwnership += result.skippedOwnership;
    if (disabled) return;
    for (const [k, list] of groupDealsByKey(lawdCd, type, months, result.deals)) {
      stats.keys++;
      // 0건 응답은 지우지 않는다(옛 코드·장애가 에러 대신 0건으로 온다 — admin-district-code-reform.md §4)
      if (!list.length) { stats.zeroKeys++; if (zeroKeySamples.length < 10) zeroKeySamples.push(k); continue; }
      stats.rows += list.length;
      if (dryRun) continue;
      const [sgg_cd = "", deal_month = "", trade_type = ""] = k.split("|");
      const res = await saveDealsForKey(sb, { sgg_cd, deal_month, trade_type }, list, batchId, { sleep: sl, runStartedAt });
      if (res.status === "ok") {
        stats.inserted += res.inserted;
        stats.deleted += res.deleted + res.staleDeleted;
        if (res.warn) { stats.warnKeys++; log(PHASE, `  trade_deals 경고 ${k}: ${res.warn}`); }
      } else if (res.status === "held") {
        stats.heldKeys++;
        stats.deleted += res.staleDeleted;
        if (heldKeySamples.length < 10) heldKeySamples.push(`${k}(${list.length}<${res.keepRows ?? "?"}/2)`);
      } else if (res.status === "no-table") {
        stats.failKeys++;
        disabled = true;
        logError(PHASE, `trade_deals 표가 없다(마이그 적용 전?) — 이번 회차의 trade_deals 저장을 멈춘다: ${res.error ?? "?"}`);
        return;
      } else if (res.status === "fail") {
        stats.failKeys++;
        logError(PHASE, `trade_deals 쓰기 실패 ${k}: ${res.error ?? "?"}`);
      }
    }
  };
  return { onDeals, stats, zeroKeySamples, heldKeySamples, isDisabled: () => disabled };
}

/**
 * 한 번 받은 (코드·종류) 의 `deals` 를 월 열쇠별로 나눈다. 받은 달은 0건이어도 빈 목록으로 들어간다
 * (0건 열쇠는 호출자가 지우지 않고 센다).
 * @param {string} lawdCd
 * @param {TradeType} type
 * @param {string[]} months
 * @param {DealRow[]} deals
 * @returns {Map<string, DealRow[]>}
 */
export function groupDealsByKey(lawdCd, type, months, deals) {
  /** @type {Map<string, DealRow[]>} */
  const byKey = new Map(months.map((m) => [dealKey(lawdCd, m, type), /** @type {DealRow[]} */ ([])]));
  for (const d of deals) {
    const k = dealKey(d.sgg_cd, d.deal_month, d.trade_type);
    const list = byKey.get(k);
    if (list) list.push(d);
    else byKey.set(k, [d]);
  }
  return byKey;
}

/**
 * 저장할 `trades.gu` 값 — 세종만 `"세종시"` 로 채운다 (세션550).
 *
 * ## 왜 (NULL 은 고유 인덱스에서 절대 충돌하지 않는다)
 *
 * `idx_trades_unique(region, gu, deal_month, area, price, floor, trade_type)` 는 upsert 의
 * `ON CONFLICT` 키인데, Postgres 는 **NULL 을 서로 다른 값으로 본다**. 세종은 구·군이 없어
 * `regionGuPairs` 가 `{region:"세종", gu:null}` 하나를 만들고 그 null 이 그대로 저장되므로,
 * **충돌이 한 번도 안 나 회차마다 같은 거래가 새 행으로 또 들어갔다**.
 * 2026-09-20 실측: `gu IS NULL` 행 68,352 = 실제 거래 11,812건(202603 은 10벌, 202608 은 1벌).
 * 손님 화면의 "세종 6개월 거래 10,916건"(참값 2,124)이 이 때문에 부풀었다.
 *
 * `"세종시"` 인 이유 = `GU_LAWD_MAP["세종"]["세종시"]`(36110) · `regions` 키 `세종|세종시` 와 같은 표기다.
 * ⚠️ `세종|세종시` 는 설계상 `apartments` 에 짝이 없다(세종 단지의 `apartments.gu` 는 null) —
 *    고아 버킷(`apartments.gu` ↔ `regions`) 점검은 이 쌍을 결함으로 세면 안 된다.
 *
 * 수집 대상 목록(`regionGuPairs`)·`--only=세종:` 필터·`getLawdCd` 의미는 그대로 둔다 —
 * 바뀌는 것은 **저장되는 행의 값뿐**이다.
 *
 * @param {string} region
 * @param {string | null | undefined} gu
 * @returns {string | null}
 */
export function tradeRowGu(region, gu) {
  if (gu) return gu;
  if (region === "세종") return "세종시";
  return null;
}

/**
 * "경기:화성시" 형태의 --only 필터 파싱. 세션94 단계 C.
 * @param {string[]} argv
 * @returns {string | null}
 */
export function parseOnlyFilter(argv) {
  const arg = argv.find(a => a.startsWith("--only="));
  if (!arg) return null;
  const val = arg.split("=")[1] || "";
  if (!val.includes(":")) {
    throw new Error(`--only 형식 오류: '${val}' — 'region:gu' 형식 필요 (예: 경기:화성시)`);
  }
  return val;
}

async function main() {
  if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");
  const monthsArg = process.argv.find(a => a.startsWith("--months="));
  const monthCount = monthsArg ? parseInt(monthsArg.split("=")[1] || "6", 10) : 6;
  const onlyFilter = parseOnlyFilter(process.argv);

  const sb = getMibuyangSupabase();

  log(PHASE, "아파트 목록 조회...");
  // 세션534: 무정렬 OFFSET → 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
  // id 는 커서 전용(다운스트림 미사용) — select 에 넣어야 selectAll 이 커서를 만든다.
  /** @type {Array<{ region: string; gu: string | null }>} */
  const allApts = /** @type {Array<{ region: string; gu: string | null }>} */ (/** @type {unknown} */ (
    await selectAll((s) => s.from("apartments").select("id,region,gu"), sb, "id")
  ));

  // 세종은 구·군 없이 단일 LAWD_CD(36110)만 유효 — gu 없어도 한 번만 수집
  // 세션95 단계 B: apartments.gu 가 미래 경로로 오염돼도 normalizeGu 로 방어
  /** @type {RegionGuPair[]} */
  let regionGuPairs = [...new Set(allApts.map(a => a.region + "|" + (normalizeGu(a.region, a.gu) ?? "")))]
    .map(s => { const [region, gu] = s.split("|"); return { region: region || "", gu: gu || null }; })
    .filter(rg => rg.region && (rg.gu || rg.region === "세종"));

  if (onlyFilter) {
    const before = regionGuPairs.length;
    regionGuPairs = regionGuPairs.filter(rg => `${rg.region}:${rg.gu ?? ""}` === onlyFilter);
    log(PHASE, `--only=${onlyFilter} 필터 적용: ${before} → ${regionGuPairs.length}개 지역`);
    if (regionGuPairs.length === 0) {
      logError(PHASE, `--only=${onlyFilter} 적중 pair 0건 — apartments 에 해당 region/gu 없음`);
      process.exit(0);
    }
  }

  log(PHASE, "아파트 " + allApts.length + "건, " + regionGuPairs.length + "개 지역");

  /** @type {string[]} */
  const months = [];
  const now = new Date();
  for (let m = 1; m <= monthCount; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    months.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0"));
  }
  log(PHASE, "수집 기간: " + months[months.length - 1] + " ~ " + months[0] + " (" + months.length + "개월)");

  /** @type {TradeRow[]} */
  const rows = [];
  let apiCalls = 0;
  let apiFails = 0;
  let fallbackUsed = false;
  /** @type {Set<string>} */
  const seen = new Set();

  const rpt = createReporter(PHASE);

  // 세션 490: job timeout(180분) 도달은 SIGKILL(grace 0)이라 아래 upsert 가 아예 실행되지 않는다
  // → 210개 지역을 다 돌고 마지막에 한 번 저장하는 이 수집기는 수집분을 전량 잃는다
  //   (7/6 run 28821807904 = 120분 일하고 저장 0건, 국토부 API 가 6월 대비 1.8배 지연).
  // 예산 안에서 스스로 멈춰 "여기까지 수집분"이라도 저장한다. 6개월 롤링 창이라 다음 회차에 메워진다.
  const startedAt = Date.now();
  const budgetArg = process.argv.find((a) => a.startsWith("--budget-min="));
  const budgetMin = budgetArg ? parseInt(budgetArg.replace("--budget-min=", ""), 10) : DEFAULT_BUDGET_MIN;
  let budgetHit = false;

  // 세션589: trade_deals — (코드·월·종류) 열쇠별 교체 저장. 회차 id 하나 + 회차 시작 시각(이보다 먼저 든 batch 만 지운다).
  // ⚠️ 이 저장은 예산(budgetMin) **안쪽** 반복에서 돈다 — 첫 정기 회차 소요를 9/06 과 맞대 예산 근거를 다시 잰다
  //    (collector-timeout-rootcause-analysis.md — 예산에 닿으면 뒤 지역은 trades 까지 빠진다).
  const batchId = randomUUID();
  const saver = makeDealSaver({ sb, months, batchId, runStartedAt: new Date().toISOString(), dryRun, sleep });
  const { onDeals, stats: dealStats, zeroKeySamples, heldKeySamples } = saver;

  for (const rg of regionGuPairs) {
    if (rpt.interrupted()) break;
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
    // 세션589: 화성시는 4코드(41591·41593·41595·41597) — 그 밖은 지금처럼 getLawdCd 한 코드
    const codes = GU_LAWD_CODES(rg.region, rg.gu);
    if (!codes.length) { log(PHASE, "  " + rg.region + " " + rg.gu + ": 법정동코드 없음"); continue; }

    const result = await collectRegion(rg, codes, months, {
      seen,
      fallbackUsed,
      // 세션 344: graceful shutdown (내부 trade type loop) — 코드·종류 한 번마다 본다
      shouldStop: () => (rpt.interrupted() ? "interrupt" : budgetExceeded(startedAt, budgetMin) ? "budget" : null),
      onDeals,
    });
    rows.push(...result.rows);
    apiCalls += result.apiCalls;
    apiFails += result.apiFails;
    fallbackUsed = result.fallbackUsed;
    dealStats.failKeys += result.dealErrors;
    if (result.stopped === "budget") budgetHit = true;
    if (budgetHit) break;  // 내부 loop 가 예산으로 끊겼으면 지역 loop 도 종료

    if (apiCalls % 50 === 0 && apiCalls > 0) log(PHASE, "  API " + apiCalls + "건, " + rows.length + "건 수집 중...");
  }

  if (budgetHit) {
    log(PHASE, `[budget] ${budgetMin}분 예산 초과 — 여기까지 수집분(${rows.length}건)을 저장하고 종료. 남은 지역은 다음 회차 6개월 창이 메움`);
  }

  const saleCount = rows.filter(r => r.trade_type === "sale").length;
  const jeonseCount = rows.filter(r => r.trade_type === "jeonse").length;
  const presaleCount = rows.filter(r => r.trade_type === "presale").length;
  log(PHASE, "API 총 " + apiCalls + "건 호출" + (fallbackUsed ? " (매매: 기존 API 폴백)" : " (매매: AptTradeDev)"));
  log(PHASE, "수집 완료: 매매 " + saleCount + "건 + 전세 " + jeonseCount + "건 + 분양권 " + presaleCount + "건 = 총 " + rows.length + "건");

  // 세션589: trade_deals 요약 한 줄 — 입주권 제외는 skip(실패 아님), 쓰기 실패 열쇠는 fail(회차 실패)
  const n = (/** @type {number} */ v) => v.toLocaleString("en-US");
  log(PHASE, `trade_deals${dryRun ? "(dry-run · 쓰지 않음)" : ""}: 열쇠 ${n(dealStats.keys)}개 · ` +
    (dryRun ? `만들 행 ${n(dealStats.rows)}행` : `넣음 ${n(dealStats.inserted)}행 · 지움 ${n(dealStats.deleted)}행`) +
    ` · 입주권 제외 ${n(dealStats.skippedOwnership)}행 · 0건 열쇠 ${n(dealStats.zeroKeys)}개` +
    (dealStats.heldKeys ? ` · 보류 열쇠 ${n(dealStats.heldKeys)}개` : "") +
    (dealStats.warnKeys ? ` · 옛 회차 지우기 경고 ${n(dealStats.warnKeys)}개` : "") +
    (dealStats.dupSkips ? ` · 같은 코드 중복 건너뜀 ${n(dealStats.dupSkips)}번` : "") +
    (dealStats.failKeys ? ` · 쓰기 실패 열쇠 ${n(dealStats.failKeys)}개` : "") +
    (zeroKeySamples.length ? ` (0건 예: ${zeroKeySamples.join(", ")})` : "") +
    (heldKeySamples.length ? ` (보류 예: ${heldKeySamples.join(", ")})` : ""));
  rpt.skip(dealStats.skippedOwnership);
  rpt.fail(dealStats.failKeys);
  // 보류(급감 차단기)·옛 회차 지우기 경고는 실패가 아니다 — 아침 브리핑의 경고 단계 줄(WARN_STEPS)로만 남긴다
  const dealWarn = [
    ...(dealStats.heldKeys ? [`trade_deals_held_${dealStats.heldKeys}`] : []),
    ...(dealStats.warnKeys ? [`trade_deals_cleanup_warn_${dealStats.warnKeys}`] : []),
  ];

  if (dryRun) {
    if (rows.length > 0) {
      log(PHASE, "샘플 (처음 5건):");
      for (const r of rows.slice(0, 5)) {
        console.log("  " + r.region + " " + r.gu + " " + (r.dong || "") + " | " + r.deal_month + " | " + r.trade_type + " | " + r.area + "m2 | " + r.price + "만원 | " + r.floor + "층");
      }
    }
    log(PHASE, "dry-run 완료");
    return;
  }

  // ⚠️ 세션 503: 여기서 그냥 return 하면 아래 recordCollectorRun 에 영영 못 와서 `collector_runs` 에
  // **행 자체가 안 남고**, monitor 는 그 표를 보므로 사고를 영영 못 본다. 실제로 8/06 회차가 2시간 31분
  // 동안 전 호출 `fetch failed` 로 0건을 받고도 워크플로가 **초록불**로 끝나, 실거래가 2개월 공백을
  // 아무도 모르고 지나갔다. 0건이어도 반드시 기록을 남기고, 실패 때문이면 빨간불로 끝낸다.
  if (!rows.length) {
    log(PHASE, `수집된 데이터 없음 (API 호출 성공 ${apiCalls}건 / 실패 ${apiFails}건)`);
    rpt.fail(apiFails);
    await recordCollectorRun(PHASE, rpt.summary());
    if (apiFails > 0) {
      logError(PHASE, `수집 0건 + API 실패 ${apiFails}건 — 외부 API 또는 네트워크 사고로 판정하고 실패 종료`);
      process.exit(1);
    }
    return;
  }

  // 배치 내 중복 키 제거 (ON CONFLICT DO UPDATE 동일 행 2회 방지)
  const CONFLICT_COLS = "region,gu,deal_month,area,price,floor,trade_type";
  /** @type {Map<string, TradeRow>} */
  const dedup = new Map();
  for (const r of rows) {
    const key = [r.region, r.gu, r.deal_month, r.area, r.price, r.floor, r.trade_type].join("|");
    dedup.set(key, r);
  }
  const uniqueRows = [...dedup.values()];
  if (uniqueRows.length < rows.length) {
    log(PHASE, `중복 제거: ${rows.length}건 → ${uniqueRows.length}건 (-${rows.length - uniqueRows.length}건)`);
  }

  log(PHASE, "trades 테이블 저장 중 (upsert)...");
  const inserted = await upsertBatch("trades", uniqueRows, CONFLICT_COLS, 500, sb);
  log(PHASE, "trades 테이블 " + inserted + "/" + rows.length + "건 저장 완료");

  await recordApiQuota("collect-trades", "MOLIT_KEY", apiCalls);
  if (dealStats.failKeys) {
    logError(PHASE, `trade_deals 쓰기 실패 열쇠 ${dealStats.failKeys}개 — trades 는 저장됨(${inserted}건). 회차는 실패로 끝낸다`);
  }

  rpt.success(inserted);
  rpt.fail(uniqueRows.length - inserted);
  const result = rpt.summary();
  if (dealWarn.length && result.status === "success") Object.assign(result, { errorMessage: `WARN_STEPS: ${dealWarn.join(",")}` });
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });

// 테스트용 순수 함수 export
export { getLawdCd, extractItems, getTag, TRADE_CONFIGS, buildApiUrl };
