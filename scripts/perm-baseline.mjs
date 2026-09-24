// @ts-check
/**
 * 권한 정의 지문 기준선 — 미리보기·기대 파일 생성·승인(로컬 전용, 세션569).
 *
 * 감시 ⑩ 는 매주 `permission_drift_snapshot()` 으로 "지금 지문"과 "사람이 승인한 기준선"을 대조한다.
 * 이 스크립트는 그 기준선을 만드는 **유일한 통로**다. 원칙: 값은 DB, 코드는 공개 — 미리보기·기대 파일은
 * 비공개 폴더(.omc/, 깃 미추적)에만 쓰고, 콘솔에는 개수·해시·파일 경로만 찍는다.
 * 설계 문서(비공개) = .omc/artifacts/session569/perm_fingerprint_design.md §5
 *
 * 모드:
 *   (기본) 미리보기          node scripts/perm-baseline.mjs [--out=<md>]
 *   기대 파일 만들기         node scripts/perm-baseline.mjs --make-expect --after=<지문 json> --out=<json>
 *   의도한 변경 승인         node scripts/perm-baseline.mjs --accept --expect-file=<json> --note="PR #NNN …"
 *   첫 기준선 승인           node scripts/perm-baseline.mjs --accept --first --expect-hash=<미리보기 해시> --note="첫 기준선 — 사장님 승인 MM-DD"
 *
 * 안전장치:
 *   - GitHub Actions(`GITHUB_ACTIONS` 가 설정됨)에서는 실행 자체를 거부한다 — 승인은 사람 확인 뒤 로컬에서만.
 *   - 모든 승인은 SQL 쪽(accept_permission_baseline)이 지문을 다시 떠서 해시가 같을 때만 저장한다.
 *   - 서비스 열쇠는 기존 loadEnv()/getSupabase() 만 쓴다(새 비밀값 없음).
 *   - ⚠️ 이 스크립트를 `| tail` 같은 파이프 뒤에 두지 말 것 — 출력은 `> 파일 2>&1` 로 받는다
 *     (파이프가 닫히면 승인 도중 프로세스가 죽을 수 있다 — .claude/rules/collectors/pipe-kills-collector.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  diffPermissionFingerprint,
  compareWithExpectFile,
  extractAttentionItems,
  makeExpectFile,
  countByKind,
  KIND_LABEL,
  SENSITIVE_TABLES,
  canonicalJson,
} from "./_perm-fingerprint.mjs";

/**
 * GitHub Actions 안이면 거부 사유를, 아니면 null. GitHub 은 러너에 `GITHUB_ACTIONS=true` 를 항상 넣으므로
 * 값이 무엇이든 **설정돼 있으면** 거부한다.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function refuseInCi(env) {
  if (env.GITHUB_ACTIONS !== undefined) return "perm-baseline.mjs 는 GitHub Actions 에서 실행할 수 없습니다 — 기준선 승인은 사람 확인 뒤 로컬에서만.";
  return null;
}

/**
 * 출력 경로가 비공개 폴더(.omc/, 깃 미추적) 아래인가 — 미리보기·기대 파일에는 권한 명단이 통째로 담기므로
 * 공개 저장소에 실릴 수 있는 자리에는 쓰지 않는다.
 * @param {string} p
 * @returns {boolean}
 */
export function isUnderOmc(p) {
  return path.resolve(p).split(/[\\/]+/).includes(".omc");
}

/**
 * @param {string[]} argv
 * @returns {{ mode: "preview" | "make-expect" | "accept", out: string | null, after: string | null,
 *   expectFile: string | null, expectHash: string | null, first: boolean, note: string | null }}
 */
export function parseArgs(argv) {
  /** @param {string} name */
  const val = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const accept = argv.includes("--accept");
  const makeExpect = argv.includes("--make-expect");
  return {
    mode: accept ? "accept" : makeExpect ? "make-expect" : "preview",
    out: val("out"),
    after: val("after"),
    expectFile: val("expect-file"),
    expectHash: val("expect-hash"),
    first: argv.includes("--first"),
    note: val("note"),
  };
}

/**
 * 미리보기 문서(마크다운). 전체 명단은 이 파일에만(비공개 폴더).
 * @param {any} snapshot permission_drift_snapshot() 결과
 * @param {string[]} publicReadTables
 * @returns {{ md: string, summary: { counts: Record<string, number>, totalHash: string, diffCounts: { added: number, removed: number, changed: number } | null, attention: Record<string, number> } }}
 */
