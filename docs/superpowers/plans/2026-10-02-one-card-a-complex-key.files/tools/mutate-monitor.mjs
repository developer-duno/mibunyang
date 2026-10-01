// 변이 시험(감시 ⑭). 감시 편집(apply-monitor-patch.mjs)이 적용된 상태에서 돌린다. 되돌림·판정 규칙은 mutate-lib.mjs 머리말.
// 사용: node mutate-monitor.mjs <워크트리 절대경로>
import { runMutations } from "./mutate-lib.mjs";

/** @type {Array<[string, string, string]>} */
const MUT = [
  ["N1 '오래된 행만' 조건을 뒤집음", "now.getTime() - t > gapHours * 3600000", "now.getTime() - t < gapHours * 3600000"],
  ["N2 ⑭ 를 매일 점검 묶음에서 뺌", "const gapIssues = checkComplexKeyGaps(gapRows).concat(checkComplexKeyRunStale(latestSuccess));", "const gapIssues = /** @type {Issue[]} */ ([]);"],
  ["N4 상한 표시 끔", 'rows.length >= fetchLimit ? "곳 이상" : "곳"', '"곳"'],
  ["N5 마지막 성공이 오래돼도 통과", "if (Number.isFinite(t) && now.getTime() - t <= gapHours * 3600000) return [];", "if (Number.isFinite(t)) return [];"],
  ["N6 마지막 성공 점검을 묶음에서 뺌", ".concat(checkComplexKeyRunStale(latestSuccess))", ""],
  ["N7 성공 기록이 없어도 통과", "if (Number.isFinite(t) && now.getTime() - t <= gapHours * 3600000) return [];", "if (!Number.isFinite(t) || now.getTime() - t <= gapHours * 3600000) return [];"],
];
// (N3 "날짜가 아닌 created_at 도 셈" 은 뺐다 — NaN 비교는 어차피 거짓이라 동작이 같다. 등가 변이.)

runMutations({
  worktree: process.argv[2],
  target: "scripts/monitor-collectors.mjs",
  tests: ["scripts/monitor-complex-key.test.mjs", "scripts/monitor-check-failed.test.mjs"],
  mutations: MUT,
});
