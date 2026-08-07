// @ts-check
/**
 * audit-cron-concurrency.mjs 회귀 가드
 *
 * 사고 박제 (세션 500): `collect-maintenance.yml`(UTC 03:00, 창 120분)이 15~19일 중 월요일에
 * 주간 청약홈 체인 2개를 실행창 안에 받아 data-collection 그룹의 대기 자리(1개)를 밀어냈다.
 * 취소된 회차는 steps 가 비어 collector_runs 행조차 없으므로 monitor 가 못 잡는다.
 *
 * 아래 두 테스트 묶음은 **감사 스크립트를 만들다 실제로 낸 버그**를 박아둔 것이다:
 *   ① cron 요일은 p[4] 다 (p[3] 은 월). p[3] 을 요일로 읽으면 이 저장소는 월이 대부분 `*` 라
 *      모든 요일이 `*` 로 뭉개져 "아무 날이나 겹친다"가 되고 오탐이 35쌍으로 폭발한다.
 *   ② 도착 2개가 **서로도** 같은 날 발화 가능해야 실제 손실이다. 일요일 잡과 월요일 잡은
 *      한 날에 1개씩만 오므로 무해한데, 이걸 안 보면 오탐이 난다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  parseCron,
  expandField,
  canShareDay,
  minutesOfDay,
  collectGroups,
  findSilentCancelRisks,
  ALLOWLIST,
} from "./audit-cron-concurrency.mjs";

const TMP = path.join(process.cwd(), ".tmp-cron-concurrency-test");

/** @param {{name:string, cron:string, group?:string, timeout?:number|null}} o */
function wf({ name, cron, group = "data-collection", timeout = 60 }) {
  return `name: ${name}
on:
  schedule:
    - cron: '${cron}'
concurrency:
  group: ${group}
  cancel-in-progress: false
jobs:
  collect:
    runs-on: ubuntu-latest
${timeout === null ? "" : `    timeout-minutes: ${timeout}\n`}    steps:
      - run: echo hi
`;
}

/** @param {string} dir @param {Record<string,string>} files */
async function writeFixture(dir, files) {
  await mkdir(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) await writeFile(path.join(dir, f), body, "utf8");
}

describe("parseCron — 필드 자리 (분 시 일 월 요일)", () => {
  it("요일은 5번째 칸(p[4])이고 4번째는 월이다", () => {
    const c = parseCron("0 2 * * 0");
    expect(c?.min).toBe("0");
    expect(c?.hour).toBe("2");
    expect(c?.dom).toBe("*");
    expect(c?.month).toBe("*"); // ← p[3]
    expect(c?.dow).toBe("0"); // ← p[4] · 여기가 "*" 로 나오면 파서가 한 칸 밀렸다
  });

  it("월 제한 cron 을 월 칸에서 읽는다", () => {
    const c = parseCron("0 21 10 1,4,7,10 *");
    expect(c?.dom).toBe("10");
    expect(c?.month).toBe("1,4,7,10");
    expect(c?.dow).toBe("*");
  });

  it("5필드가 아니면 null", () => {
    expect(parseCron("0 2 * *")).toBeNull();
    expect(parseCron("0 2 * * 0 6")).toBeNull();
  });
});

describe("expandField", () => {
  it("* 는 제한 없음(null)", () => {
    expect(expandField("*", 0, 6)).toBeNull();
  });
  it("범위·목록·간격을 펼친다", () => {
    expect([...(expandField("15-19", 1, 31) ?? [])]).toEqual([15, 16, 17, 18, 19]);
    expect([...(expandField("1,4,7,10", 1, 12) ?? [])]).toEqual([1, 4, 7, 10]);
    expect([...(expandField("*/15", 0, 59) ?? [])]).toEqual([0, 15, 30, 45]);
  });
  it("단일값도 집합으로", () => {
    expect([...(expandField("0", 0, 6) ?? [])]).toEqual([0]);
  });
});

describe("canShareDay", () => {
  const C = /** @param {string} s */ s => /** @type {any} */ (parseCron(s));

  it("일요일 잡과 월요일 잡은 같은 날에 못 뜬다", () => {
    // 오탐 사고 박제: 이게 true 로 나오면 backfill(일) ↔ applyhome(월) 이 겹친다고 오판한다
    expect(canShareDay(C("0 2 * * 0"), C("30 2 * * 1"))).toBe(false);
  });

  it("날짜 제한(15-19일)과 요일 제한(월)은 겹칠 수 있다", () => {
    // 2026-08-17 이 실제로 그 날 — 이번 사고의 핵심 조건
    expect(canShareDay(C("0 3 15-19 * *"), C("30 3 * * 1"))).toBe(true);
  });

  it("같은 날짜 제한끼리는 교집합으로 판단", () => {
    expect(canShareDay(C("0 18 6 * *"), C("0 20 6 * *"))).toBe(true);
    expect(canShareDay(C("0 18 6 * *"), C("0 20 7 * *"))).toBe(false);
  });

  it("월이 안 겹치면 같은 날짜라도 false", () => {
    expect(canShareDay(C("0 21 10 1,4,7,10 *"), C("0 16 10 2,5,8,11 *"))).toBe(false);
  });

  it("둘 다 제한 없으면 매일 겹친다", () => {
    expect(canShareDay(C("0 19 * * *"), C("0 20 * * *"))).toBe(true);
  });
});

describe("minutesOfDay", () => {
  it("시·분을 분 단위로 변환", () => {
    expect(minutesOfDay(/** @type {any} */ (parseCron("30 4 * * 1")))).toEqual([4 * 60 + 30]);
  });
  it("여러 시각을 모두 펼치고 정렬", () => {
    expect(minutesOfDay(/** @type {any} */ (parseCron("0 16,15 * * *")))).toEqual([900, 960]);
  });
});

