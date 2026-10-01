// 계획서 가) Task 5(감시 ⑭)의 편집을 워크트리에 적용하는 스크립트. 사용: node apply-monitor-patch.mjs <워크트리>
// 세 파일의 바꿀 자리를 **전부 먼저 확인한 뒤** 한꺼번에 쓴다 — 하나라도 찾는 글자가 1번이 아니면 어느 파일도 안 바뀐다.
// (파일마다 바로 쓰면 둘째·셋째 파일에서 던질 때 첫 파일만 바뀐 채 남고, 다시 돌리면 첫 파일에서 던진다.)
import { readFileSync, writeFileSync } from "node:fs";
const W = process.argv[2];
if (!W) throw new Error("사용: node apply-monitor-patch.mjs <워크트리 절대경로>");
/** @type {Array<[string, string]>} 확인을 통과한 [경로, 새 내용] — 맨 끝에서 한꺼번에 쓴다 */
const pending = [];
const rep = (path, pairs) => {
  let s = readFileSync(path, "utf8");
  const eol = s.includes("\r\n") ? "\r\n" : "\n"; // 윈도우 작업 폴더는 CRLF — 찾는 글자·넣는 글자의 줄바꿈을 파일에 맞춘다
  for (const [find0, to0] of pairs) {
    const find = find0.replace(/\n/g, eol), to = to0.replace(/\n/g, eol);
    const n = s.split(find).length - 1;
    if (n !== 1) throw new Error(`${path}: 찾는 글자가 ${n}번 나옴(1번이어야 함) — 아무 파일도 바꾸지 않았습니다 — ${find.slice(0, 60)}`);
    s = s.replace(find, () => to);
  }
  pending.push([path, s]);
};

