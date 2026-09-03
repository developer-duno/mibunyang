// @ts-check
/**
 * 소사역 프라힐스 15곳 — 파생 행을 지우면서 함께 날아간 값 복구 (세션539 뒤처리)
 *
 * ## 무엇이 잘못됐나 (내가 만든 것이다)
 *
 * `fix-sosa-coordinates.mjs --purge-derived` 로 `infra`·`transport`·`schools` 행을 통째로 지웠다.
 * 의도는 "좌표가 바뀌었으니 다시 재게 하자"였는데, **`infra` 는 여러 수집기가 나눠 채우는 한 행**이다:
 *
 * | 채우는 수집기 | 컬럼 | 지운 뒤 |
 * |---|---|---|
 * | `infra-kakao.mjs` (매일) | hospital·mart·conv·cafe·culture·bank·pharmacy·park·subway_dist | ✅ 05:33 에 복구됨 |
 * | `collect-childcare.mjs` (**매월 1일**) | childcare·childcare_dist·childcare_count·childcare_nearest_* | ❌ 다음 10/2 |
 * | `collect-police.mjs` (**매월 1일**) | police·police_dist | ❌ 다음 10/2 |
 * | `collect-crime-safety.mjs` (매월 8일) | crime_score·crime_grade·crime_updated_at | ❌ 다음 9/8 |
 *
 * 그래서 15곳이 **13개 컬럼을 잃은 채** 한 달을 보내게 됐다. 특히 `scoreLocation.ts:191` 이
 * `보육${apt.childcare ?? 0}` 로 무조건 숫자를 박아 화면에 **"보육0"** 이 나간다 — 실제로는
 * 210m 안에 어린이집이 23곳 있다. NULL 로 바꿔도 `?? 0` 때문에 여전히 "보육0" 이다.
 *
 * 그리고 `apartments.noxious`/`noxious_dist` 는 지우지도 않았는데 **옛 좌표 기준 값(535m)** 이
 * 그대로 남았다. `noxious.mjs:117` 이 `noxious == null` 인 것만 재수집하므로 **영원히 안 고쳐진다.**
 * 535m 는 감점 반감 경계(`NOXIOUS_DIST_THRESHOLD` 500m)를 넘겨 **영구히 후한 점수**를 준다(실제 268m).
 *
 * ## 왜 "복사"가 정직한가 — 근사가 아니라 **완전히 같은 좌표**다
 *
 * `fix-sosa-coordinates.mjs` 는 15곳의 `lat`/`lng` 를 기준 행(`ah-2024910166`, 임의공급 10차)에서
 * **그대로 가져와** 박았다. 즉 16곳의 좌표는 **바이트 단위로 동일**하다. 좌표에서 파생되는 값은
 * 같은 좌표에서 재면 같은 값이므로, 10차의 값은 15곳에 대해 **정확히 옳다**(근사치가 아니다).
 * 이 스크립트는 그 전제를 **먼저 검증하고, 깨지면 중단한다** — 좌표가 하나라도 다르면 복사는 거짓이 된다.
 *
 * 카카오 API 를 다시 부르지 않는 이유: 그 수집기들은 대상 좁히기(`--limit`·id 인자)를 지원하지 않아
 * 15곳을 위해 2,900+ 단지 전량을 훑어야 한다(쿼터·시간 낭비). 같은 좌표의 실측값이 이미 있는데
 * 같은 값을 다시 사는 셈이다.
 *
 * ## 복사하지 않는 것
 *
 * - `updated_at`·`crime_updated_at` 등 **수집 시각**은 복사하지 않는다 — 언제 쟀는지는 행마다 다르다.
 *   `crime_*` 는 시각이 값과 한 묶음이라 통째로 건드리지 않고 **9/8 로컬 러너에 맡긴다**(5일 뒤).
 * - `transport`·`schools` 는 이미 05:33 에 올바른 좌표로 재수집됐다(지하철 153m·버스 19). 건드리지 않는다.
 *
 * ## 사용법
 *
 *   node scripts/fix-sosa-derived-restore.mjs            # 미리보기 (기본)
 *   node scripts/fix-sosa-derived-restore.mjs --apply    # 반영
 *
 * ⚠️ 파이프(`| tail`) 금지 — SIGPIPE 로 중간에 죽는다(`.claude/rules/collectors/pipe-kills-collector.md`).
 */
import { loadEnv, getSupabase, selectAll, log, logError } from "./collectors/_shared.mjs";

loadEnv();

const PHASE = "fix-sosa-restore";

/** 값의 출처 — 파생 행을 안 지운 유일한 형제. 15곳의 좌표는 이 행에서 복사해 왔다. */
const SOURCE_ID = "ah-2024910166";

/**
 * `infra` 에서 복사할 컬럼 — **좌표만으로 정해지는 값**만 담는다.
 * 수집 시각(`*_updated_at`)과 다른 수집기 소관(`crime_*`·`air_*`·`emergency_*`)은 제외한다.
 * @type {string[]}
 */
const INFRA_COPY = [
  "childcare",
  "childcare_dist",
  "childcare_count",
  "childcare_nearest_dist",
  "childcare_nearest_name",
  "childcare_nearest_capacity",
  "childcare_nearest_type",
  "childcare_nearest_teachers",
  "police",
  "police_dist",
];

