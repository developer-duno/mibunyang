// @ts-check
/**
 * MOLIT 공동주택공시가격 CSV → regions.housing_price SMALLINT 채움 (세션 247 W6-C v2)
 *
 * 자원: data.go.kr #3073746 (국토교통부_주택 공시가격 정보_20250626, 활용신청 불필요)
 * 다운로드: 151MB zip → 3.45GB raw CSV (15,580,435 행, UTF-8) → streaming parse → 시군구 평균 (만원/㎡)
 * 헤더: 기준연도, 기준월, 법정동코드, 도로명주소, 시도, 시군구, 읍면, 동리, 특수지코드, 본번, 부번, 특수지명,
 *       단지명, 동명, 호명, 전용면적, 공시가격, 단지코드, 동코드, 호코드, 건축물대장PK
 *
 * 사용:
 *   node scripts/collectors/collect-housing-price.mjs            (regions 업데이트)
 *   node scripts/collectors/collect-housing-price.mjs --dry-run  (미리보기, DB 미저장)
 *
 * 필요 env: SUPABASE_URL, SUPABASE_SERVICE_KEY (API 키 불필요 — 공개 다운로드)
 */
import { Buffer } from "node:buffer";
import readline from "node:readline";
import unzipper from "unzipper";
import { loadEnv, getSupabase, log, logError, createReporter, recordCollectorRun, REGION_MAP, today } from "./_shared.mjs";

loadEnv();

// data.go.kr 3073746 직접 다운로드 URL (세션 247 실증, atchFileId=FILE_000000003525375)
const DOWNLOAD_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003525375&fileDetailSn=1&insertDataPrcus=N";

// zip 내부 파일명이 EUC-KR/CP949 인코딩되어 unzipper UTF-8 가정 시 mojibake → 한글 정규식 매칭 불가.
// 대안: .csv 확장자 + 압축 해제 크기 최대 파일 = raw 데이터 (샘플 21MB << raw 3.45GB).
const CSV_EXT_PATTERN = /\.csv$/i;

/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
function resolveRegion(fullName) {
  if (!fullName) return null;
  if (REGION_MAP[fullName]) return REGION_MAP[fullName];
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

/**
 * @param {string} sido   - 시도 (예: "서울특별시")
 * @param {string} sigungu - 시군구 (예: "종로구")
 * @returns {{region: string, gu: string} | null}
 */
function parseGu(sido, sigungu) {
  const region = resolveRegion(sido);
  if (!region) return null;
  if (region === "세종") return { region, gu: "세종시" };
  if (!sigungu) return null;
  return { region, gu: sigungu };
}

/**
 * 호별 공시가격(원) + 전용면적(㎡) → 만원/㎡.
 * @param {Record<string, unknown>} row
 * @returns {number | null}
 */
function unitPriceManwon(row) {
  const pc = parseFloat(String(row["공시가격"] ?? "0"));
  const ar = parseFloat(String(row["전용면적"] ?? "0"));
  if (!pc || !ar || ar <= 0) return null;
  return pc / ar / 10000;
}

/**
 * CSV 라인 1줄 파싱 — 헤더 21 컬럼 정합 + 따옴표 escape 처리.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 헤더 + 1 라인 → {컬럼명: 값} 객체.
 * @param {string[]} headers
 * @param {string[]} fields
 * @returns {Record<string, string>}
 */
function rowFromFields(headers, fields) {
  /** @type {Record<string, string>} */
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = fields[i] ?? "";
  }
  return obj;
}

/**
 * @param {Iterable<Record<string, unknown>>} rows
 * @returns {Map<string, { region: string, gu: string, avgUnitPrice: number, sampleCount: number }>}
 */
function aggregateBySggu(rows) {
  /** @type {Map<string, { region: string, gu: string, sum: number, count: number }>} */
  const acc = new Map();
  for (const row of rows) {
    const sido = String(row["시도"] ?? "");
    const sigungu = String(row["시군구"] ?? "");
    const parsed = parseGu(sido, sigungu);
    if (!parsed) continue;

    const unit = unitPriceManwon(row);
    if (unit === null) continue;

    const key = `${parsed.region}|${parsed.gu}`;
    const existing = acc.get(key) ?? { region: parsed.region, gu: parsed.gu, sum: 0, count: 0 };
    existing.sum += unit;
    existing.count += 1;
    acc.set(key, existing);
  }

  /** @type {Map<string, { region: string, gu: string, avgUnitPrice: number, sampleCount: number }>} */
  const result = new Map();
  for (const [key, v] of acc) {
    if (v.count < 1) continue;
    result.set(key, {
      region: v.region,
      gu: v.gu,
      avgUnitPrice: v.sum / v.count,
      sampleCount: v.count,
    });
  }
  return result;
}

