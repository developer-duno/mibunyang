// @ts-check
/**
 * kosis-local-runner 테스트 — 일자 디스패치 순수 로직 + 매핑 무결성
 *
 * KOSIS 해외IP 차단(세션 288)으로 GH cron 10종을, MOLIT(1613000) 해외IP 차단(세션 515)으로
 * GH cron 5종을 집서버 로컬 러너로 이전했다.
 * 이 테스트는 (1) 일자→수집기 매핑이 의도대로 동작하고 (2) 매핑이 가리키는
 * 스크립트 파일이 실제로 존재하는지(이름 변경 시 silent 미실행 차단) 가드한다.
 *
 * ⚠️ 날짜는 `new Date(y, m-1, d)` 로컬 생성자로 만든다 — "2026-10-10" 문자열은 UTC 자정으로
 * 파싱돼 러너 타임존에 따라 날짜·요일이 밀릴 수 있고, 이 매핑은 KST 로컬 날짜 기준이다.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn() };
});
vi.mock("./notify-telegram.mjs", () => ({ sendTelegram: vi.fn() }));

import {
  DAY_TABLE,
  collectorsDueOn,
  datesToProcess,
  daysBetween,
  describeEntry,
  isCatchupStale,
  readLastProcessed,
  writeLastProcessed,
  ymd,
} from "./kosis-local-runner.mjs";

/** @param {number} y @param {number} m @param {number} d */
const at = (y, m, d) => new Date(y, m - 1, d);

describe("collectorsDueOn — 일자 디스패치", () => {
  it("매월 9일은 미분양(unsold) 수집기가 due 다", () => {
    expect(collectorsDueOn(at(2026, 7, 9))).toEqual(["collect-unsold-kosis.mjs"]);
  });

  it("매월 10일(토요일 아님)은 출산율 + 건축물상세가 due 다", () => {
    // 2026-07-10 = 금요일 → skipIfDow(토) 게이트 통과
    expect(collectorsDueOn(at(2026, 7, 10))).toEqual([
      "collect-fertility-rate.mjs",
      "molit-building-info.mjs",
    ]);
  });

  it("due 없는 날짜는 빈 배열", () => {
    expect(collectorsDueOn(at(2026, 7, 3))).toEqual([]);
  });

  it("분기 수집기(sale-price)는 1·4·7·10월 17일에만 due 다", () => {
    // 세션519: 17일에 공시가격(월간)이 합류했다 — 분기 게이트는 sale-price 에만 걸린다.
    expect(collectorsDueOn(at(2026, 7, 17))).toEqual([
      "collect-maintenance.mjs",
      "collect-sale-price-index.mjs",
      "collect-housing-price.mjs",
    ]);
    // 비분기 월(6월)의 17일은 관리비 + 공시가격
    expect(collectorsDueOn(at(2026, 6, 17))).toEqual([
      "collect-maintenance.mjs",
      "collect-housing-price.mjs",
    ]);
  });

  it("매핑표는 KOSIS 11종 + MOLIT 5종 + 네이버 개발계획 1종 + data.go.kr 2종 + CSV 1종 + 택지정보 1종을 전부 커버한다", () => {
    const scripts = [...new Set(DAY_TABLE.map((e) => e.script))].sort();
    expect(scripts).toEqual(
      [
        "collect-avg-income.mjs",
        "collect-fertility-rate.mjs",
        "collect-housing-supply-ratio.mjs",
        "collect-jeonse-price-index.mjs",
        "collect-market-stats.mjs",
        "collect-medical-access.mjs",
        "collect-regional-economy.mjs",
        "collect-sale-price-index.mjs",
        "collect-unsold-kosis.mjs",
        // 세션 501: MOLIT ArchPmsService_v2 폐기 → KOSIS DT_MLTM_666 이전.
        // kosis.kr 이 해외 IP 를 막아 GH yml 을 삭제했으므로 여기 없으면 아예 안 돈다.
        "housing-permits.mjs",
        "migration.mjs",
        // 세션 515: apis.data.go.kr 국토부(1613000) 가 GH 러너를 차단 → GH yml 5개 삭제.
        // 여기 없으면 이 5종은 아예 안 돈다.
        "collect-building-hub.mjs",
        "collect-maintenance.mjs",
        "collect-trades.mjs",
        "molit-building-info.mjs",
        "molit-units.mjs",
        // 세션 517: 네이버 개발계획 크론 편입 — 편입 전까지 어느 스케줄에도 없어 손으로만 돌았다.
        "naver-devplan.mjs",
        // 세션 519: 1613000 만의 문제가 아니었다 — www.data.go.kr(공시가격 CSV)·
        // apis.data.go.kr/B552584(에어코리아)도 해외 IP 를 막는다. GH yml 2개 삭제했으므로
        // 여기 없으면 아예 안 돈다.
        "collect-air-quality.mjs",
        "collect-housing-price.mjs",
        // 세션 521: 외부 API 를 안 쓰는 유일한 등재분(로컬 CSV 파싱). 옛 판단은 "CSV 가 연 1회
        // 갱신이라 자동화 대상이 없다" 였으나, 채우는 대상인 regions 에는 매월 새 행이 생긴다.
        "collect-crime-safety.mjs",
        // 세션 522: 택지정보시스템 지구단계정보(openapi.jigu.go.kr, 무인증) → dev_plans
        // lh_zone 의 progression_step. GH 워크플로가 없어 여기 없으면 아예 안 돈다.
        "lhzone-status.mjs",
      ].sort(),
    );
  });

  it("매핑표의 스크립트 파일이 전부 실재한다 (이름 변경 silent 미실행 차단)", () => {
    for (const e of DAY_TABLE) {
      const p = path.join(process.cwd(), "scripts", "collectors", e.script);
      expect(existsSync(p), `${e.script} 가 scripts/collectors/ 에 없음`).toBe(true);
    }
  });
});

