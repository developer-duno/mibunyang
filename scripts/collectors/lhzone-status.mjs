// @ts-check
/**
 * 택지정보시스템 지구단계정보 → `dev_plans.progression_step` (kind=lh_zone) 채움 (세션522)
 *
 * 왜 만드나: `dev_plans` 의 lh_zone 1,174건은 V-WORLD 경계(폴리곤) 레이어에서 왔는데,
 * 그 레이어에는 진행단계 필드가 아예 없어 `progression_step` 이 **전부 NULL** 이다.
 * 같은 지구의 조성 단계는 국토부 택지정보시스템(openapi.jigu.go.kr)이 월간으로 공개한다 —
 * 그 장부를 읽어 이름으로 맞춰 채운다.
 *
 * ⚠️ 이 수집기는 **데이터 보강만** 한다. 점수는 그대로다 —
 * `transit-match.mjs` 의 `filterCityDevs` 는 `kind === "jigu" && progression_step === "부분준공"`
 * 만 제외하므로 lh_zone 에 값이 들어가도 현행 점수 계산에 영향이 0이다.
 * (준공 제외·경계 재설계는 승인이 필요한 별도 트랙.)
 *
 * ── 출처 3단계 사슬 (2026-08-22 라이브 실측, 무인증) ───────────────────────────
 *   1. POST /down/title.json      body `table=BLS5_DSTRC_MASTER`
 *      → `{ ntfcDe: "2026-06", stdrDe: "2026-07-31", ... }`  (최신 고시월)
 *   2. POST /api/list.json        body `tNm=...&table=...&ctprvn=00&ntfcDe=<1의 ntfcDe>`
 *      → `list[]` 에서 `fileTy==="csv" && ctprvn==="00"` 행의 `fileNo` · `stdrDe`(YYYYMMDD)
 *      ⚠️ `tNm` 을 빼면 406 이 온다(실측). `table` 만으로는 부족하다.
 *   3. POST /openApi/down.do?fileTy=csv&stdrDe=<YYYYMMDD>&ctprvn=00&table=...&fileNo=<fileNo>
 *      → ZIP(약 62KB) 안에 `BLS5_DSTRC_MASTER.csv` (**EUC-KR**, 전국 1,371행, 21컬럼)
 *
 * CSV 헤더: 지구지정번호,지구명,고시사업지구명,단계코드,단계코드명,단계진행코드,단계진행코드명,…
 * 단계코드명 8종(2026-07-31 기준 분포): 준공 888 · 실시변경 275 · 실시계획 82 · 지구지정 45 ·
 * 개발변경 36 · 부분준공 19 · 지구변경 13 · 개발계획 13.
 *
 * 사용:
 *   node scripts/collectors/lhzone-status.mjs             (dev_plans UPDATE)
 *   node scripts/collectors/lhzone-status.mjs --dry-run   (다운로드·매칭까지만, DB 쓰기 0 + collector_runs 기록 0)
 *
 * 필요 env: SUPABASE_URL, SUPABASE_SERVICE_KEY (외부 API 키 불필요 — data.go.kr 쿼터 0 소모)
 */
import { Buffer } from "node:buffer";

import unzipper from "unzipper";

import {
  loadEnv, getSupabase, log, logError,
  createReporter, recordCollectorRun, selectAll,
} from "./_shared.mjs";

const PHASE = "lhzone-status";

const BASE = "https://openapi.jigu.go.kr";
const TABLE = "BLS5_DSTRC_MASTER";
/** 전국 파일의 시도 코드(`ctprvn`). 시도별로 쪼개 받을 이유가 없다 — 전국 파일이 62KB 다. */
const CTPRVN_ALL = "00";
/** DB 를 갱신할 대상. 이 수집기는 lh_zone 만 건드린다(네이버 축·산업단지 축 무관). */
const TARGET_KIND = "lh_zone";
/** 한 번에 병렬로 던지는 UPDATE 수. 청크 경계마다 graceful 중단을 본다. */
const UPDATE_CHUNK = 50;

const FORM_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
};

