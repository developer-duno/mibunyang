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
  getLawdCd, normalizeGu, budgetExceeded,
} from "./_shared.mjs";

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
 * @returns {Promise<{ rows: TradeRow[]; apiCalls: number; apiFails: number; fallbackUsed: boolean }>}
 */
export async function fetchTradeRows(lawdCd, months, type, rg, seen, prevFallbackUsed) {
  const config = TRADE_CONFIGS[type];
  /** @type {TradeRow[]} */
  const rows = [];
  let apiCalls = 0;
  // 세션 503: 실패 횟수를 세어 올린다. 안 세면 "전부 실패해서 0건"과 "부를 게 없어서 0건"이
  // 구분되지 않아, 아래 main() 이 두 경우를 똑같이 성공으로 끝낸다(그게 2개월 공백을 숨겼다).
  let apiFails = 0;
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
      apiFails++;
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${config.label} API 실패 ${lawdCd}/${month}: ${msg}`);
    }
    await sleep(200);
  }
  return { rows, apiCalls, apiFails, fallbackUsed };
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

  for (const rg of regionGuPairs) {
    if (rpt.interrupted()) break;
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
    const lawdCd = getLawdCd(rg.region, rg.gu);
    if (!lawdCd) { log(PHASE, "  " + rg.region + " " + rg.gu + ": 법정동코드 없음"); continue; }

    for (const type of /** @type {TradeType[]} */ (["sale", "jeonse", "presale"])) {
      if (rpt.interrupted()) break;  // 세션 344: graceful shutdown (내부 trade type loop)
      if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
      const result = await fetchTradeRows(lawdCd, months, type, rg, seen, fallbackUsed);
      rows.push(...result.rows);
      apiCalls += result.apiCalls;
      apiFails += result.apiFails;
      fallbackUsed = result.fallbackUsed;
    }
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
