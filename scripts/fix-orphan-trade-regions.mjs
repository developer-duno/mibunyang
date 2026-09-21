// @ts-check
/**
 * `trades` 의 **어디에도 속하지 않는 지역 라벨**을 동 이름으로 재판정해 옮긴다 — 세션556.
 *
 * ## 무엇이 문제인가
 *
 * 행정구역 개편(인천 2026, 전남광주 2026-07)과 수집기 오라벨이 남긴 잔재로,
 * `trades` 에 **`apartments` 쪽에는 존재하지 않는 `region|gu` 조합**이 남아 있다.
 * 이 레포의 화면은 `apartments (region, gu)` 로만 집계하므로 손님에게는 안 닿지만,
 * **공유 DB 를 함께 쓰는 자매 레포(naver-estate-web)의 시도 단위 조회에는 섞인다.**
 *
 * ⚠️ **지우면 안 된다.** 세션556 실측에서 이 행들은 **쌍둥이(같은 동·단지·월·가격·면적·층)가
 * 0건**이었다 — 다른 버킷에 같은 거래가 중복으로 있는 게 아니라, **그 거래의 유일한 기록**이다.
 * 지우면 그 거래가 영영 사라진다. 옛 BACKLOG 는 "삭제 후보"라 적었지만 그건 틀린 판단이다.
 *
 * ## 어떻게 판정하나 (동 이름을 하드코딩하지 않는다)
 *
 * 같은 `dong` 을 쓰는 **정상 행**들이 어느 `region|gu` 에 몰려 있는지로 정한다.
 * 근거가 둘이어야 옮긴다:
 *
 * | 근거 | 무엇 |
 * |---|---|
 * | **T** | 같은 동을 쓰는 `trades` 정상 행의 `region\|gu` 분포 |
 * | **A** | 같은 동을 쓰는 `apartments` 의 `region\|gu` 분포 |
 *
 * - T 가 **단 하나의 후보**로 모이고(다른 후보가 있으면 최상위가 90% 이상), 표본이 `--min-sample`
 *   이상이면 1차 후보. A 가 있으면 **A 와 일치할 때만** 옮긴다(둘이 어긋나면 `conflict`).
 * - A 가 없으면(그 동에 단지가 없는 경우) T 단독으로 옮기되 **표본을 더 요구**한다.
 * - 어느 쪽도 못 정하면 **그대로 둔다**. 정직한 방치가 잘못된 이동보다 낫다.
 *
 * ⚠️ **동 이름은 전국에서 유일하지 않다.** "학산동" 은 포항시 북구와 울산 중구 양쪽에 있고,
 * "북구"·"중구"·"서구" 는 여러 광역시에 있다. 그래서 T 의 **최상위 독점률**을 본다.
 * 세션556 실측에서 학산동은 포항 345 vs 울산 70 으로 갈렸지만, **단지 이름까지 맞대면**
 * (`학산 한신더휴 엘리트파크` → 포항 152건) 확정됐다 — 그래서 `apt_name` 근거(N)도 본다.
 *
 * ## 사용법
 *
 *   node scripts/fix-orphan-trade-regions.mjs                    # 계획만 출력(dry-run)
 *   node scripts/fix-orphan-trade-regions.mjs --out=<절대경로>    # 계획을 JSON 으로
 *   node scripts/fix-orphan-trade-regions.mjs --apply            # 실제 쓰기 + 재조회 검증
 *   node scripts/fix-orphan-trade-regions.mjs --apply --apply-from=<계획 json>  # 그 계획만 반영
 *
 * ⚠️ `--out`·`--apply-from` 은 **절대경로**로. Git Bash `/tmp` 는 node `resolve` 와 다른 폴더다.
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, getSupabase, log, logError, selectAll } from "./collectors/_shared.mjs";

const PHASE = "fix-orphan-trades";

/** T 단독(단지 없는 동)으로 옮길 때 요구하는 최소 표본. */
export const MIN_SAMPLE_T_ONLY = 50;
/** A 가 뒷받침할 때 요구하는 최소 표본. */
export const MIN_SAMPLE_WITH_A = 10;
/** 후보가 여럿일 때 최상위가 차지해야 하는 비율. */
export const DOMINANCE = 0.9;

