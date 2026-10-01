// 변이 시험 공용 틀: 대상 파일의 글자를 하나씩 바꿔 놓고 시험이 빨강이 되는지 본다.
// - 시작할 때 대상 옆에 백업 파일(<대상>.mutate-bak)을 만들고, 끝나면(도중에 던져도) 그 백업으로 되돌린 뒤 지운다.
// - 백업 파일이 이미 있으면 시작하지 않는다 = 앞선 실행이 도중에 죽어 변이가 남았을 수 있다는 뜻.
//   복구: 백업 파일을 대상 위에 복사(cp <대상>.mutate-bak <대상>)하고 백업을 지운 뒤 다시 실행.
//   (git checkout 으로 되돌리지 않는다 — 커밋 안 한 구현까지 지운다.)
// - "빨강(잡힘)"은 시험이 끝까지 돌아 실패 1건 이상으로 끝났을 때만이다. 시간 초과·문법 깨짐·찾는 글자 없음은 ❌ 로 따로 센다.
// - ⚠ 초록이나 ❌ 가 하나라도 있으면 종료 코드 1.
import { readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

/**
 * @param {{ worktree: string, target: string, tests: string[], mutations: Array<[string, string, string]>, timeoutMs?: number }} o
 *   target·tests 는 워크트리 기준 상대경로. mutations = [이름, 찾는 글자, 바꿀 글자] (줄바꿈은 \n 으로 적는다 — 파일에 맞춰 바꾼다)
 */
export function runMutations({ worktree, target, tests, mutations, timeoutMs = 180000 }) {
  if (!worktree) throw new Error("사용: node <이 도구> <워크트리 절대경로>");
  const path = `${worktree}/${target}`;
  const bak = `${path}.mutate-bak`;
  if (existsSync(bak)) {
    throw new Error(`백업 파일이 남아 있습니다: ${bak} — 앞선 실행이 도중에 죽은 것입니다. 그 파일을 ${path} 위에 복사해 되돌리고 백업을 지운 뒤 다시 실행하세요`);
  }
  const orig = readFileSync(path, "utf8");
  const EOL = orig.includes("\r\n") ? "\r\n" : "\n"; // 윈도우 작업 폴더는 CRLF — 찾는 글자의 줄바꿈을 파일에 맞춘다
  /** @type {string[]} */
  const rows = [];
  let bad = 0;
  copyFileSync(path, bak);
  try {
    for (const [label, find0, rep0] of mutations) {
      const find = find0.replace(/\n/g, EOL);
      const rep = rep0.replace(/\n/g, EOL);
      if (!orig.includes(find)) {
        rows.push(`${label}: ❌ 찾는 글자가 파일에 없음`);
        bad++;
        continue;
      }
      writeFileSync(path, orig.replace(find, () => rep));
      const chk = spawnSync("node", ["--check", path], { encoding: "utf8", timeout: 30000 });
      if (chk.status !== 0) {
        rows.push(`${label}: ❌ 변이가 문법을 깼음(시험 결과로 치지 않는다)`);
        bad++;
        continue;
      }
      // 색 코드를 끄고(NO_COLOR) 그래도 섞여 오면 벗긴다 — 사람이 PowerShell 에서 돌리거나 CI 에서는 vitest 가 색을 켜서
      // 요약 줄 사이에 제어 문자가 끼고, 아래 정규식이 못 읽어 전부 ❌ 로 나온다(세션588 검사관 A4 #5).
      const r = spawnSync("node", ["../../../node_modules/vitest/vitest.mjs", "run", ...tests], { cwd: worktree, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
      const out = stripVTControlCharacters((r.stdout ?? "") + (r.stderr ?? ""));
      // "Tests  N failed" 줄만 읽는다 — 시험 파일을 불러오지 못하면 "Test Files  1 failed" 만 나오고 Tests 줄엔 실패가 없다.
      // 그건 시험이 잡은 것이 아니라 시험이 못 돈 것이다(예: 변이가 export 를 없앤 경우 — node --check 는 문법만 본다).
      const failed = Number(/Tests\s+(\d+) failed/.exec(out)?.[1] ?? 0);
      if (r.status === 1 && failed >= 1) rows.push(`${label}: exit=1 · 실패 ${failed}건 → 빨강(잡힘)`);
      else if (r.status === 0) {
        rows.push(`${label}: exit=0 → ⚠ 초록(못 잡음)`);
        bad++;
      } else {
        rows.push(`${label}: ❌ 시험이 끝까지 돌지 못함(exit=${r.status} · signal=${r.signal ?? "없음"} · 실패한 시험 ${failed}건) — 시간 초과·충돌·시험 파일을 못 불러온 것은 잡힌 것으로 치지 않는다`);
        bad++;
      }
    }
  } finally {
    copyFileSync(bak, path);
    const same = readFileSync(path).equals(readFileSync(bak));
    if (same) unlinkSync(bak);
    console.log(rows.join("\n"));
    console.log("되돌림 바이트 동일:", same, same ? "" : `— 백업 ${bak} 을 남겨 뒀습니다`);
    if (!same) bad++;
  }
  console.log(bad === 0 ? `변이 ${mutations.length}종 전부 빨강` : `⚠ 문제 ${bad}건 — 위 줄을 확인`);
  if (bad > 0) process.exitCode = 1;
}