/**
 * 이름 정규화에서 떼어낼 꼬리말.
 * 같은 지구를 V-WORLD 는 "광교지구 택지개발사업", 택지정보시스템은 "광교지구 택지개발사업"
 * 처럼 적지만 한쪽만 "지구"·"구역"·"사업" 을 붙이는 경우가 흔하다 — 끝에서부터 반복해 떼어낸다.
 * ⚠️ 순서가 아니라 **반복**이 핵심이다("…도시개발사업지구" → 지구 → 사업 → 도시개발).
 */
const NAME_SUFFIXES = ["구역", "지구", "택지개발", "공공주택", "도시개발", "사업"];

/**
 * 색인·**정확 일치**에 쓸 최소 길이. 두 글자짜리 정식 이름이 실제로 있다("광교지구
 * 택지개발사업" → "광교") — 정확 일치는 이름 전체가 같다는 뜻이라 짧아도 위험하지 않다.
 */
const MIN_KEY_LEN = 2;

/**
 * **포함 매칭**에 쓸 최소 길이. 정확 일치와 달리 포함은 조각이 짧을수록 아무 지구에나
 * 걸린다("광교" 가 "광교신도시"·"광교테크노밸리" 를 동시에 물어 정밀도가 무너진다).
 */
const MIN_CONTAIN_LEN = 3;

/**
 * CSV 한 줄 → 필드 배열. 이 파일은 전 필드가 큰따옴표로 감싸여 있지만
 * 빈 값은 따옴표 없이 `,,` 로 오므로(실측) 인용/비인용을 함께 다뤄야 한다.
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
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
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * CSV 전문 → `{컬럼명: 값}` 배열. 첫 줄이 헤더.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseStageCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  /** @type {Record<string, string>[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    /** @type {Record<string, string>} */
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (fields[c] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

/**
 * 지구명 정규화 — 괄호 안 내용 제거 → 공백 제거 → 꼬리말 반복 제거.
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function normalizeZoneName(name) {
  if (!name) return "";
  let s = String(name).replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of NAME_SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return s;
}

/**
 * @typedef {{ byKey: Map<string, Set<string>>, keys: string[] }} StageIndex
 */

/**
 * CSV 행들 → `정규화 이름 → 단계코드명 집합` 색인.
 * 한 키에 서로 다른 단계가 둘 이상 달리면 **모호**로 남겨 매칭 단계에서 버린다
 * (틀린 단계를 채우느니 비워 두는 편이 낫다).
 * @param {Record<string, string>[]} rows
 * @returns {StageIndex}
 */
export function buildStageIndex(rows) {
  /** @type {Map<string, Set<string>>} */
  const byKey = new Map();
  for (const row of rows) {
    const step = (row["단계코드명"] ?? "").trim();
    if (!step) continue;
    for (const raw of [row["지구명"], row["고시사업지구명"]]) {
      const key = normalizeZoneName(raw);
      if (key.length < MIN_KEY_LEN) continue;
      const set = byKey.get(key);
      if (set) set.add(step);
      else byKey.set(key, new Set([step]));
    }
  }
  return { byKey, keys: [...byKey.keys()] };
}

/**
 * @typedef {{ via: "exact" | "contains" | "ambiguous" | "none", step?: string, key?: string }} StageMatch
 */

/**
 * 지구 이름 하나를 색인에 맞춘다 — **엄격 2단계**.
 *   ① 정규화 이름이 정확히 일치하고 단계가 하나뿐일 때
 *   ② 한쪽이 다른 쪽을 포함하는 후보가 **딱 하나**이고 그 단계가 하나뿐일 때
 * 후보가 둘 이상이거나 한 키에 단계가 여럿이면 `ambiguous` 로 버린다.
 * @param {string | null | undefined} zoneName
 * @param {StageIndex} index
 * @returns {StageMatch}
 */
export function matchZoneStage(zoneName, index) {
  const target = normalizeZoneName(zoneName);
  if (target.length < MIN_KEY_LEN) return { via: "none" };

  const exact = index.byKey.get(target);
  if (exact) {
    if (exact.size > 1) return { via: "ambiguous" };
    return { via: "exact", step: [...exact][0], key: target };
  }

  if (target.length < MIN_CONTAIN_LEN) return { via: "none" };
  const candidates = index.keys.filter(
    (k) => k.length >= MIN_CONTAIN_LEN && (k.includes(target) || target.includes(k)),
  );
  if (candidates.length === 0) return { via: "none" };
  if (candidates.length > 1) return { via: "ambiguous" };
  const steps = index.byKey.get(candidates[0]);
  if (!steps || steps.size > 1) return { via: "ambiguous" };
  return { via: "contains", step: [...steps][0], key: candidates[0] };
}

/**
 * 1단계 — 최신 고시월(`ntfcDe`).
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function fetchLatestNtfcDe(fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}/down/title.json`, {
    method: "POST",
    headers: FORM_HEADERS,
    body: `table=${TABLE}`,
  });
  if (!res.ok) throw new Error(`title.json HTTP ${res.status}`);
  const json = /** @type {Record<string, unknown>} */ (await res.json());
  const ntfcDe = typeof json.ntfcDe === "string" ? json.ntfcDe : "";
  if (!ntfcDe) throw new Error(`title.json 응답에 ntfcDe 없음: ${JSON.stringify(json).slice(0, 200)}`);
  return ntfcDe;
}