/**
 * 시도 자체가 하나의 시라 `apartments.gu` 가 **null 로 저장되는** 지역.
 *
 * ⚠️ 이 목록이 없으면 세종이 통째로 "고아"로 잡힌다 — `apartments` 쪽 세종 단지는 `gu` 가
 * null 이라 `region|gu` 조합을 만들지 못하는데, `trades` 는 `세종|세종시` 로 저장하기 때문이다.
 * 세션556 dry-run 1차에서 실제로 **세종 거래 972건을 강원 원주시·경북 경산시로 옮기려 했다**
 * (반곡동·대평동이 세종에도, 원주·경산에도 있어서 표본 많은 쪽으로 끌려갔다).
 * 그 동 이름들은 세종에 실재하므로 **옮기면 안 되는 정상 행**이었다.
 */
export const SIDO_IS_CITY = new Set(["세종"]);

/**
 * `trades` 에 있지만 `apartments` 에는 없는 `region|gu` 조합을 찾는다.
 *
 * ⚠️ `apartments` 가 진실의 원천이다 — 화면·점수가 그 조합으로만 집계한다.
 * 단 `SIDO_IS_CITY` 는 `apartments.gu` 가 null 이라 조합이 안 만들어지므로 **고아가 아니다**.
 *
 * @param {Array<{region: string|null, gu: string|null}>} trades
 * @param {Array<{region: string|null, gu: string|null}>} apartments
 * @returns {Set<string>} `"인천|서구"` 형식
 */
export function findOrphanKeys(trades, apartments) {
  const valid = new Set();
  for (const a of apartments) {
    if (!a.region) continue;
    if (a.gu) valid.add(`${a.region}|${a.gu}`);
    // gu 가 null 인 시도(세종)는 trades 가 어떤 gu 로 적든 그 시도 전체를 정상으로 본다.
    else if (SIDO_IS_CITY.has(a.region)) valid.add(`${a.region}|*`);
  }
  const orphans = new Set();
  for (const t of trades) {
    if (!t.region || !t.gu) continue;
    if (valid.has(`${t.region}|*`)) continue;
    const k = `${t.region}|${t.gu}`;
    if (!valid.has(k)) orphans.add(k);
  }
  return orphans;
}

/**
 * 표를 세어 `{top, topCount, total, dominance}` 로 돌려준다.
 * @param {string[]} keys
 */
export function tally(keys) {
  /** @type {Record<string, number>} */
  const c = {};
  for (const k of keys) c[k] = (c[k] ?? 0) + 1;
  const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]);
  const total = keys.length;
  if (sorted.length === 0) return { top: null, topCount: 0, total: 0, dominance: 0, spread: c };
  return { top: sorted[0][0], topCount: sorted[0][1], total, dominance: sorted[0][1] / total, spread: c };
}

/**
 * 고아 행 하나를 어디로 옮길지 판정한다.
 *
 * @param {{region: string|null, gu: string|null, dong: string|null, apt_name: string|null}} row
 * @param {{byDongTrades: Map<string, string[]>, byDongApts: Map<string, string[]>, byNameTrades: Map<string, string[]>}} idx
 * @param {Set<string>} orphanKeys 판정 근거에서 제외할 조합(고아끼리 서로를 근거로 삼지 않게)
 * @returns {{verdict: "move"|"conflict"|"weak"|"nodata", to: string|null, reason: string, evidence: Record<string, unknown>}}
 */
