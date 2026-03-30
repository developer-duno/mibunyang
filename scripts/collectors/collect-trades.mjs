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
  upsertBatch, createReporter, recordApiQuota, fetchWithRetry,
  REGION_LAWD_PREFIX, GU_LAWD_MAP, getLawdCd,
} from "./_shared.mjs";

loadEnv();

const PHASE = "trades";
const API_KEY = process.env.MOLIT_KEY;
const API_BASE = "https://apis.data.go.kr/1613000";

function extractItems(xml) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(m => m[0]);
}

// regex 캐싱 — 호출당 new RegExp 생성 방지
const TAG_REGEX_CACHE = {};
function getTag(item, tag) {
  if (!TAG_REGEX_CACHE[tag]) TAG_REGEX_CACHE[tag] = new RegExp("<" + tag + ">([^<]*)</" + tag + ">");
  const r = item.match(TAG_REGEX_CACHE[tag]);
  return r ? r[1].trim() : "";
}

// ── 거래타입별 설정 ──────────────────────────────────────────
const TRADE_CONFIGS = {
  sale: {
    endpoint: `${API_BASE}/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`,
    fallbackEndpoint: `${API_BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`,
    label: "매매",
    priceTag: "dealAmount",
    validate: (price, area) => price > 0 && area > 0,
    buildRow: (item, base, isFallback) => {
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

function buildApiUrl(endpoint, lawdCd, month) {
  return `${endpoint}?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=1&numOfRows=9999`;
}

async function fetchXml(url) {
  const res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return res ? await res.text() : null;
}

/**
 * 단일 거래타입의 모든 월 데이터를 수집.
 * @returns {{ rows: object[], apiCalls: number, fallbackUsed: boolean }}
 */
export async function fetchTradeRows(lawdCd, months, type, rg, seen, prevFallbackUsed) {
  const config = TRADE_CONFIGS[type];
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

        const base = {
          region: rg.region, gu: rg.gu, dong, deal_month: month,
          area: Math.round(area * 100) / 100, price, floor, build_year: buildYear,
        };
        rows.push(config.buildRow(item, base, regionFallback));
      }
      apiCalls++;
    } catch (err) {
      logError(PHASE, `${config.label} API 실패 ${lawdCd}/${month}: ${err.message}`);
    }
    await sleep(200);
  }
  return { rows, apiCalls, fallbackUsed };
}

async function main() {
  if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");
  const monthsArg = process.argv.find(a => a.startsWith("--months="));
  const monthCount = monthsArg ? parseInt(monthsArg.split("=")[1], 10) : 6;

  const sb = getMibuyangSupabase();

  log(PHASE, "아파트 목록 조회...");
  const PAGE = 1000;
  const allApts = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from("apartments").select("region,gu").range(from, from + PAGE - 1);
    if (error) throw new Error("apartments 조회 실패: " + error.message);
    if (!data || data.length === 0) break;
    allApts.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const regionGuPairs = [...new Set(allApts.map(a => a.region + "|" + a.gu))]
    .map(s => { const [region, gu] = s.split("|"); return { region, gu }; })
    .filter(rg => rg.region && rg.gu);

  log(PHASE, "아파트 " + allApts.length + "건, " + regionGuPairs.length + "개 지역");

  const months = [];
  const now = new Date();
  for (let m = 1; m <= monthCount; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    months.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0"));
  }
  log(PHASE, "수집 기간: " + months[months.length - 1] + " ~ " + months[0] + " (" + months.length + "개월)");

  const rows = [];
  let apiCalls = 0;
  let fallbackUsed = false;
  const seen = new Set();

  for (const rg of regionGuPairs) {
    const lawdCd = getLawdCd(rg.region, rg.gu);
    if (!lawdCd) { log(PHASE, "  " + rg.region + " " + rg.gu + ": 법정동코드 없음"); continue; }

    for (const type of ["sale", "jeonse", "presale"]) {
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

  const rpt = createReporter(PHASE);
  rpt.success(inserted);
  rpt.fail(uniqueRows.length - inserted);
  const result = rpt.summary();
  if (result.fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });

// 테스트용 순수 함수 export
export { getLawdCd, extractItems, getTag, TRADE_CONFIGS, buildApiUrl };