describe("MOLIT 5종 이전 (세션 515)", () => {
  it("매월 6일은 시장통계 → 세대수보정 → 실거래 순서로 due 다 (실거래가 가장 오래 걸려 마지막)", () => {
    expect(collectorsDueOn(at(2026, 9, 6))).toEqual([
      "collect-market-stats.mjs",
      "molit-units.mjs",
      "collect-trades.mjs",
    ]);
  });

  it("10일이 토요일이면 건축물상세를 건너뛴다 (자매 레포 public_data 와 쿼터 충돌)", () => {
    // 2026-10-10 = 토요일
    expect(collectorsDueOn(at(2026, 10, 10))).not.toContain("molit-building-info.mjs");
    expect(collectorsDueOn(at(2026, 10, 10))).toContain("collect-fertility-rate.mjs");
  });

  it("11일은 전날(10일)이 토요일일 때만 건축물상세를 보충 실행한다", () => {
    // 2026-10-11 = 일요일, 전날 10-10 = 토요일 → 보충 실행
    expect(collectorsDueOn(at(2026, 10, 11))).toEqual([
      "housing-permits.mjs",
      "molit-building-info.mjs",
    ]);
    // 2026-09-11 = 금요일, 전날 09-10 = 목요일 → 10일에 이미 돌았으므로 보충 없음
    expect(collectorsDueOn(at(2026, 9, 11))).toEqual(["housing-permits.mjs"]);
  });

  it("15일은 관리비 + (분기월에만) 건축HUB 다", () => {
    // 2026-08-15 = 비분기 월
    expect(collectorsDueOn(at(2026, 8, 15))).toEqual(["collect-maintenance.mjs"]);
    // 2026-07-15 = 분기 월(1·4·7·10)
    expect(collectorsDueOn(at(2026, 7, 15))).toEqual([
      "collect-maintenance.mjs",
      "collect-building-hub.mjs",
    ]);
  });

  it("16~19일도 관리비가 due 다 (5일 연속 --limit=600 배치 = 옛 cron '0 6 15-19' 설계)", () => {
    for (const d of [16, 17, 18, 19]) {
      expect(collectorsDueOn(at(2026, 8, d)), `${d}일`).toContain("collect-maintenance.mjs");
    }
  });

  it("관리비 5회차 전부 --limit=600 을 넘긴다 (인자가 빠지면 전 대상이 한 회차에 몰려 일일 쿼터 초과)", () => {
    const rows = DAY_TABLE.filter((e) => e.script === "collect-maintenance.mjs");
    expect(rows.map((e) => e.day)).toEqual([15, 16, 17, 18, 19]);
    for (const r of rows) expect(r.args).toEqual(["--limit=600"]);
  });

  it("main 배선이 entry.args 를 spawn 인자에 싣는다 (표의 args 가드만으론 배선 삭제가 초록 — 뮤테이션 실증)", () => {
    const src = readFileSync(new URL("./kosis-local-runner.mjs", import.meta.url), "utf8");
    // 좌변(const args = [scriptPath,)까지 고정해 호출부만 매칭 — 선언·주석 오탐 차단
    expect(src).toMatch(/const args = \[scriptPath, \.\.\.\(entry\.args \?\? \[\]\),/);
  });

  it("--list 출력에 게이트가 사람이 읽는 형태로 붙는다", () => {
    /** @param {number} day @param {string} script */
    const byDay = (day, script) => {
      const e = DAY_TABLE.find((x) => x.day === day && x.script === script);
      expect(e, `${day}일 ${script} 항목이 매핑표에 없음`).toBeTruthy();
      return describeEntry(/** @type {(typeof DAY_TABLE)[number]} */ (e));
    };
    expect(byDay(10, "molit-building-info.mjs")).toBe(
      "매월 10일 (토요일 제외): molit-building-info.mjs",
    );
    expect(byDay(11, "molit-building-info.mjs")).toBe(
      "매월 11일 (전날이 토요일일 때만): molit-building-info.mjs",
    );
    expect(byDay(15, "collect-maintenance.mjs")).toBe(
      "매월 15일: collect-maintenance.mjs --limit=600",
    );
    expect(byDay(15, "collect-building-hub.mjs")).toBe(
      "매월 15일 (1·4·7·10월만): collect-building-hub.mjs",
    );
  });
});

describe("data.go.kr 2종 이전 (세션 519)", () => {
  // ⚠️ GH cron 을 이식할 때 가장 쉬운 실수 = UTC 숫자를 그대로 베끼는 것.
  // 옛 cron `0 22 16 * *`(UTC 16일 22시)은 KST 로 **17일** 07시다. 16일에 두면 하루 당겨진다.
  it("공시가격은 매월 17일에 due 다 (옛 cron 은 UTC 16일 = KST 17일)", () => {
    expect(collectorsDueOn(at(2026, 9, 17))).toContain("collect-housing-price.mjs");
    expect(collectorsDueOn(at(2026, 9, 16))).not.toContain("collect-housing-price.mjs");
  });

  // 옛 cron `0 15 * * 1`(UTC 월요일 15시)은 KST 로 **화요일** 00시다.
  it("대기질은 매주 화요일에 due 다 (옛 cron 은 UTC 월 = KST 화)", () => {
    // 2026-09-01 은 화요일, 08-31 은 월요일
    expect(collectorsDueOn(at(2026, 9, 1))).toContain("collect-air-quality.mjs");
    expect(collectorsDueOn(at(2026, 8, 31))).not.toContain("collect-air-quality.mjs");
  });

  it("주간(dow) 항목은 날짜와 무관하게 그 요일마다 due 다", () => {
    // 2026-09 의 화요일: 1·8·15·22·29
    for (const d of [1, 8, 15, 22, 29]) {
      expect(collectorsDueOn(at(2026, 9, d)), `9/${d}`).toContain("collect-air-quality.mjs");
    }
  });

  it("dow 항목은 day 필터에 걸리지 않는다 (배타 — day 없는 항목이 매일 돌면 안 된다)", () => {
    // 2026-09-02 는 수요일 → 대기질은 due 아님
    expect(collectorsDueOn(at(2026, 9, 2))).not.toContain("collect-air-quality.mjs");
  });

  it("--list 는 주간 항목을 '매주 N요일' 로 표기한다", () => {
    const air = DAY_TABLE.find((e) => e.script === "collect-air-quality.mjs");
    expect(air, "대기질 항목이 매핑표에 없음").toBeTruthy();
    expect(describeEntry(/** @type {any} */ (air))).toContain("매주 화요일");
  });

  // 로컬 러너로 옮긴 수집기는 GH run 이 없어 monitor ①③ 대상에서 빠진다 →
  // collector_runs 신선도(⑤)가 유일한 "안 돌면 알림" 이다. 등재를 잊으면 조용히 죽는다.
  it("옮긴 2종이 monitor ⑤ EXTERNAL_API_COLLECTORS 에 등재돼 있다", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts", "monitor-collectors.mjs"), "utf8");
    for (const name of ["housing-price", "air-quality"]) {
      // 문자열 포함 검사 — 정규식은 백슬래시가 한 겹 벗겨져 `\s` 가 `s` 로 죽는 사고가 났다.
      expect(src, `${name} 가 EXTERNAL_API_COLLECTORS 에 없음`).toContain(`collector: "${name}"`);
    }
  });

  // 워크플로를 지웠는데 표에만 남거나, 표에 넣었는데 워크플로가 살아 있으면 이중 실행이 된다.
  it("옮긴 2종의 GH 워크플로가 삭제돼 있다 (이중 실행 방지)", () => {
    for (const f of ["collect-air-quality.yml", "collect-housing-price.yml"]) {
      const p = path.join(process.cwd(), ".github", "workflows", f);
      expect(existsSync(p), `${f} 가 아직 있다 — 로컬 러너와 이중 실행된다`).toBe(false);
    }
  });
});