export function classifyOrphan(row, idx, orphanKeys) {
  const dong = row.dong ?? "";
  if (!dong) return { verdict: "nodata", to: null, reason: "dong 이 비어 판정 불가", evidence: {} };

  // 근거에서 고아 조합 자체는 뺀다 — 고아끼리 서로를 근거로 삼으면 순환이다.
  const keep = (/** @type {string[]} */ ks) => ks.filter((k) => !orphanKeys.has(k));
  const T = tally(keep(idx.byDongTrades.get(dong) ?? []));
  const A = tally(keep(idx.byDongApts.get(dong) ?? []));
  const N = row.apt_name ? tally(keep(idx.byNameTrades.get(row.apt_name) ?? [])) : null;

  const evidence = {
    T: { top: T.top, count: T.topCount, total: T.total, dominance: Number(T.dominance.toFixed(3)) },
    A: { top: A.top, count: A.topCount, total: A.total },
    N: N ? { top: N.top, count: N.topCount, total: N.total } : null,
  };

  if (!T.top) return { verdict: "nodata", to: null, reason: `"${dong}" 을 쓰는 정상 거래가 없다`, evidence };

  /**
   * **시도를 건너뛰는 이동은 단지 이름 근거를 요구한다.**
   *
   * 같은 시도 안의 구 이동(인천 서구 → 서해구)은 행정구역 개편의 자연스러운 결과지만,
   * 다른 시도로 가는 것(세종 → 강원)은 **동 이름이 우연히 겹쳤을 뿐일 수 있다.**
   * 동 이름은 전국에서 유일하지 않다 — 반곡동은 세종·원주에, 대평동은 세종·경산에 있고,
   * 세션556 dry-run 1차가 정확히 그 함정으로 972건을 잘못 옮기려 했다.
   * 단지 이름(N)은 동보다 훨씬 구체적이라 시도를 건너뛸 근거가 된다(학산동 사례).
   */
  const fromRegion = row.region ?? "";
  const crossesSido = (/** @type {string} */ to) => to.split("|")[0] !== fromRegion;

  // 단지 이름 근거가 있으면 그게 가장 강하다 — 동 이름보다 구체적이다(학산동 사례).
  if (N?.top && N.total >= MIN_SAMPLE_WITH_A && N.dominance >= DOMINANCE) {
    if (A.top && A.top !== N.top) {
      return { verdict: "conflict", to: null, reason: `단지명 근거(${N.top})와 단지목록(${A.top})이 어긋난다`, evidence };
    }
    return { verdict: "move", to: N.top, reason: `같은 단지명 거래 ${N.topCount}/${N.total}건이 ${N.top}`, evidence };
  }

  /**
   * 시도를 건너뛰려면 **그 동이 출발 시도에는 아예 없어야** 한다.
   *
   * "휘경동" 은 대구에 없고 서울 동대문구에만 713건 있다 — 즉 `대구|대구` 라벨 자체가 거짓이고
   * 동 이름이 진실이다. 반대로 "반곡동" 은 세종에도 원주에도 있어서 이 검사에 걸린다
   * (세션556 dry-run 1차가 972건을 잘못 옮기려 한 그 자리).
   */
  if (T.top && crossesSido(T.top)) {
    const inFromSido = (idx.byDongTrades.get(dong) ?? []).filter(
      (k) => k.startsWith(`${fromRegion}|`) && !orphanKeys.has(k),
    ).length;
    const aptInFromSido = (idx.byDongApts.get(dong) ?? []).filter((k) => k.startsWith(`${fromRegion}|`)).length;
    if (inFromSido > 0 || aptInFromSido > 0) {
      return {
        verdict: "weak",
        to: null,
        reason: `"${dong}" 은 ${fromRegion} 에도 실재한다(거래 ${inFromSido} · 단지 ${aptInFromSido}) — 시도를 건너뛸 근거가 없다`,
        evidence,
      };
    }
    if (T.total < MIN_SAMPLE_T_ONLY) {
      return { verdict: "weak", to: null, reason: `시도를 건너뛰는데 표본 부족(${T.total} < ${MIN_SAMPLE_T_ONLY})`, evidence };
    }
    const aTop = A.top && A.top !== T.top ? A.top : null;
    if (aTop) return { verdict: "conflict", to: null, reason: `거래 근거(${T.top})와 단지목록(${aTop})이 어긋난다`, evidence };
    return {
      verdict: "move",
      to: T.top,
      reason: `"${dong}" 은 ${fromRegion} 에 없고 ${T.top} 에만 ${T.topCount}/${T.total}건${A.top ? ` + 단지 ${A.topCount}곳` : ""}`,
      evidence,
    };
  }

  /**
   * **같은 시도 안에서 먼저 본다.** 고아의 시도(`region`)는 대개 맞고 `gu` 표기만 틀렸다
   * (행정구역 개편·"시 이름 빠진 구 표기"). 전국 분포로 판정하면 다른 시도의 동명이의가
   * 섞여 멀쩡한 후보가 밀린다 — 세션556 실측: "원당동" 은 인천 검단구 2,310건이 유일한
   * 인천 내 후보인데 충남 당진 285건이 섞여 88%로 내려가 막혔고, "공촌동" 은 인천 서해구
   * 18건이 유일한데 표본 하한에 막혔다. 둘 다 같은 시도 안에서는 **독점**이다.
   */
  const sameSido = tally(keep(idx.byDongTrades.get(dong) ?? []).filter((k) => k.startsWith(`${fromRegion}|`)));
  if (sameSido.top && sameSido.dominance >= DOMINANCE) {
    const aSame = A.top && A.top.startsWith(`${fromRegion}|`) ? A.top : null;
    if (aSame && aSame !== sameSido.top) {
      return { verdict: "conflict", to: null, reason: `같은 시도 거래 근거(${sameSido.top})와 단지목록(${aSame})이 어긋난다`, evidence };
    }
    return {
      verdict: "move",
      to: sameSido.top,
      reason: `${fromRegion} 안에서 "${dong}" 거래 ${sameSido.topCount}/${sameSido.total}건이 ${sameSido.top}${aSame ? ` + 단지 ${A.topCount}곳` : ""}`,
      evidence: { ...evidence, sameSido: { top: sameSido.top, count: sameSido.topCount, total: sameSido.total } },
    };
  }

  /**
   * **"시 이름이 빠진 구 표기"** — `경남|의창구` 처럼 고아의 `gu` 가 정상 조합의 `gu` 뒤쪽과
   * 정확히 일치하면, 앞에 시 이름만 붙이면 된다. 세션549 가 `apartments` 에서 고친 것과 같은 사고다.
   *
   * ⚠️ 이 규칙이 필요한 이유: 목적지 표기가 둘로 갈리면(`경남|창원시 의창구` 195건 vs
   * `경남|창원시` 132건) 동 이름 분포가 60% 로 떨어져 위 독점 검사에 막힌다. 그런데 이건
   * 애매한 게 아니라 **목적지 쪽 표기가 둘인 것**이고, 고아 라벨 자체("의창구")가 답을 갖고 있다.
   * 같은 시도 안에서 뒤쪽이 일치하는 후보가 **정확히 하나**일 때만 쓴다.
   */
  const gu = row.gu ?? "";
  if (gu) {
    const suffixMatches = [...new Set(keep(idx.byDongTrades.get(dong) ?? []).concat(keep(idx.byDongApts.get(dong) ?? [])))].filter(
      (k) => k.startsWith(`${fromRegion}|`) && k.split("|")[1]?.endsWith(` ${gu}`),
    );
    if (suffixMatches.length === 1) {
      return {
        verdict: "move",
        to: suffixMatches[0],
        reason: `"${gu}" 는 시 이름이 빠진 표기 — ${fromRegion} 안에서 "${dong}" 을 쓰는 후보가 ${suffixMatches[0]} 하나뿐`,
        evidence: { ...evidence, suffixMatches },
      };
    }
  }

  if (T.dominance < DOMINANCE) {
    return { verdict: "weak", to: null, reason: `"${dong}" 이 여러 지역에 흩어져 있다(최상위 ${(T.dominance * 100).toFixed(0)}%)`, evidence };
  }

  if (A.top) {
    if (A.top !== T.top) {
      return { verdict: "conflict", to: null, reason: `거래 근거(${T.top})와 단지목록(${A.top})이 어긋난다`, evidence };
    }
    if (T.total < MIN_SAMPLE_WITH_A) {
      return { verdict: "weak", to: null, reason: `표본 부족(${T.total} < ${MIN_SAMPLE_WITH_A})`, evidence };
    }
    return { verdict: "move", to: T.top, reason: `거래 ${T.topCount}/${T.total}건 + 단지 ${A.topCount}곳이 ${T.top}`, evidence };
  }

  // A 가 없다 — 그 동에 단지가 없는 경우. 표본을 더 요구한다.
  if (T.total < MIN_SAMPLE_T_ONLY) {
    return { verdict: "weak", to: null, reason: `단지 근거 없음 + 표본 부족(${T.total} < ${MIN_SAMPLE_T_ONLY})`, evidence };
  }
  return { verdict: "move", to: T.top, reason: `거래 ${T.topCount}/${T.total}건이 ${T.top}(단지 근거 없음)`, evidence };
}

