// @ts-check
/**
 * 세션569 측정 전용 (운영 코드 아님, 측정 뒤 삭제 대상) — schools-neis 카카오 첫 쪽 15건 상한 포화율 측정.
 * DB 는 SELECT 만. 카카오 키워드 검색만 호출. 결과 = F:/mibunyang/.omc/artifacts/session569/schools_saturation.json
 * 실행: 본 폴더에서 main 의 loadEnv 로 env 만 얹고 이 파일을 file:/// 로 import 한다.
 * PROBE_STAGE=db 이면 표본만 뽑고 카카오 0회.
 */
import { writeFileSync } from "node:fs";
import { getSupabase, selectAll, sleep } from "./collectors/_shared.mjs";
import { isSchoolPlace, isElementarySchoolDoc } from "./collectors/_school-place.mjs";
import { calcScore, gradeFromScore, normalizeSchoolName } from "./collectors/schools-neis.mjs";

const OUT = "F:/mibunyang/.omc/artifacts/session569/schools_saturation.json";
const KAKAO_KEY = process.env.KAKAO_KEY;
const STAGE = process.env.PROBE_STAGE ?? "run";
const CALL_CAP = 620;
let calls = 0;
/** @type {number[]} */
const latencies = [];

const QUERIES = [
  { type: "초", keyword: "초등학교", radius: 1000 },
  { type: "중", keyword: "중학교", radius: 2000 },
  { type: "고", keyword: "고등학교", radius: 2000 },
];

/** @param {number} lat @param {number} lng @param {string} kw @param {number} radius @param {number} page @param {boolean} sc4 */
async function kakao(lat, lng, kw, radius, page, sc4) {
  if (calls >= CALL_CAP) throw new Error(`호출 상한 ${CALL_CAP} 도달`);
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(kw)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15&page=${page}${sc4 ? "&category_group_code=SC4" : ""}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  calls++;
  latencies.push(Date.now() - t0);
  if (!res.ok) throw new Error(`kakao HTTP ${res.status}`);
  const data = await res.json();
  await sleep(100);
  return { docs: /** @type {Array<Record<string, any>>} */ (data.documents ?? []), meta: data.meta ?? {} };
}

/** 최대 maxPage 쪽 — is_end 면 멈춤
 * @param {number} lat @param {number} lng @param {{keyword:string,radius:number}} q @param {boolean} sc4 @param {number} maxPage */
async function fetchPages(lat, lng, q, sc4, maxPage) {
  /** @type {Array<Array<Record<string, any>>>} */
  const pages = [];
  /** @type {Record<string, any> | null} */
  let meta1 = null;
  for (let p = 1; p <= maxPage; p++) {
    const { docs, meta } = await kakao(lat, lng, q.keyword, q.radius, p, sc4);
    if (p === 1) meta1 = meta;
    pages.push(docs);
    if (meta.is_end !== false || docs.length < 15) break;
  }
  return { pages, meta1 };
}

/** 현행 파이프라인 필터와 동일 (schools-neis.mjs:702-704)
 * @param {string} type @param {Record<string, any>} d */
function passes(type, d) { return type === "초" ? isElementarySchoolDoc(d) : isSchoolPlace(d.place_name); }

/** @param {Record<string, any>} e */
function pick(e) {
  /** @type {Record<string, any>} */ const o = {};
  for (const k of ["schoolType", "highSchoolType", "classes", "students", "founded"]) if (e[k] != null) o[k] = e[k];
  return o;
}

/**
 * @param {Record<string, Array<Record<string, any>>>} docsByType
 * @param {Map<string, Record<string, any>>} enrichByName 저장된 nearby_schools 의 NEIS/학교알리미 보강값(이름+급 매칭)
 */
function build(docsByType, enrichByName) {
  /** @type {Array<Record<string, any>>} */
  const arr = [];
  let enriched = 0;
  for (const q of QUERIES) {
    const seen = new Set();
    for (const d of docsByType[q.type] ?? []) {
      if (!passes(q.type, d)) continue;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const base = { name: d.place_name, type: q.type, distance: Math.round(Number(d.distance)) };
      const e = enrichByName.get(normalizeSchoolName(d.place_name) + "|" + q.type);
      if (e) enriched++;
      arr.push(e ? { ...base, ...pick(e) } : base);
    }
  }
  arr.sort((a, b) => a.distance - b.distance);
  const score = calcScore(arr.filter(s => s.type === "초"), arr.filter(s => s.type === "중"), arr.filter(s => s.type === "고"), arr);
  return {
    n: arr.length, enriched,
    nByType: { 초: arr.filter(s => s.type === "초").length, 중: arr.filter(s => s.type === "중").length, 고: arr.filter(s => s.type === "고").length },
    score, grade: gradeFromScore(score), names: arr.map(s => `${s.type}:${s.name}(${s.distance})`),
  };
}

