// @ts-check
/**
 * 정본 재생성용 1회 도구 — 세션616 소유권 전수조사 → 정본 `supabase/ownership.json` (세션617)
 *
 * 입력 = `.omc/artifacts/session616/ownership-survey/inventory.json`(레포 밖 — git 미추적 작업반 산출) · 2u 레포(읽기만, 파일 실재 확인).
 * 왜 남기나: 정본의 첫 판이 어디서 어떻게 나왔는지(분류 규칙·손 보강)를 커밋으로 남기려고.
 * 이후 정본은 **손으로 PR** 해서 고친다 — 이 스크립트를 다시 돌리면 그 뒤 고친 것이 덮인다.
 *
 * 분류 규칙(설계서 §1-2):
 *  - kind → owner: 2u-only=2u · mibunyang-only/mibunyang-writes=mibunyang · both=shared · orphan=orphan · absent=읽는 쪽(+absent:true)
 *  - readers: inventory 읽는 파일의 레포 중 owner 가 아닌 쪽(shared 는 둘 다)
 *  - shared 표 칸: 열쇠=key(누구나 쓰는 중립 칸) · 미분양·2u 둘 다 씀=contested · 한쪽만=그쪽 · 쓰는 곳 0=orphan · DB 기본값·트리거=clock
 *    단 naver-listings.mjs(실행 경로 0)는 칸 분류에서 뺀다(설계서가 has_pool 을 orphan 으로 둔 것과 같게) — 기준선엔 넣는다
 *  - writers.mibunyang[파일][표] = inventory 칸 + 양성 대조군(아래 POSITIVE) + 그 파일의 글자 키 중 그 표 칸(가드 ② 와 같은 추출기)
 *
 * 실행(워크트리 루트에서): node scripts/build-ownership.mjs [inventory.json 경로] [2u 레포 경로]
 */
import fs from "node:fs";
import path from "node:path";
import { extractKeys, stripCommentLines } from "./audit-shared-db-ownership.mjs";

const INV = process.argv[2] ?? "F:/mibunyang/.omc/artifacts/session616/ownership-survey/inventory.json";
const U2_ROOT = process.argv[3] ?? "D:/naver-estate-web";
const OUT = "supabase/ownership.json";
const DEAD_PATH = "scripts/collectors/naver-listings.mjs";

/** @type {any[]} */
const inv = JSON.parse(fs.readFileSync(INV, "utf8"));

const OWNER_BY_KIND = /** @type {Record<string,string>} */ ({
  "2u-only": "2u",
  "mibunyang-only": "mibunyang",
  "mibunyang-writes": "mibunyang",
  both: "shared",
  orphan: "orphan",
});

// 양성 대조군 — 코드에서 직접 읽은 칸(naver-collect.py:221-226·:316-321·:357·:469-478,:489 · collect-air-quality.mjs).
const POSITIVE = /** @type {Record<string, Record<string, string[]>>} */ ({
  "scripts/collectors/naver-collect.py": {
    complexes: ["complex_no", "complex_name", "real_estate_type_code", "latitude", "longitude", "total_household_count", "use_approve_ymd", "construction_company", "last_crawled_at", "heat_method_type", "heat_fuel_type", "corridor_type"],
    articles: ["article_no", "complex_no", "trade_type_name", "numeric_price", "numeric_rent_price", "area1_m2", "area2_m2", "price_per_pyeong", "floor_info", "direction", "is_active", "last_seen_at"],
    complex_price_history: ["complex_no", "trade_type", "area_no", "price_upper", "price_lower", "price_avg", "base_month"],
  },
  "scripts/collectors/collect-air-quality.mjs": { infra: ["air_station_name", "air_station_dist"] },
});
const C1_CONTESTED = ["complex_name", "latitude", "longitude", "total_household_count", "use_approve_ymd", "real_estate_type_code", "construction_company", "heat_method_type", "heat_fuel_type", "last_crawled_at"];

// 칸 분류 손 정리(설계서 §1-2) — 열쇠 칸은 key(중립: 가드 ② 판정에서 제외 · 새 미등록 파일은 ① 이 잡는다)
const COLUMN_OVERRIDES = /** @type {Record<string, Record<string,string>>} */ ({
  complexes: { complex_no: "key", created_at: "clock", updated_at: "2u" },
  articles: { article_no: "key" },
  infra: { apartment_id: "key", updated_at: "clock" },
  complex_price_history: { complex_no: "key", trade_type: "key", area_no: "key", base_month: "key", id: "clock" },
});

