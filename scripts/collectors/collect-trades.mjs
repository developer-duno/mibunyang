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
  loadEnv, getMibuyangSupabase, log, logError, sleep, upsertBatch,
} from "./_shared.mjs";

loadEnv();

const PHASE = "trades";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요"); process.exit(1); }

const REGION_LAWD_PREFIX = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

const GU_LAWD_MAP = {
  // 서울
  "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215",
  "동대문구": "11230", "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320",
  "노원구": "11350", "은평구": "11380", "서대문구": "11410", "마포구": "11440", "양천구": "11470",
  "강서구": "11500", "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
  "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710", "강동구": "11740",
  // 부산
  "중구": "26110", "서구": "26140", "동구": "26170", "영도구": "26200", "부산진구": "26230",
  "동래구": "26260", "남구": "26290", "북구": "26320", "해운대구": "26350", "사하구": "26380",
  "금정구": "26410", "강서구": "26440", "연제구": "26470", "수영구": "26500", "사상구": "26530",
  "기장군": "26710",
  // 인천
  "중구": "28110", "동구": "28120", "미추홀구": "28177", "연수구": "28185", "남동구": "28200",
  "부평구": "28237", "계양구": "28245", "서구": "28260", "강화군": "28710", "옹진군": "28720",
  // 경기 주요
  "수원시": "41110", "성남시": "41130", "의정부시": "41150", "안양시": "41170", "부천시": "41190",
  "광명시": "41210", "평택시": "41220", "동두천시": "41250", "안산시": "41270", "고양시": "41280",
  "과천시": "41290", "구리시": "41310", "남양주시": "41360", "오산시": "41370", "시흥시": "41390",
  "군포시": "41410", "의왕시": "41430", "하남시": "41450", "용인시": "41460", "파주시": "41480",
  "이천시": "41500", "안성시": "41550", "김포시": "41570", "화성시": "41590", "광주시": "41610",
  "양주시": "41630", "포천시": "41650", "여주시": "41670",
  // 대구
  "중구": "27110", "동구": "27140", "서구": "27170", "남구": "27200", "북구": "27230",
  "수성구": "27260", "달서구": "27290", "달성군": "27710",
  // 대전
  "동구": "30110", "중구": "30140", "서구": "30170", "유성구": "30200", "대덕구": "30230",
  // 광주
  "동구": "29110", "서구": "29140", "남구": "29155", "북구": "29170", "광산구": "29200",
  // 울산
  "중구": "31110", "남구": "31140", "동구": "31170", "북구": "31200", "울주군": "31710",
  // 세종
  "세종시": "36110",
};

// 동명이구 처리
const REGION_GU_OVERRIDE = {
  "서울:중구": "11140", "서울:강서구": "11500",
  "부산:중구": "26110", "부산:서구": "26140", "부산:동구": "26170",
  "부산:남구": "26290", "부산:북구": "26320", "부산:강서구": "26440",
  "인천:중구": "28110", "인천:동구": "28120", "인천:서구": "28260",
  "대구:중구": "27110", "대구:동구": "27140", "대구:서구": "27170",
  "대구:남구": "27200", "대구:북구": "27230",
  "대전:동구": "30110", "대전:중구": "30140", "대전:서구": "30170",
  "광주:동구": "29110", "광주:서구": "29140", "광주:남구": "29155", "광주:북구": "29170",
  "울산:중구": "31110", "울산:남구": "31140", "울산:동구": "31170", "울산:북구": "31200",
};

function getLawdCd(region, gu) {
  const ov = REGION_GU_OVERRIDE[region + ":" + gu];
  if (ov) return ov;
  // 구/군 이름으로 직접 매핑 시도
  if (GU_LAWD_MAP[gu]) return GU_LAWD_MAP[gu];
  // 시 이름 시도 (경기도 등)
  const shortGu = gu.replace(/시$|군$|구$/, "");
  for (const [name, code] of Object.entries(GU_LAWD_MAP)) {
    if (name.includes(shortGu)) return code;
  }
  // 시도 코드 + 000 (시도 전체)
  const prefix = REGION_LAWD_PREFIX[region];
  return prefix ? prefix + "000" : null;
}

