// @ts-check
/**
 * 청약홈 공식 분양 일정 + 평형 수집기
 *
 * API: 한국부동산원 청약홈 분양정보 조회 서비스 (data.go.kr 15098547)
 *   - getAPTLttotPblancDetail: APT 분양정보 상세 (일정 12종 ISO, 시행/시공/주소/공급)
 *   - getAPTLttotPblancMdl:    주택형(평형)별 면적/세대수/특공유형/최고가
 *
 * 기존 collect-applyhome.mjs(경쟁률, getRemndrLttotPblancCmpet)와 별개 서비스 — 에러 격리.
 * apartments base 컬럼은 안 건드림 → 미분양 stage·기존 날짜 보존.
 * 매칭된 단지만 presale_schedule_official(일정 + 규제 7종) + applyhome_unit_supply(평형) 적재.
 * prices 는 빈칸만 채운다(세션622): 가격 행이 하나도 없는 비임대 단지에 84㎡ 에 가장 가까운 평형의
 *   최고가를 house_type "applyhome_rep" 로 1행(평당가 = 전용면적 기준). 평형 재료 = DB applyhome_unit_supply
 *   누적 행 + 이번 회차 행. 이미 가격 행이 있는 단지는 건드리지 않는다.
 * 공고 → 단지 짝짓기 v3(세션630, 설계서 docs/superpowers/plans/2026-10-12-applyhome-notice-decisions.md):
 *   사람 판정 파일(docs/audits/applyhome-notice-decisions.json) → 동점 집합 뒤 `(오)`·블록·차수 어긋남·rejected 제외 →
 *   같은 묶음이면 첫 행 → 다른 묶음 동점은 블록 글자 + 네이버 지문으로 가름(못 가르면 안 붙임) → 자동 결과만 시도 게이트.
 *   쌓인 틀린 행은 "다른 묶음이 이겼다" 등 양성 증거가 있을 때만 지운다(`planNoticeReconcile` · 차단기 30행/10% ·
 *   넘으면 "기존 쌍만" 다시 받고 failure `NTC_BREAKER` — 사람이 `--apply-from` 으로 푼다).
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome-detail.mjs              (적재 · 정리는 차단기 안에서만)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run    (매칭 미리보기만)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run --out=<새 파일>
 *     (정리 계획 — 지우기·넣기·근거 없어 유지·사람 판정 필요 명단 — 을 JSON 으로 저장, 있는 파일이면 던짐)
 *   node scripts/collectors/collect-applyhome-detail.mjs --apply-from=<승인한 계획 파일>
 *     (지우는 행·넣는 쌍이 그 파일과 같을 때만 정리 · 다르면 "기존 쌍만" + failure `NTC_PLAN_MISMATCH`)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run --impact-out=<절대경로>
 *     (prices 빈칸 채움 계획을 JSON 으로 저장 — dry-run 에서만 허용)
 *
 * 필요 환경변수: MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, createReporter,
  selectAll, upsertBatch, stringSimilarity,
  recordApiQuota, recordCollectorRun, REGION_MAP, MERGED_SIDO_RE, resolveRegionName, today,
} from "./_shared.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";
import { stripRoundWords, phaseConsistent, blockConflict } from "./_kakao-poi.mjs";
import { withComputedComplexKeys } from "./_trade-links.mjs";
import { parseComplexExceptions } from "./_same-complex.mjs";

loadEnv();

const PHASE = "applyhome-detail";
const API_KEY = process.env.MOLIT_KEY;
const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
let apiCalls = 0;

// 매칭 안전 게이트 (plan: sim>=0.85 AND region 일치 — 동명이지역 오매칭 차단)
const MATCH_SIM_MIN = 0.85;
// 주소 첫 낱말이 시도가 아니라 게이트를 못 쓰는 공고(세션630 실측 40건)는 이름이 거의 같거나(≥0.95)
// 후보 행의 시군구가 주소 앞 두 낱말에 있을 때만 붙인다("부산모라 행복주택" 같은 흔한 이름이 남의 지역 행에 붙는 것을 막는다).
const GATE_UNKNOWN_SIM_MIN = 0.95;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
/** 공고 → 단지 사람 판정 파일(세션630). 고치는 순서 = PR(사장님 승인) → 미리보기(--out) → --apply-from. */
export const NOTICE_DECISIONS_PATH = join(REPO_ROOT, "docs", "audits", "applyhome-notice-decisions.json");
/** 같은 단지 예외 명단 — 빈 묶음 열쇠를 채울 때 assign-complex-keys.mjs 와 같은 명단을 쓴다. */
const EXCEPTIONS_PATH = join(REPO_ROOT, "docs", "audits", "same-complex-exceptions.json");

// 쌓인 틀린 행 정리 차단기 — 지우는 일정 행만 센다(분모 = 일정 표 행 수). 넘으면 "기존 쌍만" + failure.
export const NOTICE_BREAKER_MAX_ROWS = 30;
export const NOTICE_BREAKER_RATIO = 0.1;
const DELETE_CHUNK = 500;

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string; PBLANC_NO?: string; HOUSE_NM?: string; HSSPLY_ADRES?: string | null;
 *   RCRIT_PBLANC_DE?: string | null; SPSPLY_RCEPT_BGNDE?: string | null; SPSPLY_RCEPT_ENDDE?: string | null;
 *   GNRL_RNK1_CRSPAREA_RCPTDE?: string | null; GNRL_RNK1_CRSPAREA_ENDDE?: string | null;
 *   GNRL_RNK2_CRSPAREA_RCPTDE?: string | null; GNRL_RNK2_CRSPAREA_ENDDE?: string | null;
 *   PRZWNER_PRESNATN_DE?: string | null; CNTRCT_CNCLS_BGNDE?: string | null; CNTRCT_CNCLS_ENDDE?: string | null;
 *   MVN_PREARNGE_YM?: string | null; TOT_SUPLY_HSHLDCO?: string | number | null; PBLANC_URL?: string | null;
 *   BSNS_MBY_NM?: string | null; CNSTRCT_ENTRPS_NM?: string | null;
 *   MDAT_TRGET_AREA_SECD?: string | null; PARCPRC_ULS_AT?: string | null; SPECLT_RDN_EARTH_AT?: string | null;
 *   IMPRMN_BSNS_AT?: string | null; PUBLIC_HOUSE_EARTH_AT?: string | null; LRSCL_BLDLND_AT?: string | null;
 *   NPLN_PRVOPR_PUBLIC_HOUSE_AT?: string | null; [k: string]: unknown }} DetailRow
 * @typedef {{ HOUSE_MANAGE_NO?: string; PBLANC_NO?: string; MODEL_NO?: string; HOUSE_TY?: string;
 *   SUPLY_AR?: string | number; SUPLY_HSHLDCO?: string | number; SPSPLY_HSHLDCO?: string | number;
 *   MNYCH_HSHLDCO?: string | number; NWBB_HSHLDCO?: string | number; LFE_FRST_HSHLDCO?: string | number;
 *   OLD_PARNTS_SUPORT_HSHLDCO?: string | number; YGMN_HSHLDCO?: string | number; NWWDS_HSHLDCO?: string | number;
 *   INSTT_RECOMEND_HSHLDCO?: string | number; ETC_HSHLDCO?: string | number;
 *   LTTOT_TOP_AMOUNT?: string | number; [k: string]: unknown }} MdlRow
 * @typedef {{ id: string; name: string; region: string | null; presale_type?: string | null; gu?: string | null;
 *   lat?: number | null; lng?: number | null; complex_key?: string | null; naver_presale_no?: string | number | null;
 *   presale_recruit_date?: string | null; presale_general_supply?: number | string | null;
 *   units?: number | null; unit_source?: string | null }} AptRow
 * @typedef {"manual" | "skip" | "noMatch" | "conflict_all" | "rejected_all" | "single" | "same_bundle"
 *   | "tie_fingerprint" | "tie_both" | "tie_block" | "tie_unresolved" | "gate" | "gate_unknown" | "manual_missing"} MatchHow
 * @typedef {{ id: string; why: "officetel" | "conflict" | "rejected" }} Excluded
 * @typedef {{ id: string; name: string; key: string }} TieCandidate
 * @typedef {{ aptIds: string[]; how: MatchHow; sim: number; excluded?: Excluded[]; candidates?: TieCandidate[] }} MatchDetail
 * @typedef {{ active: Map<string, string[]>; skip: Set<string>; rejected: Set<string> }} NoticeDecisionIndex
 * @typedef {ReturnType<typeof buildUnitRow> & { source?: string | null }} UnitRow
 *   source = DB 칸(기본 'apt' 원 공고 · 'remndr' 잔여세대, collect-applyhome-remndr.mjs). 이번 회차 행엔 없다.
 */

