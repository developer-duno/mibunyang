// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, buildRunResult, readStamp, runCommand, PIPELINE_COLLECTOR } from "./record-pipeline-run.mjs";

// 네이버 로컬 파이프라인 완주 기록(세션570). bat 이 부르는 CLI 의 인자 해석·시작 기록·
// collector_runs 페이로드를 가짜 클라이언트로 본다(운영 DB 쓰기 0).

/** collector_runs insert 를 받아 두는 가짜 Supabase 클라이언트. */
function fakeSb() {
  /** @type {any[]} */
  const inserted = [];
  return {
    inserted,
    /** @param {string} table */
    from(table) {
      return {
        /** @param {any} row */
        async insert(row) {
          inserted.push({ table, row });
          return { error: null };
        },
      };
    },
  };
}

let dir = "";
let stamp = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pipeline-stamp-"));
  stamp = join(dir, ".naver-pipeline-start.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseArgs — bat 이 넘기는 세 가지 모양", () => {
  it("start", () => {
    const a = parseArgs(["start"]);
    expect(a.cmd).toBe("start");
    expect(a.dryRun).toBe(false);
  });

  it("done — 경고 이름 앞의 빈 쉼표(bat 누적 방식)는 버린다", () => {
    const a = parseArgs(["done", "--collector=naver-pipeline", "--ok=4", "--skip=2", "--warn=,naver-presale,molit-units"]);
    expect(a).toMatchObject({ cmd: "done", collector: "naver-pipeline", ok: 4, skip: 2, warn: ["naver-presale", "molit-units"] });
  });

  it("done — 경고가 없으면 --warn= 이 비어 온다", () => {
    const a = parseArgs(["done", "--collector=naver-pipeline", "--ok=6", "--skip=0", "--warn="]);
    expect(a).toMatchObject({ ok: 6, skip: 0, warn: [] });
  });

  it("failed", () => {
    const a = parseArgs(["failed", "--step=2", "--name=sync-naver", "--dry-run"]);
    expect(a).toMatchObject({ cmd: "failed", step: 2, name: "sync-naver", dryRun: true, collector: PIPELINE_COLLECTOR });
  });

  it("모르는 하위명령·숫자 아닌 값은 안전한 기본값", () => {
    const a = parseArgs(["oops", "--ok=abc", "--step=0"]);
    expect(a.cmd).toBeNull();
    expect(a.ok).toBe(0);
    expect(a.step).toBeNull();
  });
});

describe("buildRunResult — collector_runs 에 들어갈 값", () => {
  const now = new Date("2026-09-28T01:30:00Z");
  const started = "2026-09-27T23:00:00.000Z";

  it("done + 경고 2개 → success · WARN_STEPS 마커 · 경과 초", () => {
    const { collector, result } = buildRunResult(parseArgs(["done", "--ok=4", "--skip=2", "--warn=,naver-presale,molit-units"]), started, now);
    expect(collector).toBe("naver-pipeline");
    expect(result).toEqual({
      status: "success", ok: 4, fail: 0, skip: 2, elapsed: 9000, startedAt: started,
      errorMessage: "WARN_STEPS: naver-presale,molit-units",
    });
  });

  it("done + 경고 0 → error_message null", () => {
    const { result } = buildRunResult(parseArgs(["done", "--ok=6", "--skip=0", "--warn="]), started, now);
    expect(result.errorMessage).toBeNull();
    expect(result.status).toBe("success");
  });

  it("failed 2단계 → failure · ok 1 · fail 1 · STEP_FAILED 마커", () => {
    const { result } = buildRunResult(parseArgs(["failed", "--step=2", "--name=sync-naver"]), started, now);
    expect(result).toMatchObject({ status: "failure", ok: 1, fail: 1, errorMessage: "STEP_FAILED: 2/6 sync-naver" });
  });

  it("시작 기록이 없으면 경과·시작 시각만 비운다(기록은 한다)", () => {
    const { result } = buildRunResult(parseArgs(["done", "--ok=6"]), null, now);
    expect(result.elapsed).toBeNull();
    expect(result.startedAt).toBeNull();
    expect(result.ok).toBe(6);
  });
});

describe("runCommand — 시작 기록 파일과 가짜 클라이언트", () => {
  it("start 가 쓴 시각을 done 이 읽어 경과를 계산하고, 기록 뒤 파일을 지운다", async () => {
    await runCommand(parseArgs(["start"]), { stampPath: stamp, now: new Date("2026-09-28T23:00:00Z") });
    expect(readStamp(stamp)).toBe("2026-09-28T23:00:00.000Z");
    const sb = fakeSb();
    const out = await runCommand(parseArgs(["done", "--collector=naver-pipeline", "--ok=5", "--skip=1", "--warn=,molit-units"]), {
      stampPath: stamp, now: new Date("2026-09-29T01:00:00Z"), sb,
    });
    expect(out.action).toBe("done");
    expect(sb.inserted).toHaveLength(1);
    expect(sb.inserted[0].table).toBe("collector_runs");
    expect(sb.inserted[0].row).toMatchObject({
      collector: "naver-pipeline", status: "success", ok_count: 5, fail_count: 0, skip_count: 1,
      elapsed_sec: 7200, started_at: "2026-09-28T23:00:00.000Z", error_message: "WARN_STEPS: molit-units",
    });
    expect(existsSync(stamp)).toBe(false);
  });

  it("시작 기록이 없어도 failed 는 기록된다", async () => {
    const sb = fakeSb();
    await runCommand(parseArgs(["failed", "--step=5", "--name=calc-exclusive-ratio"]), { stampPath: stamp, sb });
    expect(sb.inserted[0].row).toMatchObject({
      status: "failure", ok_count: 4, fail_count: 1, elapsed_sec: null, error_message: "STEP_FAILED: 5/6 calc-exclusive-ratio",
    });
  });

  it("깨진 시작 기록은 무시한다", () => {
    writeFileSync(stamp, "not json", "utf8");
    expect(readStamp(stamp)).toBeNull();
  });

  it("--dry-run 이면 collector_runs 에 쓰지 않고 시작 기록도 남겨 둔다", async () => {
    await runCommand(parseArgs(["start"]), { stampPath: stamp });
    const sb = fakeSb();
    const out = await runCommand(parseArgs(["done", "--ok=6", "--dry-run"]), { stampPath: stamp, sb });
    expect(out.action).toBe("dry-run");
    expect(sb.inserted).toHaveLength(0);
    expect(existsSync(stamp)).toBe(true);
    expect(JSON.parse(readFileSync(stamp, "utf8")).startedAt).toBeTruthy();
  });

  it("다른 기록명(--collector=)은 받지 않는다 — 감시가 못 찾는 행을 만들지 않게", async () => {
    const sb = fakeSb();
    const out = await runCommand(parseArgs(["done", "--collector=naver-collect", "--ok=6"]), { stampPath: stamp, sb });
    expect(out.action).toBe("bad-collector");
    expect(sb.inserted).toHaveLength(0);
  });

  it("모르는 하위명령은 사용법만 찍고 아무것도 쓰지 않는다", async () => {
    const sb = fakeSb();
    const out = await runCommand(parseArgs(["oops"]), { stampPath: stamp, sb });
    expect(out.action).toBe("usage");
    expect(sb.inserted).toHaveLength(0);
    expect(existsSync(stamp)).toBe(false);
  });
});