/**
 * zip 다운로드 + streaming unzip + CSV 라인 단위 yield.
 * @returns {AsyncGenerator<Record<string, string>>}
 */
async function* streamRows() {
  log("fetch", `다운로드 시작: ${DOWNLOAD_URL.slice(0, 80)}...`);
  // data.go.kr 가 빈 User-Agent 요청을 ECONNRESET 으로 거부 — 브라우저 UA 명시 의무.
  // 추가: TLS keep-alive 한계로 transient ECONNRESET 가능 → 3회 재시도 (지수 백오프)
  /** @type {Buffer | null} */
  let buffer = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(DOWNLOAD_URL, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      log("fetch", `  attempt ${attempt}/3 실패 (${msg}) — 재시도 대기`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
    }
  }
  if (!buffer) throw new Error(`다운로드 3회 재시도 실패: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  log("fetch", `zip ${(buffer.length / 1024 / 1024).toFixed(1)}MB 받음 — 압축 해제 중`);

  const directory = await unzipper.Open.buffer(buffer);
  // .csv 확장자 + 최대 uncompressedSize = raw 데이터 (샘플 21MB << raw 3.45GB)
  const csvEntries = directory.files.filter(f => CSV_EXT_PATTERN.test(f.path));
  if (!csvEntries.length) {
    throw new Error(`zip 내부 .csv 파일 없음. 총 ${directory.files.length} 파일`);
  }
  csvEntries.sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  const entry = csvEntries[0];
  log("fetch", `entry size: ${(entry.uncompressedSize / 1024 / 1024 / 1024).toFixed(2)}GB`);

  const stream = entry.stream();
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  /** @type {string[] | null} */
  let headers = null;
  let lineCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!headers) {
      headers = fields.map(h => h.replace(/^"|"$/g, ""));
      continue;
    }
    lineCount++;
    if (lineCount % 1_000_000 === 0) log("parse", `  ${lineCount.toLocaleString()} 행 처리 중...`);
    yield rowFromFields(headers, fields);
  }
  log("parse", `총 ${lineCount.toLocaleString()} 행 파싱 완료`);
}

/**
 * CSV 가 말하는 기준연도를 채택하되, 받은 파일이 낡았으면 실패시킨다 (세션 504).
 *
 * `DOWNLOAD_URL` 의 `atchFileId` 는 원본이 갱신되면 바뀐다(차기 등록 예정 2026-10-30).
 * 그런데 그 값이 코드에 박혀 있어서, 새 파일이 나와도 **조용히 옛 파일을 계속 받는다**.
 * 같은 함정을 `transport-tago.mjs` 가 이미 주석으로 경고하고 있다 — 여기엔 가드가 없었다.
 *
 * 받은 CSV 의 기준연도가 현재보다 2년 이상 뒤처지면 그 신호로 본다.
 * 1년 차이는 정상이다 — 공시가격은 그 해 중반에 공표돼 다음 해까지 최신본으로 쓰인다.
 *
 * @param {number | null} csvBaseYear CSV 첫 유효 행의 `기준연도` (못 읽었으면 null)
 * @param {number} currentYear
 * @returns {number}
 */
export function resolveTargetYear(csvBaseYear, currentYear) {
  if (csvBaseYear === null) {
    // 못 읽었으면 옛 동작(현재 연도)으로 폴백하되 조용히 넘어가지는 않는다 — 헤더 변경 신호다.
    logError("year", "CSV 에서 기준연도를 읽지 못했습니다 — 현재 연도로 폴백(헤더가 바뀌었는지 확인 필요)");
    return currentYear;
  }
  const lag = currentYear - csvBaseYear;
  if (lag >= 2) {
    throw new Error(
      `CSV 기준연도 ${csvBaseYear} 가 현재(${currentYear})보다 ${lag}년 뒤처집니다 — ` +
      `DOWNLOAD_URL 의 atchFileId 가 낡아 옛 파일을 받고 있을 수 있습니다. data.go.kr #3073746 재확인 필요.`,
    );
  }
  if (lag < 0) {
    throw new Error(`CSV 기준연도 ${csvBaseYear} 가 현재(${currentYear})보다 미래입니다 — 파싱 오류 의심.`);
  }
  return csvBaseYear;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  log("init", "공동주택공시가격 CSV 수집 시작 (data.go.kr 3073746)");

  // streaming generator → 점진 집계 (250 시군구 acc 만 메모리 누적, 1,500만 행 raw 미보존)
  /** @type {Map<string, { region: string, gu: string, sum: number, count: number }>} */
  const acc = new Map();
  // 세션 504: CSV 의 실제 기준연도. 매 행 첫 컬럼이 `기준연도` 라 첫 유효 행에서 공짜로 읽힌다
  // (옛 주석은 "streaming 한계로 보류" 라 했지만 한계가 아니었다).
  /** @type {number | null} */
  let csvBaseYear = null;
  for await (const row of streamRows()) {
    if (csvBaseYear === null) {
      const y = Number(String(row["기준연도"] ?? "").trim());
      if (Number.isInteger(y) && y >= 2000 && y <= 2100) csvBaseYear = y;
    }
    const sido = String(row["시도"] ?? "");
    const sigungu = String(row["시군구"] ?? "");
    const parsed = parseGu(sido, sigungu);
    if (!parsed) continue;
    const unit = unitPriceManwon(row);
    if (unit === null) continue;
    const key = `${parsed.region}|${parsed.gu}`;
    const existing = acc.get(key) ?? { region: parsed.region, gu: parsed.gu, sum: 0, count: 0 };
    existing.sum += unit;
    existing.count += 1;
    acc.set(key, existing);
  }

  /** @type {Array<{ region: string, gu: string, avgUnitPrice: number, sampleCount: number }>} */
  const aggregated = [];
  for (const v of acc.values()) {
    if (v.count < 1) continue;
    aggregated.push({
      region: v.region,
      gu: v.gu,
      avgUnitPrice: v.sum / v.count,
      sampleCount: v.count,
    });
  }
  log("calc", `${aggregated.length}건 시군구 평균 집계 완료`);

  // 데이터 기준일 — CSV 가 실제로 말하는 연도를 쓴다 (세션 504).
  //
  // 옛 코드는 `new Date().getFullYear()` 를 썼다. 원본은 "2025.1.1. 기준" 공시가격인데
  // 2026년에 돌리면 recorded_at 이 2026-01-01 로 찍혀 **1년 미래로 라벨**된다.
  // 내년 1월에 또 돌면 같은 2025 데이터가 2027-01-01 로 찍힌다 — 시계열이 통째로 어긋난다.
  const targetYear = resolveTargetYear(csvBaseYear, new Date().getFullYear());
  const recordedAt = `${targetYear}-01-01`;  // 공시기준일은 매년 1월 1일
  log("calc", `기준연도 ${targetYear} (CSV 기준연도 ${csvBaseYear ?? "미확인"}) → recorded_at=${recordedAt}`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — DB 미저장");
    console.log("\n시군구별 sample (상위 10):");
    aggregated.sort((a, b) => b.avgUnitPrice - a.avgUnitPrice);
    for (const r of aggregated.slice(0, 10)) {
      const sm = Math.round(r.avgUnitPrice);
      console.log(`  ${r.region} ${r.gu}: ${sm.toLocaleString()} 만원/㎡ (sample ${r.sampleCount.toLocaleString()}건)`);
    }
    return;
  }

  const sb = getSupabase();
  const rpt = createReporter("housing-price");
  let saved = 0;
  for (const r of aggregated) {
    if (rpt.interrupted()) break;
    const sm = Math.round(r.avgUnitPrice);
    // SMALLINT 범위 -32768~32767. 만원/㎡ 단위 = 일반 100~5000 범위.
    const clamped = Math.max(0, Math.min(32767, sm));

    /** @type {any} */
    let q = sb.from("regions")
      .update({ housing_price: clamped })
      .eq("region", r.region)
      .eq("gu", r.gu)
      .eq("recorded_at", recordedAt);

    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      logError("regions", `UPDATE 실패 ${r.region} ${r.gu}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      const { error: insErr } = await sb.from("regions").insert([{
        region: r.region,
        gu: r.gu,
        housing_price: clamped,
        recorded_at: recordedAt,
      }]);
      if (insErr) {
        logError("regions", `INSERT 실패 ${r.region} ${r.gu}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions ${saved}/${aggregated.length}건 housing_price 채움 (${today()})`);
  const result = rpt.summary();

  // API 키 사용 안 함 → recordApiQuota 호출 안 함 (data.go.kr 공개 다운로드)
  await recordCollectorRun("housing-price", result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

export { resolveRegion, parseGu, unitPriceManwon, aggregateBySggu, parseCsvLine, rowFromFields };