// ── odcloud 페이지네이션 (collect-applyhome.mjs:33-61 패턴) ──
/**
 * @param {string} op
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchAllPages(op) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: API_KEY || "" });
    const res = await fetch(`${BASE}/${op}?${params}`, { signal: AbortSignal.timeout(30000) });
    apiCalls++;
    if (!res.ok) throw new Error(`HTTP ${res.status} (${op})`);
    const json = /** @type {{ data?: Record<string, unknown>[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    all.push(...data);
    log(PHASE, `  ${op} page ${page}: ${data.length}건 (누적 ${all.length}/${json.totalCount})`);
    if (all.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
  }
  return all;
}

// ── 이름 정규화 (괄호/공백 제거) ──
/** @param {string | null | undefined} s */
export function normName(s) {
  return (s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").trim();
}

// ── 주소 → region 약칭 (HSSPLY_ADRES 시도 첫 토큰) ──
// head(시도명 토큰)만으로 판정 + 정식명 우선(긴 키 먼저) 매칭.
// 세션 360 버그 정정: 이전엔 addr 전체에서 약칭 부분문자열을 잡아
// "경기도 광주시"가 광주광역시로 오파싱 → region 게이트에서 경기 단지 오차단.
/** @param {string | null | undefined} addr @returns {string | null} */
export function addrToRegion(addr) {
  if (!addr) return null;
  const parts = addr.trim().split(/\s+/);
  const head = parts[0] || "";
  // 세션545: 통합 시도("전남광주통합특별시")는 시도명만으로 못 가른다 — 시군구(parts[1])로
  // 광주/전남을 가르는 분할 헬퍼를 **가장 먼저** 태운다.
  //
  // ⚠️ 아래 긴 키 우선 순회에 맡기면 안 된다: 통합 이름은 `REGION_MAP` 에 없고
  //    `head.startsWith("전남")` 이 참이라 **27 시군구가 전부 "전남"으로** 떨어진다.
  //    그러면 청약홈이 새 시도명을 쓰기 시작하는 순간 광주 단지가 전부
  //    `matchDetailToApt` 의 region 게이트에서 오차단된다(일정·평형이 통째로 안 붙는다).
  const split = resolveRegionName(head, parts[1] ?? null);
  if (split) return split;
  // ⚠️ 헬퍼가 **못 가른 통합 시도**는 아래 순회에 넘기지 않는다(세션545 2차 리뷰):
  //    `head.startsWith("전남")` 이 참이라 "전남" 이 나오는데, 그건 판정이 아니라 글자 우연이다.
  //    둘째 토큰이 시군구가 아닌 주소(지구·블록)에서 광주 단지가 "전남" 으로 굳으면
  //    `matchDetailToApt` 의 region 게이트가 그 단지를 통째로 거부한다.
  //    null 을 주면 게이트를 건너뛰고 이름 유사도(≥0.85)만으로 판정한다 — 모른다고 말하는 쪽이 맞다.
  if (/^전남광주통합/.test(head)) return null;
  // 정식명(예: "경기도")이 약칭(예: "경기")보다 먼저 매칭되도록 긴 키 우선 정렬
  const entries = Object.entries(REGION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [full, short] of entries) {
    if (head === full || head.startsWith(full)) return short;
  }
  const stripped = head.replace(/(특별자치|특별|광역)?(시|도)$/, "");
  return stripped || null;
}

// ── 시도 게이트용 주소 → region (세션630) ──
/**
 * 짝짓기 게이트 전용 — 첫 낱말이 `REGION_MAP` 의 정식명·약칭일 때만 약칭, 통합 시도면 시군구로 가른 값,
 * **그 밖은 null(모름)**. `addrToRegion` 은 첫 낱말이 시도가 아니어도 접미사만 뗀 글자를 돌려줘("광주시"→"광주"
 * = 광역시 오판 · "김포"→"김포") 게이트가 엉뚱한 공고를 버렸다(공고 2,900건 중 40건). `addrToRegion` 은
 * backfill-presale-area-notices.mjs 가 그 동작에 기대므로 고치지 않고 게이트만 이 함수로 바꾼다.
 * @param {string | null | undefined} addr
 * @returns {string | null}
 */
export function gateRegionOf(addr) {
  if (!addr) return null;
  const parts = addr.trim().split(/\s+/);
  const head = parts[0] || "";
  if (Object.prototype.hasOwnProperty.call(REGION_MAP, head)) return REGION_MAP[head];
  if (MERGED_SIDO_RE.test(head)) return resolveRegionName(head, parts[1] ?? null);
  return null;
}

// ── 사람 판정 파일 (세션630) ──
const NOTICE_STATUSES = new Set(["active", "rejected", "skip"]);

/**
 * 공고 → 단지 사람 판정 파일을 검사해 돌려준다. 꼴 `{ note, updatedAt, decisions: [{ house_manage_no, apartment_id, status,
 * names, why, verified_by, approved }] }`. status = active(그 공고를 그 행에 · 시도 게이트 면제 · 여러 줄 가능) ·
 * rejected(그 행엔 절대 안 붙임) · skip(우리 목록에 그 단지가 없음 — apartment_id null). 틀린 줄은 전부 던진다
 * (조용히 빼면 사람이 정한 판정이 사라진다 — completion-decisions 와 같은 엄격함).
 * @param {unknown} raw JSON.parse 결과
 * @returns {{ note: unknown; updatedAt: unknown; decisions: Array<{ house_manage_no: string; apartment_id: string | null; status: "active" | "rejected" | "skip" }> }}
 */
export function parseNoticeDecisions(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("공고 판정 파일이 객체가 아닙니다");
  const obj = /** @type {{ note?: unknown; updatedAt?: unknown; decisions?: unknown }} */ (raw);
  if (!Array.isArray(obj.decisions)) throw new Error("공고 판정 파일에 decisions 배열이 없습니다");
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{ house_manage_no: string; apartment_id: string | null; status: "active" | "rejected" | "skip" }>} */
  const decisions = [];
  for (const d of obj.decisions) {
    const e = /** @type {Record<string, unknown>} */ (d ?? {});
    const hmn = e.house_manage_no;
    if (typeof hmn !== "string" || !/^\d{10}$/.test(hmn)) throw new Error(`공고 판정 파일: 공고번호는 10자리 숫자 글자여야 합니다 — ${JSON.stringify(hmn)}`);
    const status = e.status;
    if (typeof status !== "string" || !NOTICE_STATUSES.has(status)) throw new Error(`공고 판정 파일: status 는 active·rejected·skip 만 받습니다 — ${hmn}: ${JSON.stringify(status)}`);
    const aptId = e.apartment_id;
    if (status === "skip") {
      if (aptId != null) throw new Error(`공고 판정 파일: skip 줄은 apartment_id 가 null 이어야 합니다 — ${hmn}`);
    } else if (typeof aptId !== "string" || aptId.trim() === "") {
      throw new Error(`공고 판정 파일: ${status} 줄은 apartment_id 가 있어야 합니다 — ${hmn}`);
    }
    for (const f of ["names", "why", "verified_by", "approved"]) {
      const v = e[f];
      if (typeof v !== "string" || v.trim() === "") throw new Error(`공고 판정 파일: ${f} 가 비어 있습니다 — ${hmn}`);
    }
    const pair = `${hmn}|${aptId ?? ""}`;
    if (seen.has(pair)) throw new Error(`공고 판정 파일: 같은 (공고번호, 행)이 두 번 나왔습니다 — ${pair}`);
    seen.add(pair);
    decisions.push({ house_manage_no: hmn, apartment_id: /** @type {string | null} */ (aptId ?? null), status: /** @type {"active" | "rejected" | "skip"} */ (status) });
  }
  return { note: obj.note, updatedAt: obj.updatedAt, decisions };
}

/**
 * 판정 줄 → 찾기 쉬운 꼴. rejected 는 "공고번호|행 id" 열쇠.
 * @param {ReturnType<typeof parseNoticeDecisions>["decisions"]} decisions
 * @returns {NoticeDecisionIndex}
 */
export function indexNoticeDecisions(decisions) {
  /** @type {NoticeDecisionIndex} */
  const idx = { active: new Map(), skip: new Set(), rejected: new Set() };
  for (const d of decisions) {
    if (d.status === "skip") idx.skip.add(d.house_manage_no);
    else if (d.status === "rejected") idx.rejected.add(`${d.house_manage_no}|${d.apartment_id}`);
    else {
      const list = idx.active.get(d.house_manage_no) ?? [];
      list.push(/** @type {string} */ (d.apartment_id));
      idx.active.set(d.house_manage_no, list);
    }
  }
  return idx;
}

// ── 짝짓기 v3 (세션630) ──
/** @param {AptRow} a */
const bundleKeyOf = (a) => (a.complex_key ? a.complex_key : a.id);
/** @param {AptRow[]} rows */
const byId = (rows) => [...rows].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/**
 * 네이버 지문 — ap 번호 주인 행(id = ap-<naver_presale_no>)이고 네이버가 준 공고일(전체 날짜 꼴만)·일반공급 세대수가
 * 청약홈 원문과 같다. **양성 증거로만** 쓴다(불일치로 후보를 버리지 않는다 — 네이버 날짜가 다른 회차일 수 있다).
 * @param {DetailRow} row
 * @param {AptRow} a
 */
function fingerprintMatches(row, a) {
  if (a.naver_presale_no == null || a.id !== `ap-${a.naver_presale_no}`) return false;
  const date = a.presale_recruit_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== row.RCRIT_PBLANC_DE) return false;
  if (a.presale_general_supply == null || row.TOT_SUPLY_HSHLDCO == null) return false;
  return Number(a.presale_general_supply) === Number(row.TOT_SUPLY_HSHLDCO);
}