/**
 * 인덱스 3종을 만든다.
 * @param {Array<Record<string, any>>} trades
 * @param {Array<Record<string, any>>} apartments
 */
export function buildIndexes(trades, apartments) {
  /** @type {Map<string, string[]>} */
  const byDongTrades = new Map();
  /** @type {Map<string, string[]>} */
  const byNameTrades = new Map();
  for (const t of trades) {
    if (!t.region || !t.gu) continue;
    const k = `${t.region}|${t.gu}`;
    if (t.dong) {
      const arr = byDongTrades.get(t.dong);
      if (arr) arr.push(k);
      else byDongTrades.set(t.dong, [k]);
    }
    if (t.apt_name) {
      const arr = byNameTrades.get(t.apt_name);
      if (arr) arr.push(k);
      else byNameTrades.set(t.apt_name, [k]);
    }
  }
  /** @type {Map<string, string[]>} */
  const byDongApts = new Map();
  for (const a of apartments) {
    if (!a.region || !a.gu || !a.dong) continue;
    const k = `${a.region}|${a.gu}`;
    const arr = byDongApts.get(a.dong);
    if (arr) arr.push(k);
    else byDongApts.set(a.dong, [k]);
  }
  return { byDongTrades, byDongApts, byNameTrades };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const outArg = argv.find((a) => a.startsWith("--out="));
  const fromArg = argv.find((a) => a.startsWith("--apply-from="));

  loadEnv();
  const sb = getSupabase();

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) ===");

  // --apply-from: 그 계획만 반영한다(재판정 0회). `fix-placeholder-addresses` 관례를 따른다 —
  // 재판정하면 그 사이 데이터가 바뀌었을 때 "검토한 것과 다른 게" 반영된다(세션542 실사고).
  if (fromArg) {
    const p = resolve(fromArg.slice("--apply-from=".length));
    if (!existsSync(p)) {
      logError(PHASE, `--apply-from 파일 없음: ${p}`);
      process.exit(1);
    }
    const plan = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(plan.moves)) {
      logError(PHASE, "--apply-from 형식 오류: moves 가 배열이 아니다");
      process.exit(1);
    }
    log(PHASE, `--apply-from: ${p} (moves ${plan.moves.length}건)`);
    if (!apply) {
      for (const m of plan.moves) log(PHASE, `  ${m.id} ${m.from} → ${m.to}  (${m.dong} ${m.apt_name ?? "-"})`);
      log(PHASE, "=== 미리보기 종료 — 반영하려면 --apply ===");
      return;
    }
    await applyMoves(sb, plan.moves);
    return;
  }

  const [trades, apartments] = await Promise.all([
    selectAll((s) => s.from("trades").select("id,region,gu,dong,apt_name,deal_month,price,area,floor"), sb, "id"),
    selectAll((s) => s.from("apartments").select("id,region,gu,dong"), sb, "id"),
  ]);
  log(PHASE, `trades ${trades.length}행 · apartments ${apartments.length}행`);

  const orphanKeys = findOrphanKeys(trades, apartments);
  log(PHASE, `고아 조합 ${orphanKeys.size}개: ${[...orphanKeys].sort().join(", ") || "(없음)"}`);

  const orphanRows = trades.filter((t) => t.region && t.gu && orphanKeys.has(`${t.region}|${t.gu}`));
  log(PHASE, `고아 행 ${orphanRows.length}건`);
  if (orphanRows.length === 0) {
    log(PHASE, "옮길 것이 없다 — 종료");
    return;
  }

  const idx = buildIndexes(trades, apartments);
  const moves = [];
  const skipped = [];
  for (const r of orphanRows) {
    const v = classifyOrphan(r, idx, orphanKeys);
    const from = `${r.region}|${r.gu}`;
    if (v.verdict === "move" && v.to) {
      const [region, gu] = v.to.split("|");
      moves.push({ id: r.id, from, to: v.to, region, gu, dong: r.dong, apt_name: r.apt_name, deal_month: r.deal_month, price: r.price, reason: v.reason, evidence: v.evidence });
    } else {
      skipped.push({ id: r.id, from, dong: r.dong, apt_name: r.apt_name, verdict: v.verdict, reason: v.reason, evidence: v.evidence });
    }
  }

  log(PHASE, "");
  log(PHASE, `=== 옮길 것 ${moves.length}건 ===`);
  for (const m of moves) {
    log(PHASE, `  ${String(m.id).padStart(8)} ${m.from.padEnd(16)} → ${m.to.padEnd(18)} | ${String(m.dong).padEnd(8)} ${m.apt_name ?? "-"}`);
    log(PHASE, `           ${m.reason}`);
  }
  if (skipped.length) {
    log(PHASE, "");
    log(PHASE, `=== 그대로 두는 것 ${skipped.length}건 ===`);
    for (const s of skipped) log(PHASE, `  ${String(s.id).padStart(8)} ${s.from.padEnd(16)} [${s.verdict}] ${s.dong ?? "-"} — ${s.reason}`);
  }

  if (outArg) {
    const p = resolve(outArg.slice("--out=".length));
    writeFileSync(p, JSON.stringify({ generatedAt: new Date().toISOString(), tradesCount: trades.length, orphanKeys: [...orphanKeys], moves, skipped }, null, 1));
    log(PHASE, `\nJSON 계획: ${p} (moves ${moves.length} · skipped ${skipped.length})`);
  }

  if (!apply) {
    log(PHASE, "\n=== 미리보기 종료 — 반영하려면 --apply ===");
    return;
  }
  await applyMoves(sb, moves);
}