const VIEWS = /** @type {Record<string, any>} */ ({
  apartments_flat: {
    owner: "mibunyang",
    reads_from: ["apartments", "prices", "regions", "infra", "schools", "transport", "builders", "trade_stats", "applyhome_events", "presale_schedule_official"],
    note: "읽는 곳은 미분양뿐(2u 레포 전체 grep 0건 · 세션617). infra.nearby_facilities 를 SELECT * 로 노출. 정의 = supabase/migrations/20261007000000_view_add_trade_scope.sql",
  },
  api_quota_daily: { owner: "mibunyang", reads_from: ["api_quota_log"], note: "정의 = supabase/migrations/20260329100000_api_quota_log.sql" },
});

/**
 * inventory 의 파일 칸 → 실제 경로 목록("backend/a.py:1-2 · routers/b.py:3" · "x.mjs (RPC …)")
 * @param {string} repo
 * @param {string} raw
 */
function normFiles(repo, raw) {
  let dir = "";
  return raw
    .split(" · ")
    .map((s) => s.trim().split(" ")[0].replace(/:\d[\d,-]*$/, ""))
    .filter((s) => /\.(py|mjs|ts|js|tsx)$/.test(s))
    .filter((s) => !(repo === "2u" && s === "backend/db/models.py")) // ORM onupdate — 쓰는 파일이 아님
    .map((s) => {
      // "routers/live/a.py · b.py" 의 b 는 앞 항목과 같은 폴더
      const full = repo === "2u" && !s.startsWith("backend/") && !s.startsWith("frontend/") ? (s.includes("/") ? `backend/${s}` : `${dir}/${s}`) : s;
      dir = path.posix.dirname(full);
      return full;
    });
}

/** @type {Record<string, any>} */
const tables = {};
/** @type {Record<string, Record<string, Record<string, Set<string>>>>} */
const writers = { mibunyang: {}, "2u": {} };
/** @param {string} repo @param {string} file @param {string} table @param {string[]} cols */
const addWriter = (repo, file, table, cols) => {
  const byFile = (writers[repo][file] ??= {});
  const set = (byFile[table] ??= new Set());
  for (const c of cols) set.add(c);
};
/** @type {string[]} */
const problems = [];

for (const t of inv) {
  if (t.kind === "view") continue;
  const owner = t.kind === "absent" ? "mibunyang" : OWNER_BY_KIND[t.kind];
  if (!owner) problems.push(`모르는 kind ${t.kind} (${t.table})`);
  const readerRepos = [...new Set((t.readers ?? []).map((/** @type {any} */ r) => r.repo))].filter((r) => r === "mibunyang" || r === "2u");
  const readers = owner === "shared" ? readerRepos.sort() : readerRepos.filter((r) => r !== owner).sort();
  /** @type {Record<string, any>} */
  const entry = { owner };
  if (readers.length) entry.readers = readers;
  if (t.kind === "absent") entry.absent = true;

  if (owner === "shared") {
    /** @type {Record<string, string[]>} */
    const buckets = { key: [], mibunyang: [], "2u": [], contested: [], orphan: [], clock: [] };
    for (const c of t.columns) {
      const repos = new Set(
        c.writers.filter((/** @type {any} */ w) => !(w.repo === "mibunyang" && w.file.startsWith(DEAD_PATH))).map((/** @type {any} */ w) => w.repo),
      );
      let b = repos.has("mibunyang") && repos.has("2u") ? "contested" : repos.has("mibunyang") ? "mibunyang" : repos.has("2u") ? "2u" : repos.has("db") ? "clock" : "orphan";
      b = COLUMN_OVERRIDES[t.table]?.[c.name] ?? b;
      buckets[b].push(c.name);
      for (const w of c.writers) {
        if (w.repo !== "mibunyang" && w.repo !== "2u") continue;
        for (const f of normFiles(w.repo, w.file)) addWriter(w.repo, f, t.table, [c.name]);
      }
    }
    for (const k of Object.keys(buckets)) if (!buckets[k].length) delete buckets[k];
    entry.columns = buckets;
  }
  if (t.notes) entry.note = String(t.notes);
  tables[t.table] = entry;

  for (const w of t.writers ?? []) {
    for (const f of normFiles(w.repo, w.file)) {
      if (w.repo !== "mibunyang" && w.repo !== "2u") continue;
      if (owner === "shared") addWriter(w.repo, f, t.table, []);
      else addWriter(w.repo, f, t.table, ["*"]);
    }
  }
}