/**
 * 시도 게이트(자동 결과만). 주소 첫 낱말이 시도면 접두 비교, 모르면 유사도 ≥0.95 또는 후보 시군구가 주소 앞 두 낱말 안.
 * @param {DetailRow} row
 * @param {AptRow} chosen
 * @param {number} sim
 * @returns {"ok" | "gate" | "gate_unknown"}
 */
function regionGate(row, chosen, sim) {
  const gr = gateRegionOf(row.HSSPLY_ADRES);
  if (gr) {
    if (!chosen.region) return "ok";
    return gr.startsWith(chosen.region) || chosen.region.startsWith(gr) ? "ok" : "gate";
  }
  if (sim >= GATE_UNKNOWN_SIM_MIN) return "ok";
  const gu = String(chosen.gu ?? "").trim().split(/\s+/)[0] ?? "";
  if (!gu) return "gate_unknown";
  const words = String(row.HSSPLY_ADRES ?? "").trim().split(/\s+/).slice(0, 2);
  const guShort = gu.replace(/(시|군|구)$/, "");
  return words.some((w) => w === gu || (guShort !== "" && w === guShort)) ? "ok" : "gate_unknown";
}

/**
 * 청약홈 Detail row → apartments 짝짓기 v3(순수 함수 · DB 0). 빈 결과도 `how` 를 알려 준다(정리 계획이 쓴다).
 * 순서 = ① 판정 파일(active 면 그 행들 · 게이트 면제 / skip 이면 비움) ② 유사도 ≥0.85 동점 집합 `tops` 를 **먼저** 정하고
 * 그 뒤 `(오)` 행·블록·차수 어긋남(회차 낱말을 양쪽 다 뗀 뒤)·rejected 쌍을 뺀다(먼저 빼면 유사도 낮은 엉뚱한 후보가 이긴다)
 * ③ 남은 묶음 1개 → 첫 행(id 오름차순) ④ 묶음 2개+ → 블록 글자(B)·네이버 지문(F)으로 가름, 못 가르면 비움
 * ⑤ 자동 결과만 시도 게이트.
 * @param {DetailRow} row
 * @param {AptRow[]} apts complex_key 가 빈 행은 미리 채워 넘긴다(`withComputedComplexKeys`)
 * @param {{ decisions?: NoticeDecisionIndex }} [ctx]
 * @returns {MatchDetail}
 */
export function matchDetailToAptDetailed(row, apts, ctx = {}) {
  const hmn = String(row.HOUSE_MANAGE_NO ?? "");
  const rn = normName(row.HOUSE_NM);
  const dec = ctx.decisions;
  const active = dec?.active.get(hmn);
  if (active) {
    // 판정 파일의 행이 apartments 에 없으면(지워진 행) 넣지 않는다 — 넣으면 FK 오류로 일정 upsert 한 묶음(500행)이 통째로 실패한다.
    const present = new Set(apts.map((a) => a.id));
    const ids = active.filter((id) => present.has(id));
    const sims = apts.filter((a) => ids.includes(a.id)).map((a) => stringSimilarity(rn, normName(a.name)));
    return { aptIds: ids, how: ids.length ? "manual" : "manual_missing", sim: sims.length ? Math.max(...sims) : 0 };
  }
  if (dec?.skip.has(hmn)) return { aptIds: [], how: "skip", sim: 0 };
  if (!rn) return { aptIds: [], how: "noMatch", sim: 0 };

  let bestSim = 0;
  /** @type {AptRow[]} */
  let tops = [];
  for (const a of apts) {
    const sim = stringSimilarity(rn, normName(a.name));
    if (sim < MATCH_SIM_MIN) continue;
    if (sim > bestSim) { bestSim = sim; tops = [a]; } else if (sim === bestSim) tops.push(a);
  }
  if (!tops.length) return { aptIds: [], how: "noMatch", sim: 0 };

  // 동점 집합을 정한 **뒤** 뺀다. 회차 낱말("임의공급3차")은 양쪽 다 떼고 블록·차수를 본다.
  const rowName = stripRoundWords(row.HOUSE_NM);
  /** @type {Excluded[]} */
  const excluded = [];
  tops = tops.filter((a) => {
    if (String(a.name ?? "").includes("(오)")) { excluded.push({ id: a.id, why: "officetel" }); return false; }
    const aName = stripRoundWords(a.name);
    if (phaseConsistent(rowName, aName) === "conflict" || blockConflict(rowName, aName)) { excluded.push({ id: a.id, why: "conflict" }); return false; }
    if (dec?.rejected.has(`${hmn}|${a.id}`)) { excluded.push({ id: a.id, why: "rejected" }); return false; }
    return true;
  });
  const extra = excluded.length ? { excluded } : {};
  if (!tops.length) {
    const how = excluded.every((x) => x.why === "rejected") ? "rejected_all" : "conflict_all";
    return { aptIds: [], how, sim: bestSim, ...extra };
  }
  tops = byId(tops);

  const bundles = new Set(tops.map(bundleKeyOf));
  /** @type {AptRow} */
  let chosen;
  /** @type {MatchHow} */
  let how;
  if (bundles.size === 1) {
    chosen = tops[0];
    how = tops.length === 1 ? "single" : "same_bundle";
  } else {
    const B = tops.filter((a) => {
      const aName = stripRoundWords(a.name);
      return !blockConflict(rowName, aName) && phaseConsistent(rowName, aName) === "ok";
    });
    const F = tops.filter((a) => fingerprintMatches(row, a));
    const bB = new Set(B.map(bundleKeyOf));
    const bF = new Set(F.map(bundleKeyOf));
    if (bF.size === 1 && (bB.size === 0 || bB.has([...bF][0]))) {
      chosen = F[0];
      how = bB.size === 0 ? "tie_fingerprint" : "tie_both";
    } else if (bF.size === 0 && bB.size === 1) {
      chosen = B[0];
      how = "tie_block";
    } else {
      return {
        aptIds: [], how: "tie_unresolved", sim: bestSim, ...extra,
        candidates: tops.map((a) => ({ id: a.id, name: a.name, key: bundleKeyOf(a) })),
      };
    }
  }

  const gate = regionGate(row, chosen, bestSim);
  if (gate !== "ok") return { aptIds: [], how: gate, sim: bestSim, ...extra };
  return { aptIds: [chosen.id], how, sim: bestSim, ...extra };
}

/**
 * `matchDetailToAptDetailed` 의 얇은 껍데기 — 붙일 행이 없으면 null.
 * @param {DetailRow} row
 * @param {AptRow[]} apts
 * @param {{ decisions?: NoticeDecisionIndex }} [ctx]
 * @returns {MatchDetail | null}
 */
export function matchDetailToApt(row, apts, ctx = {}) {
  const m = matchDetailToAptDetailed(row, apts, ctx);
  return m.aptIds.length ? m : null;
}

// ── 날짜 정규화: ISO("2026-05-29") → DATE 문자열, 그 외 null ──
/** @param {unknown} v @returns {string | null} */
function toDate(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}
/** @param {unknown} v @returns {number | null} */
function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
/** @param {unknown} v @returns {number | null} */
function toReal(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// 규제 지정 플래그: raw API 전량 2,837건 실측 = "Y"/"N" 두 값뿐. 그 외(부재·이상값)는 null 보존.
/** @param {unknown} v @returns {boolean | null} */
function toYn(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "Y" ? true : t === "N" ? false : null;
}

// ── Detail row → presale_schedule_official 행 ──
/** @param {DetailRow} row @param {string} aptId */
export function buildScheduleRow(row, aptId) {
  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    pblanc_no: row.PBLANC_NO ? String(row.PBLANC_NO) : null,
    recruit_date: toDate(row.RCRIT_PBLANC_DE),
    special_receipt_bgnde: toDate(row.SPSPLY_RCEPT_BGNDE),
    special_receipt_endde: toDate(row.SPSPLY_RCEPT_ENDDE),
    general_rank1_bgnde: toDate(row.GNRL_RNK1_CRSPAREA_RCPTDE),
    general_rank1_endde: toDate(row.GNRL_RNK1_CRSPAREA_ENDDE),
    general_rank2_bgnde: toDate(row.GNRL_RNK2_CRSPAREA_RCPTDE),
    general_rank2_endde: toDate(row.GNRL_RNK2_CRSPAREA_ENDDE),
    winner_announce_date: toDate(row.PRZWNER_PRESNATN_DE),
    contract_bgnde: toDate(row.CNTRCT_CNCLS_BGNDE),
    contract_endde: toDate(row.CNTRCT_CNCLS_ENDDE),
    move_in_ym: row.MVN_PREARNGE_YM ? String(row.MVN_PREARNGE_YM).trim() : null,
    tot_supply: toInt(row.TOT_SUPLY_HSHLDCO),
    pblanc_url: row.PBLANC_URL ? String(row.PBLANC_URL) : null,
    biz_entity: row.BSNS_MBY_NM ? String(row.BSNS_MBY_NM).trim() : null,
    constructor: row.CNSTRCT_ENTRPS_NM ? String(row.CNSTRCT_ENTRPS_NM).trim() : null,
    adjustment_target_area: toYn(row.MDAT_TRGET_AREA_SECD),
    price_cap_applied: toYn(row.PARCPRC_ULS_AT),
    speculation_overheated: toYn(row.SPECLT_RDN_EARTH_AT),
    redevelopment_biz: toYn(row.IMPRMN_BSNS_AT),
    public_housing_district: toYn(row.PUBLIC_HOUSE_EARTH_AT),
    large_scale_district: toYn(row.LRSCL_BLDLND_AT),
    metro_private_public_housing: toYn(row.NPLN_PRVOPR_PUBLIC_HOUSE_AT),
  };
}