function extractItems(xml) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(m => m[0]);
}

function getTag(item, tag) {
  const r = item.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">"));
  return r ? r[1].trim() : "";
}

async function fetchApi(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) return await res.text();
      if (res.status === 429) { await sleep((i + 1) * 3000); continue; }
      if (i === retries - 1) throw new Error("HTTP " + res.status);
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep((i + 1) * 2000);
    }
  }
}

async function main() {
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
  const seen = new Set();

  for (const rg of regionGuPairs) {
    const lawdCd = getLawdCd(rg.region, rg.gu);
    if (!lawdCd) { log(PHASE, "  " + rg.region + " " + rg.gu + ": 법정동코드 없음"); continue; }

    // 매매 실거래
    for (const month of months) {
      try {
        const url = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=" + API_KEY + "&LAWD_CD=" + lawdCd + "&DEAL_YMD=" + month + "&pageNo=1&numOfRows=9999";
        const xml = await fetchApi(url);
        if (!xml) continue;
        for (const item of extractItems(xml)) {
          const price = parseInt((getTag(item, "dealAmount") || "0").replace(/,/g, ""));
          const area = parseFloat(getTag(item, "excluUseAr") || "0");
          const floor = parseInt(getTag(item, "floor") || "0") || null;
          const buildYear = parseInt(getTag(item, "buildYear") || "0") || null;
          const dong = getTag(item, "umdNm") || null;
          if (price <= 0 || area <= 0) continue;
          const key = rg.region + "|" + rg.gu + "|" + month + "|" + area + "|" + price + "|" + floor + "|sale";
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ region: rg.region, gu: rg.gu, dong, deal_month: month, area: Math.round(area * 100) / 100, price, floor, build_year: buildYear, trade_type: "sale", deposit: null });
        }
        apiCalls++;
      } catch (err) {
        if (apiCalls === 0) logError(PHASE, "매매 API 실패 " + lawdCd + "/" + month + ": " + err.message);
      }
      await sleep(200);
    }

    // 전세 실거래
    for (const month of months) {
      try {
        const url = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=" + API_KEY + "&LAWD_CD=" + lawdCd + "&DEAL_YMD=" + month + "&pageNo=1&numOfRows=9999";
        const xml = await fetchApi(url);
        if (!xml) continue;
        for (const item of extractItems(xml)) {
          const deposit = parseInt((getTag(item, "deposit") || "0").replace(/,/g, ""));
          const monthlyRent = parseInt((getTag(item, "monthlyRent") || "0").replace(/,/g, ""));
          const area = parseFloat(getTag(item, "excluUseAr") || "0");
          const floor = parseInt(getTag(item, "floor") || "0") || null;
          const buildYear = parseInt(getTag(item, "buildYear") || "0") || null;
          const dong = getTag(item, "umdNm") || null;
          if (deposit <= 0 || monthlyRent !== 0 || area <= 0) continue;
          const key = rg.region + "|" + rg.gu + "|" + month + "|" + area + "|" + deposit + "|" + floor + "|jeonse";
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ region: rg.region, gu: rg.gu, dong, deal_month: month, area: Math.round(area * 100) / 100, price: deposit, floor, build_year: buildYear, trade_type: "jeonse", deposit });
        }
        apiCalls++;
      } catch (err) {
        if (apiCalls === 0) logError(PHASE, "전세 API 실패: " + err.message);
      }
      await sleep(200);
    }

    if (apiCalls % 50 === 0 && apiCalls > 0) log(PHASE, "  API " + apiCalls + "건, " + rows.length + "건 수집 중...");
  }

  const saleCount = rows.filter(r => r.trade_type === "sale").length;
  const jeonseCount = rows.filter(r => r.trade_type === "jeonse").length;
  log(PHASE, "API 총 " + apiCalls + "건 호출");
  log(PHASE, "수집 완료: 매매 " + saleCount + "건 + 전세 " + jeonseCount + "건 = 총 " + rows.length + "건");

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
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