/**
 * 2단계 — 그 고시월의 전국 CSV 파일 메타(`fileNo` · `stdrDe`).
 * @param {string} ntfcDe
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ fileNo: string, stdrDe: string, fileNm: string }>}
 */
export async function fetchCsvFileMeta(ntfcDe, fetchImpl = fetch) {
  // ⚠️ tNm 을 빼면 406 (실측). table 과 값이 같아도 둘 다 보내야 한다.
  const body = `tNm=${TABLE}&table=${TABLE}&ctprvn=${CTPRVN_ALL}&ntfcDe=${encodeURIComponent(ntfcDe)}`;
  const res = await fetchImpl(`${BASE}/api/list.json`, { method: "POST", headers: FORM_HEADERS, body });
  if (!res.ok) throw new Error(`list.json HTTP ${res.status}`);
  const json = /** @type {{ list?: Record<string, unknown>[] }} */ (await res.json());
  const list = Array.isArray(json.list) ? json.list : [];
  const hit = list.find((r) => String(r.fileTy) === "csv" && String(r.ctprvn) === CTPRVN_ALL);
  if (!hit) throw new Error(`list.json 에 전국 csv 항목 없음 (총 ${list.length}건, ntfcDe=${ntfcDe})`);
  return {
    fileNo: String(hit.fileNo ?? ""),
    stdrDe: String(hit.stdrDe ?? ""),
    fileNm: String(hit.fileNm ?? ""),
  };
}

/**
 * 3단계 — ZIP 다운로드 → 내부 CSV 를 EUC-KR 로 디코드.
 * @param {{ fileNo: string, stdrDe: string }} meta
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function downloadStageCsv(meta, fetchImpl = fetch) {
  const url = `${BASE}/openApi/down.do?fileTy=csv&stdrDe=${meta.stdrDe}&ctprvn=${CTPRVN_ALL}&table=${TABLE}&fileNo=${meta.fileNo}`;
  const res = await fetchImpl(url, { method: "POST", headers: FORM_HEADERS });
  if (!res.ok) throw new Error(`down.do HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  log(PHASE, `zip ${(buffer.length / 1024).toFixed(0)}KB 받음 — 압축 해제`);
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files.find((f) => /\.csv$/i.test(f.path));
  if (!entry) throw new Error(`zip 내부 .csv 없음 (파일 ${directory.files.length}개)`);
  return decodeStageCsvBuffer(await entry.buffer());
}

/**
 * zip 내부 CSV 바이트 → 문자열.
 * 이 CSV 는 UTF-8 이 아니라 **EUC-KR** 이다(실측). `buffer.toString()` 으로 읽으면 한글이
 * 전부 깨져 이름 매칭이 통째로 0건이 된다 — 에러도 안 나고 "0건 매칭" 으로만 보인다.
 * @param {Buffer | Uint8Array} raw
 * @returns {string}
 */