// ── Mdl row → applyhome_unit_supply 행 ──
/** @param {MdlRow} row @param {string} aptId */
export function buildUnitRow(row, aptId) {
  /** @type {Record<string, number>} */
  const special = {};
  const types = {
    dazanyeo: row.MNYCH_HSHLDCO, sinhon: row.NWBB_HSHLDCO,
    saengae_choecho: row.LFE_FRST_HSHLDCO, nobumo: row.OLD_PARNTS_SUPORT_HSHLDCO,
    cheongnyeon: row.YGMN_HSHLDCO, sinsaenga: row.NWWDS_HSHLDCO,
    gigwan: row.INSTT_RECOMEND_HSHLDCO, etc: row.ETC_HSHLDCO,
  };
  for (const [k, v] of Object.entries(types)) {
    const n = toInt(v);
    if (n != null && n > 0) special[k] = n;
  }
  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    model_no: String(row.MODEL_NO ?? ""),
    house_ty: row.HOUSE_TY ? String(row.HOUSE_TY) : null,
    supply_area: toReal(row.SUPLY_AR),
    general_supply: toInt(row.SUPLY_HSHLDCO),
    special_supply: toInt(row.SPSPLY_HSHLDCO),
    special_by_type: Object.keys(special).length ? special : null,
    top_amount: toInt(row.LTTOT_TOP_AMOUNT),
  };
}

// ── prices 빈칸 채움 (세션622) ─────────────────────────────────
// house_type 은 `presale_` 로 시작하면 안 된다 — VIEW latest_prices·trade-stats buildLatestPriceMap 이
// `presale_%` 를 뒤로 미루므로, 공식가(이 행)가 네이버 presale_min 보다 앞서려면 rank 0 이어야 한다.
const PRICE_HOUSE_TYPE = "applyhome_rep";
const REP_AREA_TARGET = 84; // 대표 평형 = 전용면적이 84㎡ 에 가장 가까운 평형
const PYEONG_M2 = 3.3058;
const PRICE_LOOKUP_CHUNK = 200;
// applyhome_unit_supply.source 실측 철자(세션622, 16,278행): "apt" 11,864 · "remndr" 4,414. 칸 기본값 'apt'
// (마이그 20260807000000) — buildUnitRow 는 source 를 안 넣으므로 이 수집기가 새로 넣는 행은 apt 가 된다.
const UNIT_SOURCE_ORIGINAL = "apt";

/**
 * house_ty("084.8443 ", "059.9649B", "101.2A") 앞 숫자 = 전용면적(㎡). 못 읽으면 null.
 * @param {unknown} houseTy
 * @returns {number | null}
 */