// ── 놓친 날 보충 (세션521) ────────────────────────────────────
//
// 스케줄러가 `StartWhenAvailable=true` 라 PC 가 꺼져 있던 날의 발화를 나중에 실행하는데, 러너가
// **실행된 날짜**로만 판단하면 놓친 날의 수집기를 영영 건너뛴다. 실측 사고 — 8/13 05:30 발화가
// 빠졌고 8/14 03:28 에 뒤늦게 돈 실행이 "8/14" 로 판단해 14일분만 돌려 `avg-income` 이 39일 밀렸다.
describe("datesToProcess — 놓친 날 보충", () => {
  const d = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ day) =>
    new Date(y, m - 1, day);

  it("상태가 없으면(첫 실행) 오늘 하나만", () => {
    expect(datesToProcess(null, d(2026, 8, 21))).toEqual(["2026-08-21"]);
    expect(datesToProcess(undefined, d(2026, 8, 21))).toEqual(["2026-08-21"]);
  });

  it("**이번 사고 재현** — 8/12 까지 처리한 상태로 8/14 에 돌면 8/13 을 메운다", () => {
    expect(datesToProcess("2026-08-12", d(2026, 8, 14))).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("어제까지 처리했으면 오늘만 (평상시엔 동작이 안 바뀐다)", () => {
    expect(datesToProcess("2026-08-20", d(2026, 8, 21))).toEqual(["2026-08-21"]);
  });

  it("같은 날 두 번 돌아도 오늘이 한 번만 (중복 실행 금지)", () => {
    expect(datesToProcess("2026-08-21", d(2026, 8, 21))).toEqual(["2026-08-21"]);
  });

  it("미래 날짜가 적혀 있어도 오늘만 (시계 되돌림·손편집 방어)", () => {
    expect(datesToProcess("2026-09-01", d(2026, 8, 21))).toEqual(["2026-08-21"]);
  });

  it("여러 날 밀려도 **한 번에 하나만** 메운다 — 쿼터 폭발 방지", () => {
    // 15~19일 maintenance 는 회차당 약 3,600 회. 5일치를 몰아 돌리면 일일 10,000 한도를 넘긴다.
    expect(datesToProcess("2026-08-15", d(2026, 8, 21))).toEqual(["2026-08-16", "2026-08-21"]);
  });

  it("가장 **오래된** 놓친 날부터 집는다 (공백을 먼저 줄인다)", () => {
    const [first] = datesToProcess("2026-08-10", d(2026, 8, 21));
    expect(first).toBe("2026-08-11");
  });

  it("월·연 경계를 넘어간다", () => {
    expect(datesToProcess("2026-07-31", d(2026, 8, 2))).toEqual(["2026-08-01", "2026-08-02"]);
    expect(datesToProcess("2025-12-31", d(2026, 1, 2))).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("형식이 깨진 상태값은 없는 셈 친다 (러너를 죽이지 않는다)", () => {
    for (const bad of ["", "망가짐", "2026-8-1", "2026/08/12", "not-a-date"]) {
      expect(datesToProcess(bad, d(2026, 8, 21))).toEqual(["2026-08-21"]);
    }
  });

  it("maxCatchup 을 늘리면 그만큼 더 메운다 (상한이 실제로 상한이다)", () => {
    expect(datesToProcess("2026-08-15", d(2026, 8, 21), 3)).toEqual([
      "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-21",
    ]);
  });
});

describe("ymd · daysBetween · isCatchupStale", () => {
  it("ymd 는 KST 로컬 날짜 (toISOString UTC 밀림 금지)", () => {
    // 05:30 KST 는 UTC 로 전날 20:30 이라, toISOString() 을 쓰면 하루가 밀린다.
    expect(ymd(new Date(2026, 7, 21, 5, 30))).toBe("2026-08-21");
    expect(ymd(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("daysBetween 은 두 날 사이 일수", () => {
    expect(daysBetween("2026-08-12", "2026-08-14")).toBe(2);
    expect(daysBetween("2026-07-13", "2026-08-21")).toBe(39); // 이번에 잡힌 avg-income 지연
    expect(daysBetween("깨짐", "2026-08-21")).toBe(0);
  });

  it("isCatchupStale 은 임계 초과에서만 참", () => {
    expect(isCatchupStale(10)).toBe(false);
    expect(isCatchupStale(11)).toBe(true);
    expect(isCatchupStale(39)).toBe(true);
  });
});

describe("상태 파일 읽기·쓰기", () => {
  it("쓴 값을 그대로 읽는다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runner-state-"));
    const f = path.join(dir, "state.json");
    try {
      expect(writeLastProcessed("2026-08-21", f)).toBe(true);
      expect(readLastProcessed(f)).toBe("2026-08-21");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("파일이 없거나 깨졌으면 null — 러너를 죽이지 않는다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runner-state-"));
    const f = path.join(dir, "state.json");
    try {
      expect(readLastProcessed(f)).toBeNull();
      writeFileSync(f, "{ 깨진 json", "utf8");
      expect(readLastProcessed(f)).toBeNull();
      writeFileSync(f, JSON.stringify({ lastProcessed: 42 }), "utf8");
      expect(readLastProcessed(f)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("쓸 수 없는 경로여도 throw 하지 않는다 (best-effort)", () => {
    expect(writeLastProcessed("2026-08-21", path.join(tmpdir(), "없는폴더", "x", "state.json"))).toBe(false);
  });
});