async function main() {
  const sb = getSupabase();
  const apts = await selectAll((s) => s.from("apartments").select("id, name, lat, lng, region, gu, coord_shared"), sb, "id");
  const schoolRows = await selectAll((s) => s.from("schools").select("apartment_id, nearby_schools, school_score, school_grade, updated_at"), sb, "apartment_id");
  const { count: aptCount, error: cErr } = await sb.from("apartments").select("*", { count: "exact", head: true });
  const { count: schCount, error: sErr } = await sb.from("schools").select("*", { count: "exact", head: true });
  console.log("apartments", apts.length, "exact", aptCount, cErr?.message ?? "none", "| schools", schoolRows.length, "exact", schCount, sErr?.message ?? "none");
  const schById = new Map(schoolRows.map(r => [r.apartment_id, r]));

  // 10/23~26 만료 예측: updated_at 날짜(KST) 분포
  /** @type {Record<string, number>} */ const byDay = {};
  for (const r of schoolRows) {
    const d = r.updated_at ? new Date(new Date(r.updated_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : "null";
    byDay[d] = (byDay[d] ?? 0) + 1;
  }

  const eligible = apts.filter(a => a.lat != null && a.lng != null && a.coord_shared !== true && schById.has(a.id));
  const regions = [...new Set(eligible.map(a => a.region))];
  console.log("regions", regions.join(","), "| eligible", eligible.length, "| coord_shared true", apts.filter(a => a.coord_shared === true).length);

  // 대조군: 대전, 저장된 nearby_schools 에 용문분교장이 있는 단지 (세션567 대전 서구 18행)
  const ctrl = eligible.find(a => a.region === "대전" && (schById.get(a.id)?.nearby_schools ?? []).some(/** @param {any} s */ (s) => String(s?.name ?? "").includes("용문분교장")));
  /** @param {Array<Record<string, any>>} list @param {number} n @param {Set<string>} used */
  function pickByGu(list, n, used) {
    /** @type {Map<string, Array<Record<string, any>>>} */ const g = new Map();
    for (const a of list) { const k = `${a.region}|${a.gu}`; if (!g.has(k)) g.set(k, []); g.get(k)?.push(a); }
    const gus = [...g.entries()].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1));
    /** @type {Array<Record<string, any>>} */ const out = [];
    for (const [k, arr] of gus) {
      if (out.length >= n) break;
      if (used.has(k)) continue;
      const a = [...arr].sort((x, y) => (x.id < y.id ? -1 : 1))[Math.floor(arr.length / 2)];
      out.push(a); used.add(k);
    }
    return out;
  }
  /** @type {Set<string>} */ const used = new Set();
  /** @type {Record<string, number>} */ const metroQuota = { 서울: 10, 경기: 6, 인천: 4 };
  /** @type {Array<Record<string, any>>} */ const sample = [];
  for (const [r, n] of Object.entries(metroQuota)) sample.push(...pickByGu(eligible.filter(a => a.region === r), n, used).map(a => ({ ...a, group: "수도권" })));
  /** @type {Array<Record<string, any>>} */ const local = [];
  if (ctrl) { local.push({ ...ctrl, group: "지방", control: true }); used.add(`${ctrl.region}|${ctrl.gu}`); }
  const localRegions = regions.filter(r => !["서울", "경기", "인천"].includes(r)).sort();
  for (let round = 0; local.length < 20 && round < 5; round++) {
    for (const r of localRegions) {
      if (local.length >= 20) break;
      const got = pickByGu(eligible.filter(a => a.region === r), 1, used);
      if (got.length) local.push({ ...got[0], group: "지방" });
    }
  }
  sample.push(...local);
  const sampleOut = sample.map(a => ({ id: a.id, name: a.name, region: a.region, gu: a.gu, group: a.group, control: !!a.control, lat: a.lat, lng: a.lng }));
  console.log("sample", sample.length, "control", ctrl ? `${ctrl.id} ${ctrl.name}` : "없음");
  if (STAGE === "db") {
    writeFileSync(OUT.replace(".json", "_sample.json"), JSON.stringify({ byDay, sampleOut }, null, 1));
    console.log(JSON.stringify(byDay));
    for (const s of sampleOut) console.log(s.group, s.region, s.gu, s.id, s.name);
    return;
  }

  /** @type {Array<Record<string, any>>} */ const results = [];
  const ordered = [...sample].sort((a, b) => (b.control ? 1 : 0) - (a.control ? 1 : 0));
  for (const a of ordered) {
    const stored = schById.get(a.id);
    /** @type {Map<string, Record<string, any>>} */ const enrich = new Map();
    for (const s of stored?.nearby_schools ?? []) enrich.set(normalizeSchoolName(String(s.name)) + "|" + s.type, s);
    /** @type {Record<string, any>} */ const per = {};
    /** @type {Record<string, Record<string, Array<Record<string, any>>>>} */ const variants = { cur: {}, p3: {}, sc4: {}, both: {} };
    for (const q of QUERIES) {
      const plain = await fetchPages(a.lat, a.lng, q, false, 3);
      const sc = await fetchPages(a.lat, a.lng, q, true, 3);
      const p1 = plain.pages[0] ?? [];
      const all = plain.pages.flat();
      const sc1 = sc.pages[0] ?? [];
      const scAll = sc.pages.flat();
      variants.cur[q.type] = p1; variants.p3[q.type] = all; variants.sc4[q.type] = sc1; variants.both[q.type] = scAll;
      const curKeep = p1.filter(d => passes(q.type, d));
      const p3Keep = all.filter(d => passes(q.type, d));
      per[q.type] = {
        p1: p1.length, total_count: plain.meta1?.total_count, pageable: plain.meta1?.pageable_count, pagesFetched: plain.pages.length, p3: all.length,
        p1Keep: curKeep.length, p3Keep: p3Keep.length, addedByP3: p3Keep.length - curKeep.length,
        p1NotSC4: p1.filter(d => d.category_group_code !== "SC4").length, p1Rejected: p1.length - curKeep.length,
        p1KeptNotSC4: curKeep.filter(d => d.category_group_code !== "SC4").map(d => `${d.place_name}[${d.category_name}]`),
        p1RejectedNames: p1.filter(d => !passes(q.type, d)).map(d => `${d.place_name}[${d.category_name}]`),
        wrongLevel: curKeep.filter(d => !String(d.place_name).includes(q.keyword === "초등학교" ? "초" : q.keyword.slice(0, 1))).map(d => d.place_name),
        sc4p1: sc1.length, sc4pageable: sc.meta1?.pageable_count, sc4Total: scAll.length,
        sc4Keep1: sc1.filter(d => passes(q.type, d)).length, sc4KeepAll: scAll.filter(d => passes(q.type, d)).length,
        maxDistP1: p1.length ? Math.max(...p1.map(d => Number(d.distance))) : null,
      };
    }
    const r = {
      id: a.id, name: a.name, region: a.region, gu: a.gu, group: a.group, control: !!a.control,
      storedScore: stored?.school_score ?? null, storedGrade: stored?.school_grade ?? null, storedN: (stored?.nearby_schools ?? []).length, per,
      cur: build(variants.cur, enrich), p3: build(variants.p3, enrich), sc4: build(variants.sc4, enrich), both: build(variants.both, enrich),
    };
    if (a.control) {
      for (const q of QUERIES) {
        const again = await kakao(a.lat, a.lng, q.keyword, q.radius, 1, false);
        r.per[q.type].p1Again = again.docs.length;
        r.per[q.type].p1SameIds = JSON.stringify(again.docs.map(d => d.id)) === JSON.stringify(variants.cur[q.type].map(d => d.id));
      }
    }
    results.push(r);
    console.log(`${a.control ? "[대조]" : ""}${a.region} ${a.gu} ${a.name}: 첫쪽 초${per["초"].p1}/${per["초"].pageable} 중${per["중"].p1}/${per["중"].pageable} 고${per["고"].p1}/${per["고"].pageable} | 점수 저장${r.storedScore} 현행${r.cur.score} 3쪽${r.p3.score} SC4${r.sc4.score} 둘다${r.both.score} | calls ${calls}`);
  }
  const lat = [...latencies].sort((x, y) => x - y);
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), calls,
    latencyMs: { median: lat[Math.floor(lat.length / 2)], p90: lat[Math.floor(lat.length * 0.9)], mean: Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) },
    byDay, sample: sampleOut, results,
  }, null, 1));
  console.log("done calls", calls, "->", OUT);
}
await main();