/** `apartments` 에서 복사할 컬럼 — 옛 좌표 기준 값이 남아 스스로 안 고쳐지는 것. */
const APT_COPY = ["noxious", "noxious_dist"];

/**
 * 이 단지가 소사역 프라힐스 무리인가 — `fix-sosa-coordinates.mjs` 와 **같은 이름 조건**.
 * @param {{ name: string | null }} apt
 * @returns {boolean}
 */
export function isSosaGroup(apt) {
  const n = String(apt.name ?? "");
  return /프라힐스/.test(n) && /소사/.test(n);
}

async function main() {
  const apply = process.argv.includes("--apply");
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 — 반영하려면 --apply ===");

  const sb = getSupabase();
  const apts = /** @type {any[]} */ (
    await selectAll((s) => s.from("apartments").select("id, name, lat, lng, noxious, noxious_dist"), sb, "id")
  );
  const group = apts.filter(isSosaGroup);
  const src = group.find((a) => a.id === SOURCE_ID);
  if (!src) {
    logError(PHASE, `출처 행 ${SOURCE_ID} 을 못 찾았다 — 중단`);
    process.exit(1);
  }
  const targets = group.filter((a) => a.id !== SOURCE_ID);
  log(PHASE, `무리 ${group.length}곳 · 출처 ${SOURCE_ID} · 복구 대상 ${targets.length}곳`);

  // ── 전제 검증: 좌표가 **완전히 같아야** 복사가 정직하다 ──
  const mismatched = targets.filter((a) => a.lat !== src.lat || a.lng !== src.lng);
  if (mismatched.length > 0) {
    logError(PHASE, `좌표가 출처와 다른 곳이 ${mismatched.length}곳 있다 — 복사는 거짓이 되므로 중단`);
    for (const m of mismatched.slice(0, 5)) logError(PHASE, `  ${m.id} (${m.lat}, ${m.lng}) ≠ (${src.lat}, ${src.lng})`);
    process.exit(1);
  }
  log(PHASE, `좌표 동일성 확인 — ${targets.length}곳 전부 (${src.lat}, ${src.lng})`);

  const ids = targets.map((a) => a.id);
  const { data: infra, error: iErr } = await sb.from("infra").select("*").in("apartment_id", [...ids, SOURCE_ID]);
  if (iErr) {
    logError(PHASE, `infra 조회 실패: ${iErr.message}`);
    process.exit(1);
  }
  const srcInfra = (infra ?? []).find((r) => r.apartment_id === SOURCE_ID);
  if (!srcInfra) {
    logError(PHASE, `출처의 infra 행이 없다 — 중단`);
    process.exit(1);
  }

  // ── 무엇을 채울지 계산 ──
  /** @type {Record<string, unknown>} */
  const infraPatch = {};
  for (const c of INFRA_COPY) if (srcInfra[c] != null) infraPatch[c] = srcInfra[c];
  /** @type {Record<string, unknown>} */
  const aptPatch = {};
  for (const c of APT_COPY) if (src[c] != null) aptPatch[c] = src[c];

  log(PHASE, `\ninfra 복사 ${Object.keys(infraPatch).length}컬럼:`);
  for (const [k, v] of Object.entries(infraPatch)) log(PHASE, `   ${k.padEnd(28)} → ${JSON.stringify(v)}`);
  log(PHASE, `apartments 복사 ${Object.keys(aptPatch).length}컬럼:`);
  for (const [k, v] of Object.entries(aptPatch)) log(PHASE, `   ${k.padEnd(28)} → ${JSON.stringify(v)}`);

  // 현재 상태 (얼마나 비어 있나)
  const need = (infra ?? []).filter((r) => r.apartment_id !== SOURCE_ID && INFRA_COPY.some((c) => r[c] == null || r[c] === 0));
  const needApt = targets.filter((a) => APT_COPY.some((c) => String(a[c]) !== String(src[c])));
  log(PHASE, `\n채워야 할 infra 행: ${need.length} / ${ids.length}`);
  log(PHASE, `고쳐야 할 apartments 행(유해시설이 출처와 다름): ${needApt.length} / ${ids.length}`);

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영하려면 --apply ===`);
    return;
  }

  let ok = 0,
    fail = 0;
  for (const id of ids) {
    if (Object.keys(infraPatch).length) {
      const { error } = await sb.from("infra").update({ ...infraPatch, updated_at: new Date().toISOString() }).eq("apartment_id", id);
      if (error) { logError(PHASE, `infra ${id}: ${error.message}`); fail++; continue; }
    }
    if (Object.keys(aptPatch).length) {
      const { error } = await sb.from("apartments").update({ ...aptPatch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) { logError(PHASE, `apartments ${id}: ${error.message}`); fail++; continue; }
    }
    ok++;
  }
  log(PHASE, `\n복구: 성공 ${ok} · 실패 ${fail}`);
  log(PHASE, `남은 것 — crime_score·crime_grade 는 9/8 로컬 러너(collect-crime-safety)가 채운다.`);
  log(PHASE, `        손님 화면에 나가는 치안등급은 apartments.crime_safety_grade 라 무관하다.`);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