export function buildPreview(snapshot, publicReadTables) {
  const current = snapshot?.current ?? null;
  const baseline = snapshot?.baseline ?? null;
  const counts = countByKind(current);
  const attention = extractAttentionItems(current, { sensitiveTables: SENSITIVE_TABLES, publicReadTables });
  const diff = baseline ? diffPermissionFingerprint(current, baseline) : null;
  /** @type {string[]} */
  const md = [];
  md.push("# 권한 정의 지문 미리보기", "");
  md.push(`- 현재 total_hash: \`${current?.total_hash ?? "?"}\``);
  md.push(`- 항목 수: ${current?.item_count ?? "?"} · server_version_num ${current?.server_version_num ?? "?"} · scope_version ${current?.scope_version ?? "?"}`);
  md.push(baseline
    ? `- 기준선: #${baseline.id} (${baseline.accepted_at}) ${baseline.note ?? ""} · total_hash \`${baseline.total_hash}\``
    : "- 기준선: 없음(첫 승인 대상)");
  md.push("", "## 종류별 개수", "", "| 종류 | 개수 |", "|---|---|");
  for (const [k, n] of Object.entries(counts).sort()) md.push(`| ${KIND_LABEL[k] ?? k} (${k}) | ${n} |`);
  md.push("", "## 주의 항목(자동 추출)", "");
  for (const a of attention) {
    md.push(`### ${a.code} ${a.title} — ${a.lines.length}건`, "");
    for (const l of a.lines) md.push(`- ${l}`);
    md.push("");
  }
  if (diff) {
    md.push("## 기준선 대비 차이", "");
    md.push(`추가 ${diff.added.length} · 삭제 ${diff.removed.length} · 변경 ${diff.changed.length}` +
      (diff.majorChanged ? ` · 큰 판 ${diff.majorBefore}→${diff.majorAfter}` : "") +
      (diff.scopeChanged ? ` · 범위 v${diff.scopeBefore}→v${diff.scopeAfter}` : ""), "");
    for (const it of diff.added) md.push(`- 추가 ${it.k} ${it.n}: \`${canonicalJson(it.d)}\``);
    for (const it of diff.removed) md.push(`- 삭제 ${it.k} ${it.n}`);
    for (const c of diff.changed) {
      md.push(`- 변경 ${c.k} ${c.n}`);
      for (const f of c.fields) md.push(`  - ${f.path}: \`${canonicalJson(f.before)}\` → \`${canonicalJson(f.after)}\``);
    }
    md.push("");
  }
  md.push("## 전체 명단", "");
  for (const it of current?.items ?? []) md.push(`- ${it.k} ${it.n} \`${it.h}\``);
  md.push("");
  return {
    md: md.join("\n"),
    summary: {
      counts,
      totalHash: current?.total_hash ?? "?",
      diffCounts: diff ? { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length } : null,
      attention: Object.fromEntries(attention.map((a) => [a.code, a.lines.length])),
    },
  };
}