const MON = W + "/scripts/monitor-collectors.mjs";
const NEW_BLOCK = `
/** ⑭ 만든 지 이 시간이 지났는데 묶음 열쇠 칸이 비어 있으면 채우기 배치가 안 돈 것으로 본다(매일 03시 굽기 + 여유). */
export const COMPLEX_KEY_GAP_HOURS = 36;
/** ⑭ 조회 상한 — 명단은 앞의 몇 건만 보여 주므로 전부 읽지 않는다. */
export const COMPLEX_KEY_GAP_FETCH_LIMIT = 200;

/**
 * ⑭ 묶음 열쇠 칸(\`apartments.complex_key\`) 빈 행 — "한 단지 = 한 장"(설계서 2026-10-01-one-complex-one-card.md §4-7 (6)).
 *
 * 칸은 \`scripts/collectors/assign-complex-keys.mjs\` 가 매일 굽기(daily-deploy) 앞 단계에서 채운다. 그 단계는
 * 실패해도 굽기를 막지 않게 돼 있어서(continue-on-error), 안 돌거나 실패해도 워크플로는 초록이다.
 * 실패 **기록**이 남은 경우는 ⑬ 이 알리고, 이 점검은 "아예 안 돌았다"까지 잡는다:
 * 만든 지 \`COMPLEX_KEY_GAP_HOURS\` 가 지난 행의 칸이 비어 있으면 그 배치가 하루 넘게 일을 안 한 것이다.
 * 새로 들어온 행(다음 굽기 전)은 빈칸이 정상이라 세지 않는다.
 *
 * @param {Array<{ id?: string|null, name?: string|null, created_at?: string|null }>} rows complex_key 가 빈 행(created_at 오름차순)
 * @param {{ now?: Date, gapHours?: number, fetchLimit?: number }} [opts]
 * @returns {Issue[]}
 */
export function checkComplexKeyGaps(rows, opts = {}) {
  const now = opts.now ?? new Date();
  const gapHours = opts.gapHours ?? COMPLEX_KEY_GAP_HOURS;
  const fetchLimit = opts.fetchLimit ?? COMPLEX_KEY_GAP_FETCH_LIMIT;
  const old = rows
    .filter((r) => {
      const t = r?.created_at ? new Date(r.created_at).getTime() : NaN;
      return Number.isFinite(t) && now.getTime() - t > gapHours * 3600000;
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (old.length === 0) return [];
  const shown = old.slice(0, 5).map((r) => \`\${r.name ?? ""}(\${r.id ?? "?"})\`);
  const rest = old.length - shown.length;
  return [
    {
      kind: "stale",
      collector: "assign-complex-keys",
      detail: \`묶음 열쇠 칸이 빈 단지 \${old.length}\${rows.length >= fetchLimit ? "곳 이상" : "곳"} — 만든 지 \${gapHours}시간 넘음\`,
      lines: [
        "열쇠 채우기(assign-complex-keys)가 매일 굽기 앞에서 돌지 않았거나 실패했습니다.",
        \`예: \${shown.join(", ")}\${rest > 0 ? \` 외 \${rest}곳\` : ""}\`,
        "daily-deploy 실행 로그의 'Assign complex keys' 단계를 확인하고, 필요하면 손으로 1회 돌리세요(미리보기 먼저).",
      ],
      at: String(old[0].created_at),
    },
  ];
}

/**
 * ⑭ 채우기 배치의 마지막 성공이 오래됐는가. 새 행이 없는 날에는 빈칸이 안 생겨 \`checkComplexKeyGaps\` 만으로는
 * "배치가 안 돈다"가 보이지 않는다 — 그날 새 블록 공고 때문에 기존 행 열쇠가 바뀌어야 했다면 그대로 낡는다.
 * 그래서 \`collector_runs\` 의 가장 최근 success 행이 \`COMPLEX_KEY_GAP_HOURS\` 보다 오래됐거나 없으면 알린다.
 *
 * @param {{ finished_at?: string|null } | null | undefined} latestSuccess 가장 최근 success 행(없으면 null)
 * @param {{ now?: Date, gapHours?: number }} [opts]
 * @returns {Issue[]}
 */
export function checkComplexKeyRunStale(latestSuccess, opts = {}) {
  const now = opts.now ?? new Date();
  const gapHours = opts.gapHours ?? COMPLEX_KEY_GAP_HOURS;
  const t = latestSuccess?.finished_at ? new Date(latestSuccess.finished_at).getTime() : NaN;
  if (Number.isFinite(t) && now.getTime() - t <= gapHours * 3600000) return [];
  const hours = Number.isFinite(t) ? Math.floor((now.getTime() - t) / 3600000) : null;
  return [
    {
      kind: "stale",
      collector: "assign-complex-keys",
      detail: hours == null ? "묶음 열쇠 채우기의 성공 기록이 없음" : \`묶음 열쇠 채우기의 마지막 성공이 \${hours}시간 전(기준 \${gapHours}시간)\`,
      lines: [
        "열쇠 채우기(assign-complex-keys)는 매일 굽기 앞에서 돌아야 합니다 — 안 돌면 새 블록 공고가 들어온 단지의 묶음이 낡습니다.",
        "daily-deploy 실행 로그의 'Assign complex keys' 단계를 확인하고, 필요하면 손으로 1회 돌리세요(미리보기 먼저).",
      ],
      at: latestSuccess?.finished_at ?? "기록 없음",
    },
  ];
}

/**
 * ⑭ 재료 — 묶음 열쇠 칸이 빈 행(오래된 순)과 채우기 배치의 가장 최근 success 행.
 * 칸이 아직 없으면(마이그레이션 전) 조회가 실패하고 runFailOpenCheck 가 알린다.
 * @returns {Promise<{ gapRows: Array<Record<string, any>>, latestSuccess: Record<string, any> | null }>}
 */
async function fetchComplexKeyHealth() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("apartments")
    .select("id,name,created_at")
    .is("complex_key", null)
    .order("created_at", { ascending: true })
    .limit(COMPLEX_KEY_GAP_FETCH_LIMIT);
  if (error) throw new Error(\`apartments(묶음 열쇠 빈 행) 조회 실패: \${error.message}\`);
  const { data: runs, error: runError } = await sb
    .from("collector_runs")
    .select("finished_at")
    .eq("collector", "assign-complex-keys")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (runError) throw new Error(\`collector_runs(assign-complex-keys) 조회 실패: \${runError.message}\`);
  return { gapRows: data ?? [], latestSuccess: runs?.[0] ?? null };
}
`;
rep(MON, [
  // (1) 새 점검 함수 — fetchRecentFailureRuns 바로 뒤
  [
    '  if (error) throw new Error(`collector_runs 실패 행 조회 실패: ${error.message}`);\n  return data ?? [];\n}\n',
    '  if (error) throw new Error(`collector_runs 실패 행 조회 실패: ${error.message}`);\n  return data ?? [];\n}\n' + NEW_BLOCK,
  ],
  // (2) 묶음 함수 머리말·주입 자료형
  [
    " * daily 스윕의 fail-open 점검 여섯(⑦ → ⑨ → ⑧ → ⑪ → ⑫ → ⑬, 옛 main 순서 그대로 + ⑬ 세션570)을 돌려 이슈를 합친다.",
    " * daily 스윕의 fail-open 점검 일곱(⑦ → ⑨ → ⑧ → ⑪ → ⑫ → ⑬ → ⑭, 옛 main 순서 그대로 + ⑬ 세션570 + ⑭ 세션588)을 돌려 이슈를 합친다.",
  ],
  [
    " *   fetchFailureRuns?: () => ReturnType<typeof fetchRecentFailureRuns>,\n",
    " *   fetchFailureRuns?: () => ReturnType<typeof fetchRecentFailureRuns>,\n *   fetchKeyHealth?: () => ReturnType<typeof fetchComplexKeyHealth>,\n",
  ],
  [
    "  const fetchFailureRuns = deps.fetchFailureRuns ?? (() => fetchRecentFailureRuns());\n",
    "  const fetchFailureRuns = deps.fetchFailureRuns ?? (() => fetchRecentFailureRuns());\n  const fetchKeyHealth = deps.fetchKeyHealth ?? fetchComplexKeyHealth;\n",
  ],
  // (3) ⑬ 블록 뒤에 ⑭ 블록
  [
    "    return failIssues;\n  }));\n\n  return issues;\n}",
    "    return failIssues;\n  }));\n\n" +
      "  // ⑭ 묶음 열쇠 칸 — 채우기 배치(assign-complex-keys)가 하루 넘게 안 돈 신호(세션588): 오래된 빈 행 + 마지막 성공 시각.\n" +
      '  issues = issues.concat(await runFailOpenCheck("⑭ 묶음 열쇠 칸 점검", async () => {\n' +
      "    const { gapRows, latestSuccess } = await fetchKeyHealth();\n" +
      "    const gapIssues = checkComplexKeyGaps(gapRows).concat(checkComplexKeyRunStale(latestSuccess));\n" +
      "    console.log(`[monitor] ⑭ 묶음 열쇠 칸 점검: 빈 행 ${gapRows.length}건 · 마지막 성공 ${latestSuccess?.finished_at ?? \"없음\"} → 이상 ${gapIssues.length}건`);\n" +
      "    return gapIssues;\n" +
      "  }));\n\n  return issues;\n}",
  ],
]);
rep(W + "/scripts/notify-telegram.mjs", [["그 번호(⑦~⑬) 줄의 오류", "그 번호(⑦~⑭) 줄의 오류"]]);
rep(W + "/scripts/monitor-check-failed.test.mjs", [
  ['  fetchFailureRuns: "⑬ 로컬 수집기 실패 점검",\n};', '  fetchFailureRuns: "⑬ 로컬 수집기 실패 점검",\n  fetchKeyHealth: "⑭ 묶음 열쇠 칸 점검",\n};'],
  [
    "    // 운영 monitor_alert_state 를 절대 지우지 않게 — 시험은 항상 가짜(세션572)\n",
    "    // 빈 행 0건 + 방금 성공한 기록 — ⑭ 는 이상 없이 지나간다(세션588)\n    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),\n    // 운영 monitor_alert_state 를 절대 지우지 않게 — 시험은 항상 가짜(세션572)\n",
  ],
  ['  it("여섯 다 실패하면 6건, 옛 main 순서(⑦ ⑨ ⑧ ⑪ ⑫) + ⑬(세션570) 그대로", async () => {', '  it("일곱 다 실패하면 7건, 옛 main 순서(⑦ ⑨ ⑧ ⑪ ⑫) + ⑬(세션570) + ⑭(세션588) 그대로", async () => {'],
  ["fetchAhRows: boom, fetchFailureRuns: boom,\n", "fetchAhRows: boom, fetchFailureRuns: boom, fetchKeyHealth: boom,\n"],
  ['      "⑬ 로컬 수집기 실패 점검",\n    ]);', '      "⑬ 로컬 수집기 실패 점검", "⑭ 묶음 열쇠 칸 점검",\n    ]);'],
]);
for (const [path, s] of pending) writeFileSync(path, s);
console.log(`적용 완료 — ${pending.length}개 파일`);
