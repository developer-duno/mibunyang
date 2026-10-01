// 변이 시험(채우기 스크립트): 규칙을 하나씩 고장 내고 시험이 빨강이 되는지 본다. 되돌림·판정 규칙은 mutate-lib.mjs 머리말.
// 사용: node mutate-assign.mjs <워크트리 절대경로>
import { runMutations } from "./mutate-lib.mjs";

const FAIL_RECORD = 'if (apply) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 0, skip: rowCount, errorMessage: `${marker} ${why}` });';

/** @type {Array<[string, string, string]>} */
const MUT = [
  // ── 순수 함수 ──
  ["A1 같은 값도 고친다(바뀐 행만 고치기 끔)", "if (prev === next) { unchanged++; continue; }", "if (prev === next) { unchanged++; }"],
  ["A2 차단기 행 수 상한을 끔", "const overRows = changed > CHANGE_BREAKER_MAX_ROWS;", "const overRows = false;"],
  ["A5 빈칸 채움을 바뀐 것으로 셈", "if (prev == null) filled++;\n    else changed++;", "changed++;"],
  ["A8 차단기 비율 한도를 끔", "const overRatio = ratio > CHANGE_BREAKER_RATIO;", "const overRatio = false;"],
  ["A9 승인 파일 대조: 늘 같다고 답함", "return { same: onlyCurrent.length === 0 && onlyApproved.length === 0, onlyCurrent, onlyApproved };", "return { same: true, onlyCurrent, onlyApproved };"],
  ["A12 승인 파일 대조에서 이전 값을 안 봄", "JSON.stringify([u?.id ?? null, u?.prev ?? null, u?.next ?? null])", "JSON.stringify([u?.id ?? null, null, u?.next ?? null])"],
  ["A23 대조 줄을 구분자로 이어 붙임(옛 방식)", "JSON.stringify([u?.id ?? null, u?.prev ?? null, u?.next ?? null])", '`${u?.id}|${u?.prev ?? ""}|${u?.next}`'],
  // ── 인자 읽기 ──
  ["A13 --apply-from 만으로는 안 씀(쓰기 스위치에서 뺌)", "return { apply: applyFlag || applyFrom != null, applyFrom, out };", "return { apply: applyFlag, applyFrom, out };"],
  ["A14 --apply-from 과 --out 을 같이 줘도 받음", "if (applyFrom != null && out != null) {", "if (false) {"],
  ["A21 모르는 인자를 그냥 넘김(--dry-run·개수 승인 인자 포함)", "if (unknown.length > 0) {", "if (false) {"],
  ["A24 --apply-from 을 두 번 줘도 받음", 'if (applyFrom != null) throw new Error("--apply-from 이 두 번', 'if (false) throw new Error("--apply-from 이 두 번'],
  // ── 실패 경로 ──
  ["A15 실패를 기록하지 않음", FAIL_RECORD, ""],
  ["A16 미리보기 실패도 기록함(조건 뒤집기)", FAIL_RECORD, FAIL_RECORD.replace("if (apply)", "if (!apply)")],
  ["A17 실패해도 종료 코드 0", "errorMessage: `${marker} ${why}` });\n  process.exitCode = 1;", "errorMessage: `${marker} ${why}` });"],
  ["A32 failRun 이 첫머리에서 바로 돌아감", "  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);\n  if (apply) await", "  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);\n  return;\n  if (apply) await"],
  ["A18 차단기에 걸려도 이어서 씀(돌아가지 않음)", 'await failRun(apply, "KEY_BREAKER", `차단기 발동: ${breaker.reason}`, rows.length);\n    return;', 'await failRun(apply, "KEY_BREAKER", `차단기 발동: ${breaker.reason}`, rows.length);'],
  ["A31 섞인 묶음 실패 처리를 주석으로 끔", '    await failRun(apply, "KEY_MIXED", why, rows.length);', '    // await failRun(apply, "KEY_MIXED", why, rows.length);'],
  ["A20 --apply-from 단독 실행의 예외를 기록하지 않음", 'process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));', 'process.argv.includes("--apply");'],
  ["A33 예외로 죽어도 종료 코드 0", "errorMessage: `KEY_ERROR ${msg}` });\n    process.exitCode = 1;", "errorMessage: `KEY_ERROR ${msg}` });"],
  // ── main() 배선 ──
  ["A25 미리보기도 쓴다(쓰기 스위치를 늘 참으로)", "  const { apply, applyFrom } = args;", "  const { applyFrom } = args;\n  const apply = true;"],
  ["A27 행 수 대조 조건을 느슨하게(|| → &&)", "if (countError || count == null || count !== rows.length) {", "if (countError && count == null && count !== rows.length) {"],
  ["A11 섞인 묶음이 있어도 쓴다", "if (mixed.length > 0) {", "if (false) {"],
  ["A30 섞인 묶음 확인에 빈 목록을 넘김", "  const mixed = findMixedBundles(rows, keys);", "  const mixed = /** @type {ReturnType<typeof findMixedBundles>} */ ([]);"],
  ["A28 차단기에 0 을 넘김", "  const breaker = evaluateChangeBreaker(plan);", "  const breaker = evaluateChangeBreaker({ changed: 0, hadKey: plan.hadKey });"],
  ["A4 차단기 판정을 끔(걸려도 쓴다)", "} else if (breaker.tripped) {", "} else if (false) {"],
  ["A10 승인 파일과 달라도 쓴다", "if (!cmp.same) {", "if (false) {"],
  ["A26 승인 대조를 파일끼리 맞댐", "comparePlanToApproved(plan.updates, approvedUpdates)", "comparePlanToApproved(/** @type {any} */ (approvedUpdates), approvedUpdates)"],
  ["A22 승인 파일 모양 확인을 DB 조회 앞에서 뺌", "if (!Array.isArray(approvedUpdates)) throw new Error(`승인한 계획 파일에 updates 배열이 없습니다: ${applyFrom}`);", ""],
  // ── 쓰기 ──
  ["A7 다른 칸도 같이 씀", ".update({ complex_key: u.next })", ".update({ complex_key: u.next, name: u.next })"],
  ["A34 id 조건 없이 씀(빈칸 행 전부를 덮는다)", '.update({ complex_key: u.next }).eq("id", u.id);', ".update({ complex_key: u.next });"],
  ["A19 이전 값 조건 없이 씀", 'return (u.prev == null ? q.is("complex_key", null) : q.eq("complex_key", u.prev)).select("id");', 'return q.select("id");'],
  ["A29 0행 반환을 성공으로 셈", "if (res.error || !res.data || res.data.length === 0) {", "if (res.error || !res.data) {"],
  ["A35 쓰기 실패 머리말(KEY_WRITE)을 뺌", "const writeNote = fail ? `KEY_WRITE ${fail}행 실패(0행 반환 포함)` : missing.length > 0", "const writeNote = missing.length > 0"],
  ["A36 쓰다가 실패해도 종료 코드 0", "  if (fail) process.exitCode = 1;", ""],
  ["A38 쓰다가 실패해도 기록 상태는 성공(실패 수를 안 실음)", "  if (fail) rpt.fail(fail);", ""],
  // ── 검사관 A4 가 찾은 자리 ──
  ["A37 승인 대조 분기를 끔(승인 파일이 있어도 차단기만 거침)", "  if (applyFrom != null) {\n    // 사람이 승인한 반영", "  if (false) {\n    // 사람이 승인한 반영"],
  ["A39 parseArgs 결과에 쓰기 스위치를 덧칠", "  const args = parseArgs(process.argv);", "  const args = { ...parseArgs(process.argv), apply: true };"],
  ["A40 전 행 조회에 필터를 붙임", '.select("id,name,region,gu,lat,lng,presale_type,complex_key"),', '.select("id,name,region,gu,lat,lng,presale_type,complex_key").not("complex_key", "is", null),'],
  ["A41 행 수 세기에 필터를 붙임", '.select("id", { count: "exact", head: true });', '.select("id", { count: "exact", head: true }).not("complex_key", "is", null);'],
];
// (뺀 것) A3 "승인 숫자가 달라도 통과"·A6 "--expect-changed 꼴 검사 끔" — 개수 승인 인자를 없애면서 대상 코드가 사라졌다(A21 이 그 자리를 지킨다).

runMutations({
  worktree: process.argv[2],
  target: "scripts/collectors/assign-complex-keys.mjs",
  tests: ["scripts/collectors/assign-complex-keys.test.mjs"],
  mutations: MUT,
});