describe("collectGroups", () => {
  const DIR = path.join(TMP, "groups");
  beforeAll(async () => {
    await writeFixture(DIR, {
      "a.yml": wf({ name: "A", cron: "0 3 * * *" }),
      "b.yml": wf({ name: "B", cron: "0 4 * * *", timeout: null }),
      "perrun.yml": wf({ name: "PerRun", cron: "0 5 * * *", group: "${{ github.workflow }}-${{ github.ref }}" }),
      "nocron.yml": `name: NoCron
on:
  workflow_dispatch:
concurrency:
  group: data-collection
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
    });
  });
  afterAll(async () => { await rm(TMP, { recursive: true, force: true }); });

  it("cron 있는 멤버만 모으고 회차별 동적 그룹은 제외한다", () => {
    const g = collectGroups(DIR);
    expect(Object.keys(g)).toEqual(["data-collection"]);
    expect(g["data-collection"].map(m => m.file).sort()).toEqual(["a.yml", "b.yml"]);
  });

  it("timeout-minutes 미지정은 GitHub 기본 360분으로 본다", () => {
    const g = collectGroups(DIR);
    const b = g["data-collection"].find(m => m.file === "b.yml");
    expect(b?.windowMin).toBe(360);
    expect(b?.hasTimeout).toBe(false);
  });
});

describe("findSilentCancelRisks", () => {
  const DIR = path.join(TMP, "risks");
  afterAll(async () => { await rm(TMP, { recursive: true, force: true }); });

  it("실행창 안 도착이 2개면 검출한다 (이번 사고 재현)", async () => {
    const dir = path.join(DIR, "hit");
    await writeFixture(dir, {
      "holder.yml": wf({ name: "Holder", cron: "0 3 15-19 * *", timeout: 120 }),
      "arr1.yml": wf({ name: "Arr1", cron: "30 3 * * 1", timeout: 30 }),
      "arr2.yml": wf({ name: "Arr2", cron: "30 4 * * 1", timeout: 15 }),
    });
    const risks = findSilentCancelRisks(collectGroups(dir));
    expect(risks).toHaveLength(1);
    expect(risks[0].holder).toBe("holder.yml");
    expect(risks[0].arrivals.map(a => a.file).sort()).toEqual(["arr1.yml", "arr2.yml"]);
  });

  it("도착이 1개면 그냥 대기 후 실행되므로 무해 — 검출 0", async () => {
    const dir = path.join(DIR, "single");
    await writeFixture(dir, {
      "holder.yml": wf({ name: "Holder", cron: "0 3 15-19 * *", timeout: 120 }),
      "arr1.yml": wf({ name: "Arr1", cron: "30 3 * * 1", timeout: 30 }),
    });
    expect(findSilentCancelRisks(collectGroups(dir))).toHaveLength(0);
  });

  it("도착 2개가 서로 다른 요일이면 한 날에 1개씩만 오므로 무해 — 검출 0 (오탐 차단)", async () => {
    const dir = path.join(DIR, "disjoint");
    await writeFixture(dir, {
      "holder.yml": wf({ name: "Holder", cron: "0 3 * * *", timeout: 120 }),
      "sun.yml": wf({ name: "Sun", cron: "30 3 * * 0", timeout: 30 }),
      "mon.yml": wf({ name: "Mon", cron: "30 4 * * 1", timeout: 30 }),
    });
    expect(findSilentCancelRisks(collectGroups(dir))).toHaveLength(0);
  });

  it("실행창 밖 도착은 세지 않는다", async () => {
    const dir = path.join(DIR, "outside");
    await writeFixture(dir, {
      "holder.yml": wf({ name: "Holder", cron: "0 3 * * *", timeout: 30 }),
      "arr1.yml": wf({ name: "Arr1", cron: "30 3 * * *", timeout: 30 }),
      "arr2.yml": wf({ name: "Arr2", cron: "30 5 * * *", timeout: 30 }), // 창(30분) 밖
    });
    expect(findSilentCancelRisks(collectGroups(dir))).toHaveLength(0);
  });

  it("다른 concurrency 그룹끼리는 경합하지 않는다", async () => {
    const dir = path.join(DIR, "othergroup");
    await writeFixture(dir, {
      "holder.yml": wf({ name: "Holder", cron: "0 3 * * *", timeout: 120 }),
      "arr1.yml": wf({ name: "Arr1", cron: "30 3 * * *", timeout: 30, group: "calc-collection" }),
      "arr2.yml": wf({ name: "Arr2", cron: "40 3 * * *", timeout: 30, group: "calc-collection" }),
    });
    expect(findSilentCancelRisks(collectGroups(dir))).toHaveLength(0);
  });
});

describe("실물 워크플로 — 조용한 취소 위험 0건 유지", () => {
  it("allowlist 를 뺀 위험이 없다", () => {
    const risks = findSilentCancelRisks(collectGroups(".github/workflows"));
    const violations = risks.filter(r => !ALLOWLIST.has(r.holder));
    const detail = violations
      .map(v => `${v.holder}(${v.raw}) ← ${v.arrivals.map(a => `${a.file}@+${a.offset}분`).join(", ")}`)
      .join(" / ");
    expect(violations, `조용한 취소 위험: ${detail}`).toHaveLength(0);
  });

  it("allowlist 항목은 사유가 비어 있지 않다", () => {
    for (const [file, reason] of ALLOWLIST) {
      expect(reason.trim().length, `${file} 사유 누락`).toBeGreaterThan(20);
    }
  });
});
