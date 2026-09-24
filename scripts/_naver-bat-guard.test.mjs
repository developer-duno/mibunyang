// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// run-naver-local.bat 정적 가드(세션570). Windows 예약 작업이 이 파일을 그대로 실행하므로
// ① CRLF 가 깨지면 스케줄러 발화가 실패하고(세션400·470 재발) ② 완주 기록 호출이 빠지면
// 감시 ⑤(naver-pipeline stale 4)·⑬(failure)이 다시 눈을 감는다. 문자열로 모양을 고정한다.
// ⚠️ 실제 cmd.exe 동작(지연 확장·인자 전달)은 이 시험으로 못 본다 — 세션570 에서 가짜 단계로
//    6경우를 cmd.exe 에 직접 돌려 확인했다(보고서). 이 가드는 그 모양이 무너지지 않게만 지킨다.

const BAT_PATH = fileURLToPath(new URL("./run-naver-local.bat", import.meta.url));
const raw = readFileSync(BAT_PATH);
const text = raw.toString("latin1");
const lines = text.split("\r\n");
const RECORD = "call node scripts\\record-pipeline-run.mjs";

describe("run-naver-local.bat — 줄바꿈·글자", () => {
  it("모든 줄바꿈이 CRLF(바이트로 판정 — LF 수 = CR+LF 수)", () => {
    let lf = 0;
    let crlf = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x0a) {
        lf++;
        if (i > 0 && raw[i - 1] === 0x0d) crlf++;
      }
    }
    expect(lf).toBeGreaterThan(50);
    expect(crlf).toBe(lf);
  });

  it("ASCII 만(한글 주석은 chcp 65001 과 겹쳐 cmd 가 줄을 잘못 읽는다)", () => {
    expect([...raw].every((b) => b < 0x80)).toBe(true);
  });
});

describe("run-naver-local.bat — 완주 기록 호출(naver-pipeline)", () => {
  const idx = (/** @type {(l: string) => boolean} */ pred) => lines.findIndex(pred);

  it("start 는 정확히 1회, 로그 start 줄 바로 다음 구간(1단계 전)에 있다", () => {
    const starts = lines.filter((l) => l.trim() === `${RECORD} start >> "%LOG%" 2>&1`);
    expect(starts).toHaveLength(1);
    const logStart = idx((l) => l.includes("naver collect start"));
    const recStart = idx((l) => l.trim().startsWith(`${RECORD} start`));
    const step1 = idx((l) => l.includes("=== 1/6"));
    expect(logStart).toBeGreaterThanOrEqual(0);
    expect(recStart).toBeGreaterThan(logStart);
    expect(recStart).toBeLessThan(step1);
  });

  it("done 은 정확히 1회, naver collect done 줄 앞이고 기록명·경고 인자를 넘긴다", () => {
    const dones = lines.filter((l) => l.trim().startsWith(`${RECORD} done`));
    expect(dones).toHaveLength(1);
    expect(dones[0]).toContain("--collector=naver-pipeline");
    expect(dones[0]).toContain("--ok=!OK_STEPS!");
    expect(dones[0]).toContain("--skip=!WARN!");
    expect(dones[0]).toContain('"--warn=!WARN_NAMES!"');
    const done = idx((l) => l.trim().startsWith(`${RECORD} done`));
    const logDone = idx((l) => l.includes("naver collect done"));
    expect(done).toBeGreaterThanOrEqual(0);
    expect(done).toBeLessThan(logDone);
    // done 직전에 OK_STEPS 계산
    expect(lines.slice(0, done).some((l) => l.trim() === "set /a OK_STEPS=6-WARN")).toBe(true);
  });

  it("failed 호출 수 = exit /b 1 수, 그리고 각 failed 는 바로 다음 줄이 exit /b 1", () => {
    const exits = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l === "exit /b 1");
    const faileds = lines.map((l, i) => [l.trim(), i]).filter(([l]) => String(l).startsWith(`${RECORD} failed`));
    expect(exits.length).toBe(3);
    expect(faileds.length).toBe(exits.length);
    for (const [, i] of faileds) expect(lines[Number(i) + 1].trim()).toBe("exit /b 1");
    expect(faileds.map(([l]) => String(l).match(/--step=(\d)/)?.[1])).toEqual(["1", "2", "5"]);
  });

  it("경고(non-fatal) 블록마다 WARN 누적 — 경고 줄 수 = 누적 수", () => {
    const warnEcho = lines.filter((l) => l.includes("WARNING:") && l.includes("non-fatal"));
    const incs = lines.filter((l) => l.trim() === "set /a WARN+=1");
    expect(warnEcho).toHaveLength(3);
    expect(incs).toHaveLength(warnEcho.length);
    expect(lines.some((l) => l.trim() === "set WARN=0")).toBe(true);
    // 지연 확장이 켜져 있어야 블록 안 !WARN_NAMES! 누적이 동작한다
    expect(lines.some((l) => l.trim() === "setlocal enabledelayedexpansion")).toBe(true);
  });
});