/**
 * 계획대로 `region`·`gu` 를 UPDATE 하고 **재조회로 검증**한다.
 * @param {any} sb
 * @param {Array<{id: any, to: string, region: string, gu: string}>} moves
 */
async function applyMoves(sb, moves) {
  let ok = 0;
  let fail = 0;
  for (const m of moves) {
    const { error } = await sb.from("trades").update({ region: m.region, gu: m.gu }).eq("id", m.id);
    if (error) {
      logError(PHASE, `${m.id}: ${error.message}`);
      fail++;
    } else ok++;
  }
  log(PHASE, `\n재배치: 성공 ${ok} · 실패 ${fail}`);

  // 반영 직후 대조 — 로그의 "성공" 이 아니라 DB 가 그 값인지 본다.
  const ids = moves.map((m) => m.id);
  const check = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from("trades").select("id,region,gu").in("id", ids.slice(i, i + 150));
    if (data) check.push(...data);
  }
  const byId = new Map(check.map((r) => [String(r.id), `${r.region}|${r.gu}`]));
  let match = 0;
  let mismatch = 0;
  for (const m of moves) {
    if (byId.get(String(m.id)) === m.to) match++;
    else {
      mismatch++;
      logError(PHASE, `대조 불일치 ${m.id}: 기대 ${m.to} · 실제 ${byId.get(String(m.id)) ?? "(조회 실패)"}`);
    }
  }
  log(PHASE, `반영 직후 대조: 일치 ${match} · 불일치 ${mismatch}`);
  if (mismatch > 0) process.exit(1);
  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI =
  !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