export function parseHouseTyArea(houseTy) {
  if (typeof houseTy !== "string") return null;
  const m = houseTy.match(/^\s*(\d{2,3}\.\d+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 대표 평형 — top_amount>0 이고 전용면적을 읽을 수 있는 행 중 84㎡ 에 가장 가까운 것.
 * 거리가 같으면 top_amount 가 낮은 쪽. 중위값·평균은 쓰지 않는다. 고를 행이 없으면 null.
 * 원 공고(source 'apt', 없으면 apt 로 간주) 후보가 하나라도 있으면 그것만 본다 — 잔여세대(remndr)
 * 공고가는 할인·재공급 값이라 원 분양가와 다르다(세션622 실측: 레이카운티 66200 vs 원 71100). 없을 때만 remndr.
 * @param {readonly UnitRow[] | null | undefined} units
 * @returns {{ unit: UnitRow; area: number } | null}
 */
export function pickRepresentativeUnit(units) {
  /** @type {{ unit: UnitRow; area: number }[]} */
  const candidates = [];
  for (const u of units ?? []) {
    if (!u || u.top_amount == null || !(u.top_amount > 0)) continue;
    const area = parseHouseTyArea(u.house_ty);
    if (area == null) continue;
    candidates.push({ unit: u, area });
  }
  const original = candidates.filter((c) => (c.unit.source ?? UNIT_SOURCE_ORIGINAL) === UNIT_SOURCE_ORIGINAL);
  /** @type {{ unit: UnitRow; area: number } | null} */
  let best = null;
  let bestDist = Infinity;
  for (const { unit: u, area } of original.length ? original : candidates) {
    const top = /** @type {number} */ (u.top_amount);
    const dist = Math.abs(area - REP_AREA_TARGET);
    if (!best || dist < bestDist || (dist === bestDist && top < (best.unit.top_amount ?? Infinity))) {
      best = { unit: u, area };
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 대표 평형 → prices 행(price·top_amount 단위 = 만원). 고를 평형이 없으면 null.
 * @param {string} aptId
 * @param {readonly UnitRow[] | null | undefined} units
 * @param {string} today KST YYYY-MM-DD
 */
export function buildApplyhomePriceRow(aptId, units, today) {
  const rep = pickRepresentativeUnit(units);
  if (!rep) return null;
  const { unit, area } = rep;
  const price = /** @type {number} */ (unit.top_amount);
  const supplyCount = unit.general_supply == null && unit.special_supply == null
    ? null
    : (unit.general_supply ?? 0) + (unit.special_supply ?? 0);
  return {
    apartment_id: aptId,
    area,
    supply_area: unit.supply_area,
    price,
    // 평당가는 **전용면적** 기준 — 같은 rank 0 인 seed 행(운영 DB 1,000표본 100% 전용 기준)과 맞춰야
    // 평당가 편차 막대(src/constants/deviationFields.ts field "pp")가 공정하다. presale_min 은 공급 기준이라 다르다.
    pp: Math.round(price / (area / PYEONG_M2)),
    house_type: PRICE_HOUSE_TYPE,
    supply_count: supplyCount,
    recorded_at: today,
  };
}

/**
 * 빈칸 채움 계획 — 순수 함수(네트워크·DB 0). 단지마다 임대 → 이미 가격 있음 → 평형 없음 순으로 건너뛴다.
 * @param {Map<string, UnitRow[]>} unitsByApt
 * @param {Map<string, AptRow>} aptById
 * @param {Set<string>} hasPriceIds prices 에 price>0 행이 하나라도 있는 단지(house_type 무관)
 * @param {string} today
 */
export function planApplyhomePrices(unitsByApt, aptById, hasPriceIds, today) {
  /** @type {NonNullable<ReturnType<typeof buildApplyhomePriceRow>>[]} */
  const rows = [];
  const counts = { planned: 0, skippedLease: 0, skippedHasPrice: 0, skippedNoUnit: 0, skippedNoApt: 0 };
  /** @type {Record<string, number>} */
  const byPresaleType = {};
  for (const [aptId, units] of unitsByApt) {
    const apt = aptById.get(aptId);
    if (!apt) { counts.skippedNoApt++; continue; } // apartments 에 없는 id — 쓰면 FK 오류
    if (isLeaseUnit(apt)) { counts.skippedLease++; continue; }
    if (hasPriceIds.has(aptId)) { counts.skippedHasPrice++; continue; }
    const row = buildApplyhomePriceRow(aptId, units, today);
    if (!row) { counts.skippedNoUnit++; continue; }
    rows.push(row);
    counts.planned++;
    const k = apt?.presale_type ?? "(null)";
    byPresaleType[k] = (byPresaleType[k] ?? 0) + 1;
  }
  return { rows, counts, byPresaleType };
}

/**
 * `--impact-out=<경로>` 읽기. dry-run 이 아니면 던진다(미리보기 전용).
 * @param {readonly string[]} argv
 * @returns {string | null}
 */
export function parseImpactOutArg(argv) {
  // `--impact-out <경로>`(= 없이 띄어 씀)·값 없는 `--impact-out` 을 조용히 무시하면 미리보기 파일이 안 생긴다
  if (argv.includes("--impact-out")) throw new Error("--impact-out=<경로> 꼴로 써야 한다(= 필수)");
  const arg = argv.find((a) => a.startsWith("--impact-out="));
  if (!arg) return null;
  if (!argv.includes("--dry-run")) throw new Error("--impact-out 은 --dry-run 에서만 쓸 수 있다");
  const p = arg.slice("--impact-out=".length);
  if (!p) throw new Error("--impact-out 경로가 비었다");
  return p;
}

/**
 * prices 에 price>0 행이 있는 단지 id — 매칭된 단지만 200개씩 `.in()` 으로(전체 표 훑기 금지).
 * 한 단지에 행이 많아 1,000행을 넘을 수 있으니 id 커서로 끝까지 읽는다.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string[]} aptIds
 * @param {typeof selectAll} selectAll main 이 넘긴 selectAll(시험에선 가짜) — 이름을 selectAll 로 둬야 정적 가드(_selectall-keycol-coverage)가 keyCol 을 본다
 * @returns {Promise<Set<string>>}
 */
async function loadAptIdsWithPrice(sb, aptIds, selectAll) {
  /** @type {Set<string>} */
  const has = new Set();
  for (let i = 0; i < aptIds.length; i += PRICE_LOOKUP_CHUNK) {
    const chunk = aptIds.slice(i, i + PRICE_LOOKUP_CHUNK);
    const rows = /** @type {{ apartment_id: string }[]} */ (await selectAll(
      (s) => s.from("prices").select("id, apartment_id").in("apartment_id", chunk).gt("price", 0),
      sb,
      "id",
    ));
    for (const r of rows) has.add(r.apartment_id);
  }
  return has;
}

/**
 * 평형 재료 합치기 — DB 누적 행 + 이번 회차 행을 (apartment_id, house_manage_no, model_no) 로 합치고
 * 같은 키면 이번 회차가 이긴다. 결과는 단지별 묶음. 순수 함수.
 * (지금 API 에 더는 안 나오는 옛 공고의 평형도 DB 에 남아 있어 대상이 된다 — 세션622 미리보기 66 vs 246)
 * @param {readonly UnitRow[]} dbRows
 * @param {readonly UnitRow[]} roundRows
 * @returns {Map<string, UnitRow[]>}
 */
export function mergeUnitRows(dbRows, roundRows) {
  /** @type {Map<string, UnitRow>} */
  const byKey = new Map();
  for (const u of [...dbRows, ...roundRows]) {
    const key = `${u.apartment_id}|${u.house_manage_no}|${u.model_no}`;
    const prev = byKey.get(key);
    // 이번 회차 행엔 source 가 없다 — upsert 가 source 를 안 건드려 DB 값이 남으므로 그 값을 물려받는다.
    byKey.set(key, u.source == null && prev?.source != null ? { ...u, source: prev.source } : u);
  }
  /** @type {Map<string, UnitRow[]>} */
  const byApt = new Map();
  for (const u of byKey.values()) {
    const list = byApt.get(u.apartment_id);
    if (list) list.push(u);
    else byApt.set(u.apartment_id, [u]);
  }
  return byApt;
}

/**
 * prices 빈칸 채움 계획 — 평형 재료는 DB applyhome_unit_supply 전체(top_amount>0) + 이번 회차 행.
 * 실제 실행에서는 평형 upsert **뒤**에 부른다(그때 DB 가 이번 회차를 이미 담고 있다).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {AptRow[]} apts
 * @param {UnitRow[]} roundRows
 * @param {typeof selectAll} selectAll main 이 넘긴 selectAll(이름 유지 이유 = 위 loadAptIdsWithPrice)
 * @param {typeof today} todayFn main 이 넘긴 KST 날짜 함수(recorded_at)
 */
async function buildPricePlan(sb, apts, roundRows, selectAll, todayFn) {
  const dbRows = /** @type {UnitRow[]} */ (await selectAll(
    (s) => s.from("applyhome_unit_supply")
      .select("id, apartment_id, house_manage_no, model_no, house_ty, supply_area, general_supply, special_supply, top_amount, source")
      .gt("top_amount", 0),
    sb,
    "id",
  ));
  const unitsByApt = mergeUnitRows(dbRows, roundRows);
  const aptById = new Map(apts.map((a) => [a.id, a]));
  const hasPriceIds = await loadAptIdsWithPrice(sb, [...unitsByApt.keys()], selectAll);
  const plan = planApplyhomePrices(unitsByApt, aptById, hasPriceIds, todayFn());
  const c = plan.counts;
  log(PHASE, `[prices] 평형 재료 DB ${dbRows.length}행 + 이번 회차 ${roundRows.length}행 → 단지 ${unitsByApt.size}곳`);
  log(PHASE, `[prices] 빈칸 채움 ${c.planned}건(임대 제외 ${c.skippedLease} · 이미 값 있음 ${c.skippedHasPrice} · 평형 없음 ${c.skippedNoUnit}${c.skippedNoApt ? ` · 단지 없음 ${c.skippedNoApt}` : ""})`);
  return plan;
}

// ── 쌓인 틀린 행 정리 (세션630) ─────────────────────────────────
// 자동으로 다른 묶음을 고른 결과(지우기의 양성 증거가 되는 how) — 못 가름(tie_unresolved)은 따로 센다.
const WINNER_HOWS = new Set(["single", "same_bundle", "tie_fingerprint", "tie_both", "tie_block", "manual"]);

/**
 * @typedef {{ aptIds: string[]; bundles: Set<string>; how: MatchHow; excluded?: Excluded[]; name?: string; candidates?: TieCandidate[] }} DesiredEntry
 * @typedef {{ id: number | string; apartment_id: string; house_manage_no: string }} ScheduleDbRow
 * @typedef {"other_bundle" | "decision" | "conflict" | "unresolved"} DeleteWhy
 */

/**
 * 정리 계획 — 순수 함수(DB 0). 지우기는 **양성 증거가 있을 때만**: 다른 묶음이 이김 · 판정 파일(skip·rejected) ·
 * 블록·차수 어긋남으로 후보에서 빠진 행 · 동점을 못 가름. 게이트 탈락·짝 없음은 지울 근거가 없어 유지(명단).
 * 같은 묶음 추가 행은 지우지 않는다(준공월 되돌리기가 행마다 읽고, 상세 API 가 묶음 단위로 읽는다).
 * @param {readonly ScheduleDbRow[]} dbRows 지금 presale_schedule_official(id·apartment_id·house_manage_no)
 * @param {Map<string, DesiredEntry>} desired 이번 회차 공고번호 → 짝짓기 결과(빈 결과도 how 와 함께)
 * @param {(aptId: string) => string} keyOf 단지 id → 묶음 열쇠(빈 열쇠는 채운 값 · 없는 행은 자기 id)
 * @param {Set<string>} apiHmns 이번 회차 API 공고번호
 * @param {NoticeDecisionIndex} decisions
 */
export function planNoticeReconcile(dbRows, desired, keyOf, apiHmns, decisions) {
  /** @type {Array<{ id: number | string; apartment_id: string; house_manage_no: string; why: DeleteWhy }>} */
  const deletes = [];
  /** @type {Array<{ id: number | string; apartment_id: string; house_manage_no: string; how: string }>} */
  const noEvidence = [];
  let sameBundleExtra = 0;
  let notInApi = 0;
  let kept = 0;
  /** @type {Set<string>} */
  const dbPairs = new Set();
  for (const r of dbRows) {
    const hmn = String(r.house_manage_no);
    dbPairs.add(`${r.apartment_id}|${hmn}`);
    if (!apiHmns.has(hmn)) { notInApi++; continue; }
    const d = desired.get(hmn);
    /** @type {(why: DeleteWhy) => void} */
    const del = (why) => { deletes.push({ id: r.id, apartment_id: r.apartment_id, house_manage_no: hmn, why }); };
    if (decisions.skip.has(hmn) || decisions.rejected.has(`${hmn}|${r.apartment_id}`)) { del("decision"); continue; }
    if (!d) { noEvidence.push({ id: r.id, apartment_id: r.apartment_id, house_manage_no: hmn, how: "noMatch" }); continue; }
    if (d.aptIds.includes(r.apartment_id)) { kept++; continue; }
    if (d.bundles.has(keyOf(r.apartment_id))) { sameBundleExtra++; continue; }
    if (WINNER_HOWS.has(d.how)) { del("other_bundle"); continue; }
    if (d.excluded?.some((x) => x.id === r.apartment_id && x.why === "conflict")) { del("conflict"); continue; }
    if (d.how === "tie_unresolved") { del("unresolved"); continue; }
    noEvidence.push({ id: r.id, apartment_id: r.apartment_id, house_manage_no: hmn, how: d.how });
  }
  /** @type {Array<{ apartment_id: string; house_manage_no: string; how: string }>} */
  const adds = [];
  /** @type {Array<{ hmn: string; name: string; candidates: TieCandidate[] }>} */
  const unresolved = [];
  for (const [hmn, d] of desired) {
    for (const aptId of d.aptIds) {
      if (!dbPairs.has(`${aptId}|${hmn}`)) adds.push({ apartment_id: aptId, house_manage_no: hmn, how: d.how });
    }
    if (d.how === "tie_unresolved") unresolved.push({ hmn, name: d.name ?? "", candidates: d.candidates ?? [] });
  }
  const unitDeletePairs = deletes.map((x) => ({ apartment_id: x.apartment_id, house_manage_no: x.house_manage_no }));
  const priceDeleteAptIds = [...new Set(deletes.map((x) => x.apartment_id))].sort();
  /** @type {Record<DeleteWhy, number>} */
  const byWhy = { other_bundle: 0, decision: 0, conflict: 0, unresolved: 0 };
  for (const x of deletes) byWhy[x.why]++;
  return {
    deletes, unitDeletePairs, priceDeleteAptIds, adds,
    keep: { same_bundle_extra: sameBundleExtra, not_in_api: notInApi, no_evidence: noEvidence },
    unresolved,
    counts: { rows: dbRows.length, kept, deletes: deletes.length, byWhy, adds: adds.length },
  };
}

/**
 * 정리 차단기(정기 실행) — **지우는 일정 행만** 센다. 분모 = 일정 표 행 수.
 * @param {{ remove: number; existing: number }} counts
 * @returns {{ tripped: boolean; reason: string | null }}
 */
export function evaluateNoticeBreaker({ remove, existing }) {
  const ratio = existing > 0 ? remove / existing : 0;
  const tripped = remove > NOTICE_BREAKER_MAX_ROWS || ratio > NOTICE_BREAKER_RATIO;
  return {
    tripped,
    reason: tripped ? `지우는 일정 행 ${remove}/${existing} = ${(ratio * 100).toFixed(1)}% — 한도(${NOTICE_BREAKER_MAX_ROWS}행 또는 ${NOTICE_BREAKER_RATIO * 100}%) 초과` : null,
  };
}

/**
 * 다시 계산한 정리 계획이 승인한 계획 파일과 같은가 — 지우는 일정 행 id 집합 + 넣는 (단지, 공고) 쌍 집합 둘 다.
 * (assign-complex-keys `comparePlanToApproved` 와 같은 꼴 — 줄 = JSON 배열, 집합 대조)
 * @param {{ deletes: ReadonlyArray<{ id: unknown }>; adds: ReadonlyArray<{ apartment_id: unknown; house_manage_no: unknown }> }} current
 * @param {unknown} approved 계획 파일(--out) 내용
 * @returns {{ same: boolean; onlyCurrent: string[]; onlyApproved: string[] }}
 */
export function compareNoticePlan(current, approved) {
  const a = /** @type {{ deletes?: unknown; adds?: unknown }} */ (approved ?? {});
  if (!Array.isArray(a.deletes) || !Array.isArray(a.adds)) throw new Error("승인한 계획 파일에 deletes·adds 배열이 없습니다");
  /** @param {{ deletes: ReadonlyArray<any>; adds: ReadonlyArray<any> }} p */
  const lines = (p) => new Set([
    ...p.deletes.map((x) => JSON.stringify(["delete", String(x?.id ?? "")])),
    ...p.adds.map((x) => JSON.stringify(["add", x?.apartment_id ?? null, x?.house_manage_no ?? null])),
  ]);
  const cur = lines(current);
  const app = lines(/** @type {any} */ (a));
  const onlyCurrent = [...cur].filter((x) => !app.has(x)).sort();
  const onlyApproved = [...app].filter((x) => !cur.has(x)).sort();
  return { same: onlyCurrent.length === 0 && onlyApproved.length === 0, onlyCurrent, onlyApproved };
}

/**
 * 정리 인자 — `--out=<새 파일>`(dry-run 전용) · `--apply-from=<계획 파일>`(dry-run·--out 과 같이 못 씀).
 * 꼴이 틀리면 던진다(API 호출 전).
 * @param {readonly string[]} argv
 * @returns {{ out: string | null; applyFrom: string | null }}
 */
export function parseNoticeArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  /** @param {string} name */
  const one = (name) => {
    if (argv.includes(name)) throw new Error(`${name}=<경로> 꼴로 써야 한다(= 필수)`);
    const found = argv.filter((a) => a.startsWith(`${name}=`));
    if (found.length > 1) throw new Error(`${name} 이 두 번 나왔다`);
    if (!found.length) return null;
    const p = found[0].slice(name.length + 1);
    if (!p) throw new Error(`${name} 경로가 비었다`);
    return p;
  };
  const out = one("--out");
  const applyFrom = one("--apply-from");
  if (out != null && !dryRun) throw new Error("--out 은 --dry-run 에서만 쓸 수 있다(계획 파일은 미리보기에서만 만든다)");
  if (applyFrom != null && dryRun) throw new Error("--apply-from 은 --dry-run 과 같이 쓸 수 없다");
  return { out, applyFrom };
}

/**
 * 정리 지우기 — 일정 행(id 500개씩) → 평형(source 'apt', 지운 (단지, 공고) 쌍 — 공고번호별 `.in(단지)`) →
 * 분양가(`applyhome_rep`, 영향 단지 200개씩). 돌아온 행 수로 센다. 조회 오류는 던진다(모르는 채로 upsert 하지 않는다).
 * @param {any} sb
 * @param {{ deletes: ReadonlyArray<{ id: number | string }>; unitDeletePairs: ReadonlyArray<{ apartment_id: string; house_manage_no: string }>; priceDeleteAptIds: readonly string[] }} plan
 * @returns {Promise<{ schedule: number; units: number; prices: number }>}
 */
async function deleteNoticeRows(sb, plan) {
  let schedule = 0;
  const ids = plan.deletes.map((d) => d.id);
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const { data, error } = await sb.from("presale_schedule_official").delete().in("id", ids.slice(i, i + DELETE_CHUNK)).select("id");
    if (error) throw new Error(`일정 행 지우기 실패: ${error.message}`);
    schedule += data?.length ?? 0;
  }
  /** @type {Map<string, string[]>} */
  const aptsByHmn = new Map();
  for (const p of plan.unitDeletePairs) {
    const list = aptsByHmn.get(p.house_manage_no) ?? [];
    list.push(p.apartment_id);
    aptsByHmn.set(p.house_manage_no, list);
  }
  let units = 0;
  for (const [hmn, aptIds] of aptsByHmn) {
    const { data, error } = await sb.from("applyhome_unit_supply").delete()
      .eq("house_manage_no", hmn).eq("source", UNIT_SOURCE_ORIGINAL).in("apartment_id", aptIds).select("id");
    if (error) throw new Error(`평형 행 지우기 실패(${hmn}): ${error.message}`);
    units += data?.length ?? 0;
  }
  let prices = 0;
  for (let i = 0; i < plan.priceDeleteAptIds.length; i += PRICE_LOOKUP_CHUNK) {
    const { data, error } = await sb.from("prices").delete()
      .eq("house_type", PRICE_HOUSE_TYPE).in("apartment_id", plan.priceDeleteAptIds.slice(i, i + PRICE_LOOKUP_CHUNK)).select("id");
    if (error) throw new Error(`분양가 행 지우기 실패: ${error.message}`);
    prices += data?.length ?? 0;
  }
  return { schedule, units, prices };
}

/**
 * 표 행 수(`count: exact, head`). 오류는 던진다 · null 은 그대로(호출자가 "모름 = 정리 건너뜀").
 * @param {any} sb
 * @param {string} table
 * @returns {Promise<number | null>}
 */
async function countRows(sb, table) {
  const { count, error } = await sb.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table} 행 수 조회 실패: ${error.message}`);
  return count ?? null;
}

/**
 * 지금 일정 표 전체(id 커서). 인자 이름을 selectAll 로 둬야 정적 가드(_selectall-keycol-coverage)가 keyCol 을 본다.
 * @param {any} sb
 * @param {typeof selectAll} selectAll
 * @returns {Promise<ScheduleDbRow[]>}
 */
async function loadScheduleRows(sb, selectAll) {
  return /** @type {ScheduleDbRow[]} */ (await selectAll(
    (s) => s.from("presale_schedule_official").select("id, apartment_id, house_manage_no"),
    sb,
    "id",
  ));
}

// ── 메인 ──────────────────────────────────────────────────────
/**
 * @typedef {{ apiKey: string | undefined; argv: readonly string[]; getSupabase: typeof getSupabase;
 *   createReporter: typeof createReporter; fetchAllPages: typeof fetchAllPages; selectAll: typeof selectAll;
 *   upsertBatch: typeof upsertBatch; recordCollectorRun: typeof recordCollectorRun;
 *   recordApiQuota: typeof recordApiQuota; today: typeof today;
 *   readFileSync: (path: string, enc: "utf8") => string; countRows: typeof countRows;
 *   deleteNoticeRows: typeof deleteNoticeRows }} MainDeps
 */
/**
 * 매칭 후보 = apartments 전체(id 커서). main 이 넘긴 selectAll 을 받는다 — 인자 이름을 selectAll 로 둬야
 * 정적 가드(_selectall-keycol-coverage)가 이 호출의 keyCol 을 본다(점 붙은 호출은 가드가 다른 심볼로 건너뛴다, 세션623 CI).
 * 칸(세션630): 시군구(게이트 모름 보호) · 좌표·유형(빈 묶음 열쇠 계산) · 묶음 열쇠 · 네이버 지문(번호·공고일·일반공급) · 세대수.
 * @param {any} sb
 * @param {typeof selectAll} selectAll
 * @returns {Promise<AptRow[]>}
 */
async function loadMatchCandidates(sb, selectAll) {
  return /** @type {AptRow[]} */ (await selectAll(
    (s) => s.from("apartments").select("id, name, region, gu, lat, lng, presale_type, complex_key, naver_presale_no, presale_recruit_date, presale_general_supply, units, unit_source"),
    sb,
    "id", // 무정렬 OFFSET 이면 상세 매칭 후보가 조용히 빠진다 (세션543 W2)
  ));
}

/**
 * CLI 는 인자 없이 불러 진짜 함수로 돈다. 시험은 가짜 deps 로 main 흐름(순서·중단·날짜)을 본다(세션623).
 * @param {Partial<MainDeps>} [overrides]
 */
export async function main(overrides = {}) {
  /** @type {MainDeps} */
  const deps = {
    apiKey: API_KEY, argv: process.argv, getSupabase, createReporter, fetchAllPages,
    selectAll, upsertBatch, recordCollectorRun, recordApiQuota, today,
    readFileSync: (p, enc) => readFileSync(p, enc), countRows, deleteNoticeRows, ...overrides,
  };
  if (!deps.apiKey) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }
  const dryRun = deps.argv.includes("--dry-run");
  const impactOutPath = parseImpactOutArg(deps.argv); // dry-run 없이 오면 throw — API 호출 전
  const { out: planOutPath, applyFrom } = parseNoticeArgs(deps.argv); // 꼴이 틀리면 throw — API 호출 전
  // 판정 파일·승인 계획 파일은 API 를 부르기 전에 읽는다 — 깨졌으면 아무것도 안 했으므로 실행 기록 없이 멈춘다.
  /** @type {NoticeDecisionIndex} */
  let decisionIdx;
  /** @type {unknown} */
  let approvedPlan = null;
  try {
    decisionIdx = indexNoticeDecisions(parseNoticeDecisions(JSON.parse(deps.readFileSync(NOTICE_DECISIONS_PATH, "utf8"))).decisions);
    if (applyFrom != null) {
      approvedPlan = JSON.parse(deps.readFileSync(applyFrom, "utf8"));
      compareNoticePlan({ deletes: [], adds: [] }, approvedPlan); // 꼴 검사(deletes·adds 배열이 없으면 던진다)
    }
  } catch (e) {
    throw new Error(`NTC_ERROR ${e instanceof Error ? e.message : String(e)} — API 호출 전에 멈춤`);
  }
  if (planOutPath != null && existsSync(planOutPath)) {
    throw new Error(`--out 파일이 이미 있다: ${planOutPath} — 승인했을 수 있는 계획 파일을 덮어쓰지 않는다, 새 이름으로 다시 주세요`);
  }
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = deps.getSupabase();
  const rpt = deps.createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-market-stats.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
    // 1. 청약홈 Detail(일정) + Mdl(평형) 전수 수집
    log(PHASE, "청약홈 분양정보 상세 조회 시작...");
    const details = /** @type {DetailRow[]} */ (await deps.fetchAllPages("getAPTLttotPblancDetail"));
    log(PHASE, `Detail 총 ${details.length}건`);
    const mdls = /** @type {MdlRow[]} */ (await deps.fetchAllPages("getAPTLttotPblancMdl"));
    log(PHASE, `Mdl(평형) 총 ${mdls.length}건`);

    // 1.5. API 형식 변경 조기 감지 (collect-applyhome.mjs 패턴) — DB 쓰기 전
    const noDateRatio = details.length > 0
      ? details.filter(d => !toDate(d.RCRIT_PBLANC_DE)).length / details.length
      : 1;
    if (noDateRatio > 0.5) {
      logError(PHASE, `⚠️ RCRIT_PBLANC_DE 파싱 실패 ${(noDateRatio * 100).toFixed(1)}% — 청약홈 API 날짜 형식 변경 가능성.`);
      shouldExit1 = true;
      return;
    }

    // 2. 매칭 후보 로드 (전체 apartments)
    //    presale_stage NOT NULL 제약 제거 — 청약홈 공고가 있는데 분양 단계 미태깅된
    //    단지가 후보에서 빠지던 진앙 정정 (세션 360, +466 단지 회수). 적재는 별도
    //    테이블(presale_schedule_official/applyhome_unit_supply)에만 = apartments base 불변.
    //    빈 묶음 열쇠(월 08:00 네이버·11:30 씨앗이 넣은 새 행 — 열쇠는 다음 날 03:00)는 열쇠 규칙으로 채워 넘긴다(세션630).
    const rawApts = await loadMatchCandidates(sb, deps.selectAll);
    const aptCount = await deps.countRows(sb, "apartments");
    const apts = withComputedComplexKeys(rawApts, parseComplexExceptions(JSON.parse(deps.readFileSync(EXCEPTIONS_PATH, "utf8"))));
    log(PHASE, `매칭 후보 단지: ${apts.length}건 (apartments count ${aptCount})`);
    /** @type {string | null} 정리를 건너뛸 이유(받은 행이 모자람·중단) — 있으면 "기존 쌍만" */
    let skipReason = aptCount !== rawApts.length ? `후보 ${rawApts.length}행 ≠ apartments count ${aptCount}` : null;
    /** @type {Map<string, string>} */
    const keyById = new Map(apts.map((a) => [a.id, bundleKeyOf(a)]));
    /** @param {string} id */
    const keyOf = (id) => keyById.get(id) ?? id;
    /** @type {Map<string, AptRow>} */
    const aptById = new Map(apts.map((a) => [a.id, a]));

    // 3. Detail 매칭 v3 → house_manage_no별 apartment_id 목록(판정 파일 active 는 여럿)
    /** @type {Map<string, string[]>} */
    const hmnToApt = new Map();
    /** @type {Map<string, DesiredEntry>} */
    const desired = new Map();
    /** @type {Set<string>} */
    const apiHmns = new Set();
    /** @type {Map<string, string>} */
    const noticeName = new Map();
    /** @type {Record<string, number>} */
    const howCounts = {};
    /** @type {Array<{ hmn: string; name: string; addr: string | null }>} */
    const gateUnknown = [];
    let blockRejected = 0;
    /** @type {Record<string, unknown>[]} */
    const scheduleRows = [];
    let matched = 0;
    for (const d of details) {
      if (rpt.interrupted()) { skipReason ??= "중단 신호(매칭 도중)"; break; }
      const hmn = String(d.HOUSE_MANAGE_NO ?? "");
      if (!hmn) continue;
      apiHmns.add(hmn);
      noticeName.set(hmn, String(d.HOUSE_NM ?? ""));
      const m = matchDetailToAptDetailed(d, apts, { decisions: decisionIdx });
      howCounts[m.how] = (howCounts[m.how] ?? 0) + 1;
      blockRejected += (m.excluded ?? []).filter((x) => x.why === "conflict").length;
      if (m.how === "gate_unknown") gateUnknown.push({ hmn, name: String(d.HOUSE_NM ?? ""), addr: d.HSSPLY_ADRES ?? null });
      desired.set(hmn, {
        aptIds: m.aptIds, bundles: new Set(m.aptIds.map(keyOf)), how: m.how, excluded: m.excluded,
        name: String(d.HOUSE_NM ?? ""), candidates: m.candidates,
      });
      if (!m.aptIds.length) continue;
      matched++;
      hmnToApt.set(hmn, m.aptIds);
      for (const aptId of m.aptIds) scheduleRows.push(buildScheduleRow(d, aptId));
      if (dryRun && matched <= 10) {
        const names = m.aptIds.map((id) => aptById.get(id)?.name ?? id).join(", ");
        log(PHASE, `  [DRY-RUN] ${d.HOUSE_NM} → ${names} (${m.how}, sim=${m.sim.toFixed(2)}, recruit=${toDate(d.RCRIT_PBLANC_DE)})`);
      }
    }
    log(PHASE, `매칭(일정): ${matched}/${details.length}건 · ${JSON.stringify(howCounts)}`);

    // 4. Mdl 평형 — 매칭된 단지(hmn)만 적재(한 공고가 여러 행이면 행마다)
    /** @type {UnitRow[]} */
    const unitRows = [];
    for (const u of mdls) {
      if (rpt.interrupted()) break;
      for (const aptId of hmnToApt.get(String(u.HOUSE_MANAGE_NO ?? "")) ?? []) unitRows.push(buildUnitRow(u, aptId));
    }
    log(PHASE, `평형 행(매칭 단지): ${unitRows.length}건`);

    // 4.5. prices 빈칸 채움 계획 — 중단(SIGTERM)으로 평형이 덜 모였으면 대표 평형이 틀릴 수 있어 건너뜀.
    //      조회 실패도 건너뜀(모르는 채로 쓰면 이미 값 있는 단지에 끼어든다) — 비치명.
    //      실제 실행은 정리 지우기·평형 upsert 뒤에 부른다(아래 5) — 지운 평형이 빠진 DB 를 읽는다.
    /** @returns {Promise<ReturnType<typeof planApplyhomePrices> | null>} */
    const planPrices = async () => {
      if (rpt.interrupted()) return null;
      try {
        return await buildPricePlan(sb, apts, unitRows, deps.selectAll, deps.today);
      } catch (e) {
        logError(PHASE, `prices 빈칸 채움 계획 실패 (비치명적, 이번 회차 건너뜀): ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };

    // 4.6. 정리 계획(세션630) — 지금 일정 표 전체 + count 대조. 받은 행이 모자라면 정리를 건너뛴다.
    const dbRows = await loadScheduleRows(sb, deps.selectAll);
    const schedCount = await deps.countRows(sb, "presale_schedule_official");
    if (!skipReason && schedCount !== dbRows.length) skipReason = `일정 표 ${dbRows.length}행 ≠ count ${schedCount}`;
    const plan = planNoticeReconcile(dbRows, desired, keyOf, apiHmns, decisionIdx);
    const summaryTail = `근거 없어 유지 ${plan.keep.no_evidence.length} · 게이트 모름 ${gateUnknown.length} · 어긋남 제외 ${blockRejected} · 사람 판정 필요 ${plan.unresolved.length}`;
    log(PHASE, `[정리 계획] 일정 ${dbRows.length}행 · 지움 ${plan.deletes.length}(${JSON.stringify(plan.counts.byWhy)}) · 평형 쌍 ${plan.unitDeletePairs.length} · 분양가 단지 ${plan.priceDeleteAptIds.length} · 넣기 ${plan.adds.length} · 같은 묶음 추가 행 유지 ${plan.keep.same_bundle_extra} · API 밖 ${plan.keep.not_in_api} · ${summaryTail}`);
    for (const u of plan.unresolved.slice(0, 20)) {
      log(PHASE, `  사람 판정 필요 ${u.hmn} ${u.name} ↔ ${u.candidates.map((c) => `${c.id}(${c.name})`).join(" / ")}`);
    }

    if (dryRun) {
      if (planOutPath) {
        if (skipReason) {
          logError(PHASE, `NTC_SKIP ${skipReason} — 계획이 온전하지 않아 --out 저장 안 함`);
        } else {
          /** @param {string} id */
          const nameOf = (id) => aptById.get(id)?.name ?? null;
          const file = {
            takenAt: new Date().toISOString(),
            stats: { details: details.length, matched, how: howCounts, tableRows: dbRows.length, apartments: apts.length, byWhy: plan.counts.byWhy, kept: plan.counts.kept },
            deletes: plan.deletes.map((x) => ({ ...x, apt_name: nameOf(x.apartment_id), apt_key: keyOf(x.apartment_id), notice_name: noticeName.get(x.house_manage_no) ?? null })),
            adds: plan.adds.map((x) => ({ ...x, apt_name: nameOf(x.apartment_id), apt_key: keyOf(x.apartment_id), notice_name: noticeName.get(x.house_manage_no) ?? null })),
            priceDeleteAptIds: plan.priceDeleteAptIds,
            keep: {
              same_bundle_extra: plan.keep.same_bundle_extra, not_in_api: plan.keep.not_in_api,
              no_evidence: plan.keep.no_evidence.map((x) => ({ ...x, apt_name: nameOf(x.apartment_id), notice_name: noticeName.get(x.house_manage_no) ?? null })),
            },
            gate_unknown: gateUnknown,
            block_rejected: blockRejected,
            unresolved: plan.unresolved,
          };
          writeFileSync(planOutPath, JSON.stringify(file, null, 1) + "\n", { encoding: "utf8", flag: "wx" });
          log(PHASE, `[정리] 계획 파일 저장: ${planOutPath}`);
        }
      }
      const pricePlan = await planPrices();
      if (impactOutPath && pricePlan) {
        const pp = pricePlan;
        const rows = pp.rows.map((r) => {
          const a = aptById.get(r.apartment_id);
          return { ...r, name: a?.name ?? null, presale_type: a?.presale_type ?? null };
        });
        writeFileSync(impactOutPath, JSON.stringify({ takenAt: new Date().toISOString(), counts: pp.counts, byPresaleType: pp.byPresaleType, rows }, null, 2), "utf8");
        log(PHASE, `[IMPACT] prices 빈칸 채움 계획 저장: ${impactOutPath}`);
      } else if (impactOutPath) {
        logError(PHASE, "prices 계획이 없어 --impact-out 저장 안 함");
      }
      log(PHASE, `\n=== DRY-RUN 요약: 일정 ${scheduleRows.length}건 / 평형 ${unitRows.length}건 (DB 쓰기 0) ===`);
      rpt.success(matched);
      const result = rpt.summary();
      await deps.recordCollectorRun(PHASE, result);
      return;
    }

    // 5-0. 정리 모드 — 건너뜀(모자란 행·중단) · 승인 계획 불일치 · 차단기면 "기존 쌍만"(지우기·새 쌍·분양가 0).
    if (rpt.interrupted()) skipReason ??= "중단 신호";
    /** @type {string | null} failure 머리말(NTC_BREAKER·NTC_PLAN_MISMATCH) — 있으면 exit 1 */
    let failNote = null;
    let existingOnly = false;
    if (skipReason) {
      existingOnly = true;
      log(PHASE, `[정리] NTC_SKIP 건너뜀: ${skipReason} — 기존 쌍만 다시 받는다`);
    } else if (applyFrom != null) {
      const cmp = compareNoticePlan(plan, approvedPlan);
      if (!cmp.same) {
        existingOnly = true;
        failNote = `NTC_PLAN_MISMATCH 승인한 계획 파일과 지금 계획이 다르다 — 지금만 ${cmp.onlyCurrent.length} · 파일에만 ${cmp.onlyApproved.length}. 미리보기(--out)를 다시 떠서 승인받으세요`;
        for (const l of [...cmp.onlyCurrent.slice(0, 10), ...cmp.onlyApproved.slice(0, 10)]) log(PHASE, `  어긋남 ${l}`);
      } else {
        log(PHASE, `[정리] 승인한 계획 파일과 일치(지움 ${plan.deletes.length} · 넣기 ${plan.adds.length}) — 반영합니다`);
      }
    } else {
      const breaker = evaluateNoticeBreaker({ remove: plan.deletes.length, existing: schedCount ?? dbRows.length });
      if (breaker.tripped) {
        existingOnly = true;
        failNote = `NTC_BREAKER ${breaker.reason} — 명단을 승인받은 뒤 --apply-from 으로`;
      }
    }
    if (failNote) logError(PHASE, `${failNote} — 기존 쌍만 다시 받고 지우기·새 쌍·분양가는 멈춤`);

    let deleted = { schedule: 0, units: 0, prices: 0 };
    if (!existingOnly && (plan.deletes.length || plan.priceDeleteAptIds.length)) {
      deleted = await deps.deleteNoticeRows(sb, plan);
      if (deleted.schedule !== plan.deletes.length) logError(PHASE, `[정리] 지운 일정 행 ${deleted.schedule} ≠ 계획 ${plan.deletes.length} (그 사이 바뀐 행)`);
    }
    log(PHASE, `[정리] 지움 ${deleted.schedule}(평형 ${deleted.units}·분양가 ${deleted.prices}) · 넣기 ${existingOnly ? 0 : plan.adds.length} · ${summaryTail}`);

    /** @type {Set<string>} */
    const dbPairs = new Set(dbRows.map((r) => `${r.apartment_id}|${r.house_manage_no}`));
    /** @param {{ apartment_id?: unknown; house_manage_no?: unknown }} r */
    const isExistingPair = (r) => dbPairs.has(`${r.apartment_id}|${r.house_manage_no}`);
    const scheduleToWrite = existingOnly ? scheduleRows.filter(isExistingPair) : scheduleRows;
    const unitsToWrite = existingOnly ? unitRows.filter(isExistingPair) : unitRows;

    // 5. 적재 (apartments base 컬럼은 안 건드림)
    if (scheduleToWrite.length) {
      const ins = await deps.upsertBatch("presale_schedule_official", scheduleToWrite, "apartment_id,house_manage_no", 500, sb);
      rpt.success(ins);
      if (scheduleToWrite.length - ins > 0) rpt.fail(scheduleToWrite.length - ins);
    }
    // 평형 저장이 일부라도 실패하면 이번 회차 prices 를 쓰지 않는다 — 계획 재료는 메모리 행이라 값이
    // 틀리지는 않지만 '부분 반영 금지'(세션622 결정) 때문. upsertBatch 는 429 아닌 오류에도 던지지 않고
    // 성공 행 수만 돌려주므로 그 수로 판정한다(비치명 · rpt 수치·exit 코드는 그대로, 세션623).
    let unitsComplete = true;
    if (unitsToWrite.length) {
      const unitIns = await deps.upsertBatch("applyhome_unit_supply", unitsToWrite, "apartment_id,house_manage_no,model_no", 500, sb);
      if (unitIns < unitsToWrite.length) {
        unitsComplete = false;
        logError(PHASE, `평형 upsert 일부 실패 ${unitIns}/${unitsToWrite.length} — prices 빈칸 채움 이번 회차 건너뜀 (비치명적)`);
      }
    }
    // prices 는 평형 적재 뒤 · 실패는 비치명(naver-presale 과 같은 꼴) — rpt 수치(일정 행 수)의 뜻은 그대로.
    // "기존 쌍만" 모드에서는 쓰지 않는다(새 규칙의 결과가 승인 없이 들어가지 않게).
    const pricePlan = unitsComplete && !existingOnly ? await planPrices() : null;
    if (pricePlan?.rows.length) {
      try {
        await deps.upsertBatch("prices", pricePlan.rows, "apartment_id,house_type,recorded_at", 500, sb);
      } catch (e) {
        logError(PHASE, `prices upsert 실패 (비치명적): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const result = rpt.summary();
    log(PHASE, "\n=== 완료 ===");
    if (failNote) {
      await deps.recordCollectorRun(PHASE, { ...result, status: "failure", errorMessage: failNote });
      shouldExit1 = true;
    } else {
      await deps.recordCollectorRun(PHASE, result);
      if (result.fail > 0) shouldExit1 = true;
    }
  } finally {
    if (!dryRun && apiCalls > 0) {
      await deps.recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
    }
    // exit 은 recordApiQuota 를 await 한 바로 뒤 = 쿼터 기록 보장(scripts/CLAUDE.md Exit Code 정책).
    // ⚠️ try/finally *뒤* 로 빼면 안 된다 — 조기 중단 경로가 try 안에서 return 하므로 그 줄에는
    //    도달하지 못해 exit 0(성공)으로 끝난다(Node 실측).
    if (shouldExit1) process.exit(1);
  }
}

// isCLI v2 (typescript-patterns.md §5.2) — test import 시 main() 방지
const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) {
  main().catch(err => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