/**
 * 승인 전 판정(순수) — 기대 파일 대조 또는 첫 기준선 해시 대조. 통과하면 { ok: true }.
 * @param {any} snapshot
 * @param {ReturnType<typeof parseArgs>} args
 * @param {any} [expect] 기대 파일 내용(--expect-file 모드)
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function decideAccept(snapshot, args, expect) {
  const current = snapshot?.current ?? null;
  const baseline = snapshot?.baseline ?? null;
  /** @type {string[]} */
  const reasons = [];
  if (!current?.total_hash) reasons.push("현재 지문을 못 받았다");
  if (!args.note || args.note.trim().length < 5) reasons.push("--note 가 없거나 5자 미만");
  if (args.first) {
    if (baseline) reasons.push(`기준선이 이미 있다(#${baseline.id}) — --first 는 첫 기준선 전용, --expect-file 로 승인할 것`);
    if (!args.expectHash) reasons.push("--first 는 --expect-hash=<미리보기 해시> 가 필요");
    else if (current?.total_hash && args.expectHash !== current.total_hash) {
      reasons.push("미리보기 해시와 지금 해시가 다르다 — 미리보기 뒤 DB 가 바뀌었다. 미리보기부터 다시");
    }
  } else {
    if (!baseline) reasons.push("기준선이 없다 — 첫 기준선은 --first --expect-hash 로");
    else if (!expect) reasons.push("--expect-file 이 필요");
    else {
      const diff = diffPermissionFingerprint(current, baseline);
      const cmp = compareWithExpectFile(diff, baseline.total_hash, expect);
      reasons.push(...cmp.mismatches);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * 오류 메시지가 SQL 쪽 해시 재확인 실패인가(마이그의 RAISE 글자 'hash mismatch' 고정).
 * @param {string | undefined | null} msg
 */
export function isHashMismatch(msg) {
  return /hash mismatch/.test(String(msg ?? ""));
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>} 종료 코드
 */
export async function main(argv, env) {
  const refused = refuseInCi(env);
  if (refused) {
    console.error(`[perm-baseline] ${refused}`);
    return 1;
  }
  const args = parseArgs(argv);
  if (args.out && !isUnderOmc(args.out)) {
    console.error("[perm-baseline] --out 은 .omc/ 아래(비공개, 깃 미추적)만 허용한다 — 권한 명단이 통째로 담긴다");
    return 1;
  }
  const { loadEnv, getSupabase } = await import("./collectors/_shared.mjs");
  loadEnv();
  const sb = getSupabase();
  const { data: snapshot, error } = await sb.rpc("permission_drift_snapshot");
  if (error) {
    console.error(`[perm-baseline] permission_drift_snapshot 실패: ${error.code ?? error.message}`);
    return 1;
  }
  const { PUBLIC_READ_TABLES_BASELINE } = await import("./monitor-collectors.mjs");

  if (args.mode === "preview") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = args.out ?? path.join(".omc", "perm-baseline", `preview-${stamp}.md`);
    const { md, summary } = buildPreview(snapshot, PUBLIC_READ_TABLES_BASELINE);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.log(`[perm-baseline] 미리보기 저장: ${out}`);
    console.log(`[perm-baseline] 현재 total_hash: ${summary.totalHash}`);
    console.log(`[perm-baseline] 종류별 개수: ${Object.entries(summary.counts).map(([k, n]) => `${k}=${n}`).join(" · ")}`);
    console.log(`[perm-baseline] 주의 항목 개수: ${Object.entries(summary.attention).map(([k, n]) => `${k}=${n}`).join(" · ")}`);
    console.log(summary.diffCounts
      ? `[perm-baseline] 기준선 대비: 추가 ${summary.diffCounts.added} · 삭제 ${summary.diffCounts.removed} · 변경 ${summary.diffCounts.changed}`
      : "[perm-baseline] 기준선 없음 — 첫 승인 대상");
    return 0;
  }

  if (args.mode === "make-expect") {
    if (!args.after || !args.out) {
      console.error("[perm-baseline] --make-expect 는 --after=<지문 json> 과 --out=<json> 이 필요");
      return 1;
    }
    const baseline = snapshot?.baseline ?? null;
    if (!baseline) {
      console.error("[perm-baseline] 기준선이 없다 — 기대 파일은 기준선 위에서만 만든다");
      return 1;
    }
    const raw = JSON.parse(readFileSync(args.after, "utf8"));
    const after = raw?.current ?? raw; // 지문 그대로이거나 drift 스냅샷이거나
    const diff = diffPermissionFingerprint(after, baseline);
    const expect = makeExpectFile(diff, baseline.total_hash, path.basename(args.after));
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(expect, null, 2));
    console.log(`[perm-baseline] 기대 파일 저장: ${args.out} — 추가 ${diff.added.length} · 삭제 ${diff.removed.length} · 변경 ${diff.changed.length}`);
    return 0;
  }

  // accept
  const expect = args.expectFile ? JSON.parse(readFileSync(args.expectFile, "utf8")) : undefined;
  const decision = decideAccept(snapshot, args, expect);
  if (!decision.ok) {
    console.error("[perm-baseline] 승인 거부 — 아래가 기대와 다르다(아무것도 저장하지 않음):");
    for (const r of decision.reasons) console.error(`  · ${r}`);
    return 1;
  }
  const { data: accepted, error: acceptError } = await sb.rpc("accept_permission_baseline", {
    p_expected_hash: snapshot.current.total_hash,
    p_note: args.note,
  });
  if (acceptError) {
    const msg = acceptError.message ?? acceptError.code ?? "";
    console.error(isHashMismatch(msg)
      ? "[perm-baseline] 승인 거부 — 대조 뒤 DB 가 바뀌었다(hash mismatch). 미리보기부터 다시"
      : `[perm-baseline] 승인 실패: ${acceptError.code ?? msg}`);
    return 1;
  }
  console.log(`[perm-baseline] 기준선 저장: #${accepted?.baseline_id} · ${accepted?.item_count}항목 · ${accepted?.total_hash}`);
  return 0;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main(process.argv.slice(2), process.env).then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error("[perm-baseline] 오류:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
