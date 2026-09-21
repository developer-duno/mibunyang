// @ts-check
/**
 * 단지 몇 곳의 `noxious`·`noxious_dist` 만 **다시 잰다** — 세션556.
 *
 * ## 왜 필요한가
 *
 * 좌표를 정정하면(`fix-placeholder-addresses.mjs`) 그 단지의 파생값이 **옛 좌표 기준으로**
 * 남는다. `transport`·`schools`·`infra` 는 행을 지우면 다음 날 재수집이 메우지만
 * (`--purge-derived`), `noxious` 는 그럴 수 없다:
 *
 * | | 재수집 주기 | 비웠을 때 화면 |
 * |---|---|---|
 * | transport·schools·infra | **매일** 05:30 | 하루만 빈칸(그래서 시간창 규칙이 있다) |
 * | **noxious** | **월 1회**(매월 3일) | 최대 한 달, 게다가 **감점이 0 이 되어 점수가 거꾸로 부푼다** |
 *
 * `scoreLocation.ts:134` 이 `(apt.noxious as string[]) \|\| []` 로 읽어 빈 배열 = 감점 0 이다.
 * 즉 비우는 것이 "정직한 빈칸"이 아니라 **반대 방향의 거짓**이 된다
 * ([[purge-to-recollect-timing]] §3 "빈칸이 화면에 어떻게 보이는지 먼저 확인").
 *
 * 그래서 이 도구가 `noxious.mjs` 의 `searchNearby`·`buildNoxiousRow` 를 **그대로 써서**
 * 그 자리에서 다시 잰다. 손으로 값을 만들지 않으므로 수집기와 같은 결과가 나온다.
 *
 * ## 실측 사례 (세션556 첨단 A8)
 *
 * `ah-2026910190` 호반써밋 첨단3지구(A8BL) — 세션549 가 좌표를 852m 옮겼는데 값이 안 따라왔다.
 *
 *     noxious_dist  DB 226m  →  실제 792m ("미래이엔지 광주공장")
 *
 * 임계가 500m 라(`NOXIOUS_DIST_THRESHOLD`) **감점 완화를 못 받고 있었다** — 그 단지만
 * 부당하게 깎이던 자리다.
 *
 * ⚠️ 같은 점검에서 `police_dist` 는 2,856 → 2,884m(28m 차)로 **거의 안 틀렸다.**
 * 경찰서가 2.9km 밖이라 852m 이동이 거리를 거의 안 바꾼 것이다. BACKLOG 의
 * "비-kakao 파생값이 옛 좌표 기준" 기록은 `noxious_dist` 에만 유효했다 — **항목마다 재라.**
 *
 *   node scripts/refresh-noxious-one.mjs <id> [<id> …]            # 미리보기
 *   node scripts/refresh-noxious-one.mjs <id> [<id> …] --apply    # 반영 + 재조회 대조
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY, KAKAO_KEY
 */
import { loadEnv, getSupabase, sleep, log, logError } from "./collectors/_shared.mjs";
import { searchNearby, buildNoxiousRow, NOXIOUS_KEYWORDS } from "./collectors/noxious.mjs";

const PHASE = "refresh-noxious";

/**
 * 한 단지를 다시 잰다.
 *
 * ⚠️ 검색이 **하나라도 실패하면 값을 만들지 않는다** — `noxious.mjs` 의 원칙과 같다.
 * 카카오 키 만료·5xx 로 전부 throw 하면 `found=[]` 가 "조회했고 없음"으로 저장되어
 * 소각장이 실제로 있는 단지가 감점을 영영 못 받는다(세션491 적대검증).
 *
 * @param {{ id: string, name?: string|null, lat: unknown, lng: unknown }} apt
 * @returns {Promise<{ ok: true, row: ReturnType<typeof buildNoxiousRow> } | { ok: false, errors: number }>}
 */
export async function remeasure(apt) {
  /** @type {string[]} */
  const found = [];
  let minDist = Infinity;
  let errors = 0;
  for (const { keyword, category } of NOXIOUS_KEYWORDS) {
    try {
      const results = await searchNearby(Number(apt.lat), Number(apt.lng), keyword);
      for (const r of results) {
        if (!found.includes(category)) found.push(category);
        if (r.dist < minDist) minDist = r.dist;
      }
    } catch (err) {
      errors++;
      logError(PHASE, `${apt.name ?? apt.id} "${keyword}": ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(120); // API rate limit 보호 (수집기와 같은 간격)
  }
  if (errors > 0) return { ok: false, errors };
  return { ok: true, row: buildNoxiousRow(apt.id, found, minDist) };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const ids = argv.filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    logError(PHASE, "단지 id 를 하나 이상 넘겨라 — 예: node scripts/refresh-noxious-one.mjs ah-2026910190");
    process.exit(1);
  }

  loadEnv();
  const sb = getSupabase();
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) ===");

  const { data, error } = await sb
    .from("apartments")
    .select("id, name, lat, lng, noxious, noxious_dist")
    .in("id", ids);
  if (error) {
    logError(PHASE, `조회 실패: ${error.message}`);
    process.exit(1);
  }
  const rows = data ?? [];
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) logError(PHASE, `없는 id ${missing.length}건: ${missing.join(", ")}`);

  /** @type {Array<{ id: string, name: string, before: unknown, after: unknown, row: any }>} */
  const plan = [];
  for (const apt of rows) {
    if (apt.lat == null || apt.lng == null) {
      logError(PHASE, `${apt.name ?? apt.id}: 좌표가 없어 건너뜀`);
      continue;
    }
    const res = await remeasure(apt);
    if (!res.ok) {
      logError(PHASE, `${apt.name ?? apt.id}: 검색 ${res.errors}건 실패 — 저장하지 않는다`);
      continue;
    }
    log(PHASE, `${apt.name ?? apt.id}`);
    log(PHASE, `  전: dist=${apt.noxious_dist ?? "null"} · ${JSON.stringify(apt.noxious)}`);
    log(PHASE, `  후: dist=${res.row.noxious_dist ?? "null"} · ${JSON.stringify(res.row.noxious)}`);
    plan.push({ id: apt.id, name: String(apt.name ?? apt.id), before: apt.noxious_dist, after: res.row.noxious_dist, row: res.row });
  }

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 (${plan.length}건) — 반영하려면 --apply ===`);
    return;
  }

  let ok = 0;
  for (const p of plan) {
    const { error: upErr } = await sb
      .from("apartments")
      .update({ noxious: p.row.noxious, noxious_dist: p.row.noxious_dist })
      .eq("id", p.id);
    if (upErr) logError(PHASE, `${p.id}: ${upErr.message}`);
    else ok++;
  }
  log(PHASE, `\n반영: 성공 ${ok} · 실패 ${plan.length - ok}`);

  // 반영 직후 대조 — 로그가 아니라 DB 가 그 값인지 본다.
  const { data: after } = await sb.from("apartments").select("id, noxious_dist").in("id", plan.map((p) => p.id));
  const byId = new Map((after ?? []).map((r) => [r.id, r.noxious_dist]));
  let mismatch = 0;
  for (const p of plan) {
    if (byId.get(p.id) !== p.row.noxious_dist) {
      mismatch++;
      logError(PHASE, `대조 불일치 ${p.id}: 기대 ${p.row.noxious_dist} · 실제 ${byId.get(p.id)}`);
    }
  }
  log(PHASE, `반영 직후 대조: 일치 ${plan.length - mismatch} · 불일치 ${mismatch}`);
  if (mismatch > 0) process.exit(1);
  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