// 설계서 §1-2 의 표별 추가 필드
Object.assign(tables.infra, { row_create: ["mibunyang", "2u"], fk_cascade_from: "apartments" });
// inventory 의 ③ 은 이번 PR 이 고친 옛 사실 — 고친 문장으로 바꾼다(fix1 🟡). 원문이 없으면 시끄럽게 실패.
const OLD_C4 = "③ 미분양 fix-sosa-coordinates.mjs:73 은 infra 행을 통째 삭제(2u 칸 포함)";
if (!String(tables.infra.note).includes(OLD_C4)) problems.push("infra note 에 옛 C4 문장이 없음 — inventory 가 바뀌었나");
tables.infra.note = `${String(tables.infra.note).replace(OLD_C4, "③ fix-sosa-coordinates.mjs 의 infra 행 통째 삭제(C4)는 세션617 에 고침(미분양 카카오 칸만 null)")} — updated_at 은 DB 트리거가 모든 UPDATE 에 now(): 어느 쪽도 자기 수집 시각으로 믿지 말 것(C3). fix-sosa·fix-placeholder 의 infra 비우기 = 카카오 17칸만(INFRA_KAKAO_COLUMNS) — 좌표 파생 미분양 칸 10개(air_station_*·childcare*·emergency*·police*)는 그대로 남음(후속 BACKLOG · purge-to-recollect-timing 본 뒤 결정).`;
// 옛 supabase/CLAUDE.md 손 표에만 있던 지식(세션617 에 표를 지우며 여기로 옮김 · fix1 🟡)
tables.air_station_annual.note = "측정소별 3년 평균(연 1회 air-annual-load.mjs). 2u 백엔드가 단지 상세마다 station_name 으로 조회(2u backend/routers/mb.py → mb_air_annual.py, 예외 격리 없음) — 표 이름·칸(station_name·pm25·pm10·o3·years·updated_at)을 바꾸거나 지우면 2u 모든 단지 상세가 500. 등급 경계(PM2.5 15/19 등)는 2u 에 복제돼 있다(src/constants/scoringTiers.ts 주석).";
Object.assign(tables.articles, { row_lifecycle: { mibunyang: "is_active=false", "2u": "delete" } });
Object.assign(tables.complex_price_history, { sources: { "2u-public": "base_month 6자리 · area_no=''", naver: "base_month 8자리" } });
tables.complexes.note = `${tables.complexes.note} — contested = C1(등재만, 해소는 별도 트랙). complex_no(열쇠)는 2u 칸으로 분류.`;
tables.admin_settings.note = `${tables.admin_settings.note ?? ""} 쓰는 곳 0 — 2u 저장 라우트 삭제(2u backend/routers/admin/data.py:87), 표는 기록 보존용.`.trim();

// 양성 대조군 대조(멈춤 조건 ⓐ) + 기준선 손 보강
for (const [file, byTable] of Object.entries(POSITIVE)) {
  for (const [tbl, cols] of Object.entries(byTable)) {
    const have = writers.mibunyang[file]?.[tbl] ?? new Set();
    const missing = cols.filter((c) => !have.has(c));
    if (missing.length) problems.push(`양성 대조군 어긋남 ${file} ${tbl}: inventory 에 없는 칸 ${missing.join(",")}`);
    addWriter("mibunyang", file, tbl, cols);
  }
}
const contested = tables.complexes.columns.contested ?? [];
if (contested.slice().sort().join() !== C1_CONTESTED.slice().sort().join()) problems.push(`complexes contested ≠ C1 10칸: ${contested.join(",")}`);
// C2 = 양쪽이 같이 쓰는 12칸(열쇠 article_no 포함) → 열쇠를 key 로 뺀 contested 11
if ((tables.articles.columns.contested ?? []).length !== 11) problems.push(`articles contested ${tables.articles.columns.contested?.length} ≠ 11`);

// C4 수정 뒤 fix-sosa-coordinates 는 infra 의 미분양 카카오 칸을 null UPDATE 한다(행 삭제 안 함)
const kakaoCols = ["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].flatMap((k) => [k, `${k}_dist`]).concat("subway_dist");
addWriter("mibunyang", "scripts/fix-sosa-coordinates.mjs", "infra", ["apartment_id", ...kakaoCols]);

// 기준선 = 지금 그 파일에 글자로 든 그 표 칸(가드 ② 와 같은 추출기) — "기존은 허용, 새로 늘면 빨강"
/** @type {string[]} */
const autoAdded = [];
for (const [file, byTable] of Object.entries(writers.mibunyang)) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) continue;
  const isPy = file.endsWith(".py");
  const keys = extractKeys(stripCommentLines(fs.readFileSync(abs, "utf8"), isPy), isPy);
  // 이미 그 파일의 다른 표 기준선에 든 키는 더하지 않는다(가드 ② 는 파일의 기준선 합집합으로 본다 —
  // naver-collect 의 complexes "latitude" 를 articles 칸으로 잘못 적지 않게)
  const fileUnion = new Set(Object.values(byTable).flatMap((s) => [...s]));
  for (const [tbl, set] of Object.entries(byTable)) {
    const cols = tables[tbl]?.columns;
    if (!cols) continue;
    const all = new Set(Object.values(cols).flat());
    for (const k of keys) {
      if (all.has(k) && !set.has(k) && !fileUnion.has(k)) {
        set.add(k);
        fileUnion.add(k);
        autoAdded.push(`${file} ${tbl}.${k}`);
      }
    }
  }
}

