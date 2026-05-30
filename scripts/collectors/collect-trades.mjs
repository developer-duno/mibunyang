// @ts-check
/**
 * 국토부 실거래가 수집기 — trades 테이블 적재
 *
 * 사용법:
 *   node scripts/collectors/collect-trades.mjs          (trades 테이블 적재)
 *   node scripts/collectors/collect-trades.mjs --dry-run (미리보기만)
 *   node scripts/collectors/collect-trades.mjs --months=12 (12개월 수집)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, MOLIT_KEY
 */
import {
  loadEnv, getMibuyangSupabase, log, logError, sleep,
  upsertBatch, createReporter, recordApiQuota, recordCollectorRun, fetchWithRetry,
  getLawdCd, normalizeGu,
} from "./_shared.mjs";

loadEnv();

const PHASE = "trades";
const API_KEY = process.env.MOLIT_KEY;
const API_BASE = "https://apis.data.go.kr/1613000";

/**
 * @typedef {{ region: string; gu: string | null }} RegionGuPair
 * @typedef {{ region: string; gu: string | null; dong: string | null; deal_month: string; area: number; price: number; floor: number | null; build_year: number | null; trade_type?: string; deposit?: number | null; apt_name?: string | null; dealing_type?: string | null; cancel_date?: string | null }} TradeRow
 * @typedef {"sale" | "jeonse" | "presale"} TradeType
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
 * @returns {Promise<{ rows: TradeRow[]; apiCalls: number; fallbackUsed: boolean }>}
 */
export async function fetchTradeRows(lawdCd, months, type, rg, seen, prevFallbackUsed) {
  const config = TRADE_CONFIGS[type];
  /** @type {TradeRow[]} */
  const rows = [];
  let apiCalls = 0;
  let fallbackUsed = prevFallbackUsed || false;
  let regionFallback = false;

  for (const month of months) {
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

        const floor = parseInt(getTag(item, "floor") || "0") || null;
        const buildYear = parseInt(getTag(item, "buildYear") || "0") || null;
        const dong = getTag(item, "umdNm") || null;
        const key = `${rg.region}|${rg.gu}|${month}|${area}|${price}|${floor}|${type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        /** @type {TradeRow} */
        const base = {
          region: rg.region, gu: rg.gu, dong, deal_month: month,
          area: Math.round(area * 100) / 100, price, floor, build_year: buildYear,
        };
        rows.push(config.buildRow(item, base, regionFallback));
      }
      apiCalls++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${config.label} API 실패 ${lawdCd}/${month}: ${msg}`);
    }
    await sleep(200);
  }
  return { rows, apiCalls, fallbackUsed };
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
  const PAGE = 1000;
  /** @type {Array<{ region: string; gu: string | null }>} */
  const allApts = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from("apartments").select("region,gu").range(from, from + PAGE - 1);
    if (error) throw new Error("apartments 조회 실패: " + error.message);
    if (!data || data.length === 0) break;
    allApts.push(...(/** @type {Array<{ region: string; gu: string | null }>} */ (data)));
    if (data.length < PAGE) break;
    from += PAGE;
  }

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
  let fallbackUsed = false;
  /** @type {Set<string>} */
  const seen = new Set();

  const rpt = createReporter(PHASE);

  for (const rg of regionGuPairs) {
    if (rpt.interrupted()) break;
    const lawdCd = getLawdCd(rg.region, rg.gu);
    if (!lawdCd) { log(PHASE, "  " + rg.region + " " + rg.gu + ": 법정동코드 없음"); continue; }

    for (const type of /** @type {TradeType[]} */ (["sale", "jeonse", "presale"])) {
      if (rpt.interrupted()) break;  // 세션 344: graceful shutdown (내부 trade type loop)
      const result = await fetchTradeRows(lawdCd, months, type, rg, seen, fallbackUsed);
      rows.push(...result.rows);
      apiCalls += result.apiCalls;
      fallbackUsed = result.fallbackUsed;
    }

    if (apiCalls % 50 === 0 && apiCalls > 0) log(PHASE, "  API " + apiCalls + "건, " + rows.length + "건 수집 중...");
  }

  const saleCount = rows.filter(r => r.trade_type === "sale").length;
  const jeonseCount = rows.filter(r => r.trade_type === "jeonse").length;
  const presaleCount = rows.filter(r => r.trade_type === "presale").length;
  log(PHASE, "API 총 " + apiCalls + "건 호출" + (fallbackUsed ? " (매매: 기존 API 폴백)" : " (매매: AptTradeDev)"));
  log(PHASE, "수집 완료: 매매 " + saleCount + "건 + 전세 " + jeonseCount + "건 + 분양권 " + presaleCount + "건 = 총 " + rows.length + "건");

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

  if (!rows.length) { log(PHASE, "수집된 데이터 없음"); return; }

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

  rpt.success(inserted);
  rpt.fail(uniqueRows.length - inserted);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });

// 테스트용 순수 함수 export
export { getLawdCd, extractItems, getTag, TRADE_CONFIGS, buildApiUrl };