export function decodeStageCsvBuffer(raw) {
  return new TextDecoder("euc-kr").decode(raw);
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logError(PHASE, "SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요");
    process.exit(1);
  }

  const rpt = createReporter(PHASE); // ⚠️ 루프 이전에 등록해야 SIGTERM 핸들러가 붙는다
  const sb = getSupabase();

  const ntfcDe = await fetchLatestNtfcDe();
  const meta = await fetchCsvFileMeta(ntfcDe);
  log(PHASE, `고시월 ${ntfcDe} · 전국 csv fileNo=${meta.fileNo} stdrDe=${meta.stdrDe} (${meta.fileNm})`);

  const csvText = await downloadStageCsv(meta);
  const csvRows = parseStageCsv(csvText);
  if (csvRows.length === 0) throw new Error("CSV 파싱 결과 0행 — 형식이 바뀌었는지 확인 필요");
  const index = buildStageIndex(csvRows);
  log(PHASE, `CSV ${csvRows.length}행 · 색인 키 ${index.keys.length}개`);

  const zones = await selectAll(
    (s) => s.from("dev_plans").select("id, name, progression_step").eq("kind", TARGET_KIND),
    sb,
  );
  log(PHASE, `대상 ${TARGET_KIND} ${zones.length}건`);

  /** @type {{ id: string, name: string, step: string, via: string, key: string, prev: string | null }[]} */
  const matched = [];
  let ambiguous = 0;
  let unmatched = 0;
  /** @type {Record<string, number>} */
  const stepDist = {};
  for (const zone of zones) {
    const m = matchZoneStage(zone.name, index);
    if (!m.step) {
      if (m.via === "ambiguous") ambiguous++;
      else unmatched++;
      continue;
    }
    matched.push({
      id: zone.id, name: zone.name, step: m.step, via: m.via, key: m.key ?? "",
      prev: zone.progression_step ?? null,
    });
    stepDist[m.step] = (stepDist[m.step] ?? 0) + 1;
  }

  const exactN = matched.filter((m) => m.via === "exact").length;
  const containsN = matched.length - exactN;
  log(PHASE, `매칭 ${matched.length}/${zones.length} (정확 ${exactN} · 포함 ${containsN}) · 모호 스킵 ${ambiguous} · 미매칭 ${unmatched}`);
  log(PHASE, `단계 분포: ${Object.entries(stepDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  // 포함 매칭은 정확 일치보다 약한 근거라 전량을 남긴다 — 사람이 훑어 오탐을 잡을 수 있게.
  for (const m of matched.filter((x) => x.via === "contains")) {
    log(PHASE, `  [포함] ${m.name} → ${m.key} = ${m.step}`);
  }

  if (dryRun) {
    log(PHASE, "dry-run — DB 쓰기 생략");
    rpt.success(matched.length);
    rpt.skip(ambiguous + unmatched);
    const dryResult = rpt.summary();
    log(PHASE, "[runs] dry-run — collector_runs 기록 skip");
    if (dryResult.fail > 0) process.exit(1);
    return;
  }

  let changed = 0;
  for (let i = 0; i < matched.length; i += UPDATE_CHUNK) {
    if (rpt.interrupted()) break; // graceful shutdown — 청크 경계에서 멈춘다
    const chunk = matched.slice(i, i + UPDATE_CHUNK);
    await Promise.all(chunk.map(async (m) => {
      // 값이 이미 같으면 쓰지 않는다(멱등). 그래도 ok 로 세는 이유 = 매달 "ok=0 빈 성공"
      // 으로 보여 monitor ⑤-a 가 거짓 경보를 내는 것을 막기 위해서다.
      if (m.prev === m.step) { rpt.success(); return; }
      const { error } = await sb.from("dev_plans").update({ progression_step: m.step }).eq("id", m.id);
      if (error) {
        logError(PHASE, `UPDATE 실패 (${m.name}): ${error.message}`);
        rpt.fail();
        return;
      }
      changed++;
      rpt.success();
    }));
  }
  rpt.skip(ambiguous + unmatched);
  log(PHASE, `DB 반영: 값 변경 ${changed}건 (이미 같아서 생략한 건은 성공으로 셈)`);

  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