/** @param {Record<string, Record<string, Set<string>>>} w */
const finalize = (w) =>
  Object.fromEntries(
    Object.keys(w)
      .sort()
      .map((f) => [f, Object.fromEntries(Object.keys(w[f]).sort().map((t) => [t, [...w[f][t]].sort((a, b) => (a === "*" ? -1 : b === "*" ? 1 : a.localeCompare(b)))]))]),
  );

const registry = {
  version: 1,
  updated: "2026-10-09",
  note: "공유 Supabase 표·칸 소유권 정본(설계서 docs/superpowers/specs/2026-10-09-shared-db-ownership-registry-design.md). 바꾸는 법 = 이 파일 PR → CI ownership audit → 합치면 2u 에 통보 이슈 자동. 첫 판 = scripts/build-ownership.mjs(세션616 전수조사). writers 의 칸 목록은 기준선('*' = 표 전체, 미분양·2u 단독 표).",
  repos: { mibunyang: "developer-duno/mibunyang", "2u": "developer-duno/naver-estate-web" },
  tables: Object.fromEntries(Object.keys(tables).sort().map((k) => [k, tables[k]])),
  views: VIEWS,
  writers: { mibunyang: finalize(writers.mibunyang), "2u": finalize(writers["2u"]) },
  delete_allowed: {
    mibunyang: { "scripts/fix-placeholder-addresses.mjs": ["transport", "schools"] },
    "2u": { "backend/services/upsert.py": ["articles"] },
  },
  known_conflicts: {
    C1: "complexes contested 10칸 — 미분양 naver-collect.py(마커 bbox)와 2u 검색이 같은 칸을 씀. 해소(2u 주인·미분양은 빈칸만)는 2u 합의 뒤 별도 트랙",
    C2: "articles 양쪽이 같이 쓰는 12칸(열쇠 article_no + contested 11) + 행 수명(미분양 is_active=false · 2u 물리 삭제) — 별도 트랙",
    C3: "infra.updated_at 공유 시계(DB 트리거) — 어느 쪽 수집 시각도 아님. 해소 = infra.kakao_updated_at 칸(별도 트랙)",
    C5: "complex_price_history 두 출처(2u 공공 base_month 6자리·area_no='' / 네이버 8자리) — 별도 트랙",
  },
  guard: {
    helpers: ["scripts/collectors/_shared.mjs", "scripts/collectors/data-audit.mjs"],
    note: "helpers = 표 이름을 인자로 받는 범용 파일(가드 ①③ 제외). 호출하는 쪽 파일에서 글자가 잡힌다.",
  },
};

// 2u 쪽 파일 실재(읽기만)
for (const f of Object.keys(registry.writers["2u"])) if (!fs.existsSync(path.join(U2_ROOT, f))) problems.push(`2u 파일 없음 ${f}`);
for (const f of Object.keys(registry.writers.mibunyang)) if (!fs.existsSync(path.resolve(f))) problems.push(`미분양 파일 없음 ${f}`);

fs.writeFileSync(OUT, JSON.stringify(registry, null, 2).replace(/\n/g, "\r\n") + "\r\n");
console.log(`tables ${Object.keys(registry.tables).length} · views ${Object.keys(registry.views).length} · shared ${Object.values(registry.tables).filter((t) => t.owner === "shared").length}`);
console.log(`writers.mibunyang ${Object.keys(registry.writers.mibunyang).length} · writers.2u ${Object.keys(registry.writers["2u"]).length}`);
console.log(`기준선 자동 보강 ${autoAdded.length}건:`);
for (const a of autoAdded) console.log(`  + ${a}`);
console.log(`문제 ${problems.length}건:`);
for (const p of problems) console.log(`  ! ${p}`);
process.exitCode = problems.length ? 1 : 0;
