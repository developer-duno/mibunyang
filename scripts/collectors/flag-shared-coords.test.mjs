// @ts-check
/**
 * `flag-shared-coords.mjs` 회귀 가드 (세션560, decideFlags 는 세션565 추가).
 *
 * ⚠️ 이 수집기의 핵심 설계는 **판정을 직접 하지 않는 것**이다. 세션560에 직접 구현하려다
 * 숫자가 29 → 36 → 95자리로 출렁였다(회차 분리를 결함으로 오판). 그래서 정정 도구의
 * `findTruePlaceholders`(조건: `tier === "none"`)를 그대로 쓴다.
 * 아래 첫 describe 가 **그 위임이 살아 있는지**를 지킨다 — 누가 다시 자체 규칙을 넣으면 red.
 *
 * `decideFlags` 는 세션565 3↔3 스왑 사고(사람 승인 행이 재분석에 다시 잡히고, 진짜 결함
 * 행은 이웃이 고쳐지며 표시가 꺼짐) 이후 추가됐다 — "표시는 실제로 옮겨지거나 확인되기
 * 전에는 안 꺼진다 / 사람이 승인한 행은 다시 켜지지 않는다"를 지킨다.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flaggedFromDump, decideFlags, loadHumanApprovals } from "./flag-shared-coords.mjs";
import { findTruePlaceholders } from "../fix-placeholder-addresses.mjs";

/**
 * 덤프 한 줄 만들기
 * @param {string} id
 * @param {string} name
 * @param {number | null} lat
 * @param {number | null} lng
 * @param {string} [tier]
 */
const row = (id, name, lat, lng, tier = "none") => ({ id, name, lat, lng, tier });

describe("flaggedFromDump — 판정은 정정 도구에 위임한다", () => {
  it("세 출처가 실패(none)한 행들만 자리표시로 잡는다", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        // 같은 좌표 · 서로 다른 단지 → 자리표시
        row("a1", "가나아파트", 37.5, 127.0),
        row("a2", "다라아파트", 37.5, 127.0),
        // 멀쩡한 좌표
        row("b1", "마바아파트", 37.6, 127.1),
      ],
    };
    const out = flaggedFromDump(dump);
    expect(out.has("a1")).toBe(true);
    expect(out.has("a2")).toBe(true);
    expect(out.has("b1")).toBe(false);
  });

  it("⚠️ 출처가 있는 행(tier !== none)은 같은 좌표라도 안 잡는다 — 이게 회차 분리를 살린다", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        row("c1", "가나아파트", 37.5, 127.0, "A2"),
        row("c2", "다라아파트", 37.5, 127.0, "A2"),
      ],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });

  it("같은 단지의 회차 분리는 잡지 않는다 (핵심이름이 하나)", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        row("d1", "가나아파트", 37.5, 127.0),
        row("d2", "가나아파트(무순위)", 37.5, 127.0),
        row("d3", "가나아파트 임의공급", 37.5, 127.0),
      ],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });

  it("좌표가 없는 행은 대상이 아니다", () => {
    const dump = {
      rosterSize: 10,
      rows: [row("e1", "가나아파트", null, null), row("e2", "다라아파트", null, null)],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });
});

describe("flaggedFromDump — fail-close", () => {
  it("로스터가 0건인 덤프는 거부한다 (외부 API 가 죽은 회차로 표시를 내리면 안 된다)", () => {
    expect(() => flaggedFromDump({ rosterSize: 0, rows: [] })).toThrow(/로스터/);
  });
  it("rows 가 없으면 거부한다", () => {
    expect(() => flaggedFromDump({ rosterSize: 10 })).toThrow(/rows/);
    expect(() => flaggedFromDump(null)).toThrow(/rows/);
  });
});

// ── decideFlags ──────────────────────────────────────────────────────────

/**
 * apartments 행 한 줄 만들기
 * @param {string} id
 * @param {boolean | null} coordShared
 * @param {number | null} lat
 * @param {number | null} lng
 */
const apt = (id, coordShared, lat, lng) => ({ id, coord_shared: coordShared, lat, lng });

describe("decideFlags — 오룡형: 진짜 결함, 이웃이 고쳐져 후보에서 빠져도 sticky", () => {
  it("두 행 모두 유지(sticky) — tier B_kakao_weak 이고 후보가 아니어도 꺼지지 않는다", () => {
    const dumpRows = [
      row("ah-o39", "남악 오룡지구 39BL 오룡 푸르지오 파르세나", 34.79, 126.39, "B_kakao_weak"),
      row("ah-o40", "남악 오룡지구 40BL 오룡 푸르지오 파르세나", 34.79, 126.39, "B_kakao_weak"),
    ];
    // 같은 coreName 이라 findTruePlaceholders 후보에도 안 들어간다(tier!=="none" 이라 더더욱).
    const candidates = findTruePlaceholders(dumpRows);
    expect(candidates.size).toBe(0);

    const dumpTiers = new Map(dumpRows.map((r) => [r.id, r.tier]));
    const rows = [apt("ah-o39", true, 34.79, 126.39), apt("ah-o40", true, 34.79, 126.39)];
    const decisions = decideFlags({ rows, candidates, dumpTiers, approvals: new Map() });
    expect(decisions.get("ah-o39")).toEqual({ next: true, reason: "sticky" });
    expect(decisions.get("ah-o40")).toEqual({ next: true, reason: "sticky" });
  });
});

describe("decideFlags — 동탄형: 혼자 남아도 sticky", () => {
  it("prev=true, tier none, 후보 아님(혼자) → sticky", () => {
    const dumpRows = [row("ah-dt", "동탄 A106블록 아파트", 37.2, 127.07, "none")];
    const candidates = findTruePlaceholders(dumpRows);
    expect(candidates.size).toBe(0);
    const dumpTiers = new Map(dumpRows.map((r) => [r.id, r.tier]));
    const rows = [apt("ah-dt", true, 37.2, 127.07)];
    const decisions = decideFlags({ rows, candidates, dumpTiers, approvals: new Map() });
    expect(decisions.get("ah-dt")).toEqual({ next: true, reason: "sticky" });
  });
});

describe("decideFlags — 아산탕정형: 사람 승인이 후보 판정을 이긴다", () => {
  it("세 행 모두 사람 승인으로 꺼진다 — candidates 에 들어갔음을 먼저 확인", () => {
    const lat = 36.79;
    const lng = 127.05;
    const dumpRows = [
      row("ah-as1", "아산탕정 D1-2BL 그랜드마크2", lat, lng, "none"),
      row("ah-as2", "아산탕정 D1-2BL 그랜드마크Ⅱ", lat, lng, "none"),
      row("ah-as3", "아산탕정 D1-2BL 그랜드마크2", lat, lng, "none"),
    ];
    const candidates = findTruePlaceholders(dumpRows);
    // 승인이 후보 판정을 이긴다는 것을 증명하려면 먼저 후보에 들어가 있어야 한다.
    expect(candidates.has("ah-as1")).toBe(true);
    expect(candidates.has("ah-as2")).toBe(true);
    expect(candidates.has("ah-as3")).toBe(true);

    const dumpTiers = new Map(dumpRows.map((r) => [r.id, r.tier]));
    const rows = [
      apt("ah-as1", true, lat, lng),
      apt("ah-as2", true, lat, lng),
      apt("ah-as3", true, lat, lng),
    ];
    const approvals = new Map([
      ["ah-as1", { lat, lng }],
      ["ah-as2", { lat, lng }],
      ["ah-as3", { lat, lng }],
    ]);
    const decisions = decideFlags({ rows, candidates, dumpTiers, approvals });
    expect(decisions.get("ah-as1")).toEqual({ next: false, reason: "human-approved" });
    expect(decisions.get("ah-as2")).toEqual({ next: false, reason: "human-approved" });
    expect(decisions.get("ah-as3")).toEqual({ next: false, reason: "human-approved" });
  });
});

describe("decideFlags — 승인 좌표가 현재 좌표와 멀면 무시된다", () => {
  it("승인이 ~500m 떨어져 있으면 human-approved 로 안 꺼진다 — prev true, 후보 아님 → sticky", () => {
    const lat = 36.79;
    const lng = 127.05;
    // 500m 가량 떨어진 좌표(위도 0.0045도 ≈ 500m)
    const farLat = lat + 0.0045;
    const dumpRows = [row("ah-far", "먼승인아파트", lat, lng, "none")];
    const candidates = findTruePlaceholders(dumpRows); // 혼자라 후보 아님
    expect(candidates.size).toBe(0);
    const dumpTiers = new Map(dumpRows.map((r) => [r.id, r.tier]));
    const rows = [apt("ah-far", true, lat, lng)];
    const approvals = new Map([["ah-far", { lat: farLat, lng }]]);
    const decisions = decideFlags({ rows, candidates, dumpTiers, approvals });
    expect(decisions.get("ah-far")).toEqual({ next: true, reason: "sticky" });
  });
});

describe("decideFlags — 나머지 규칙", () => {
  it("prev=true, tier ok → confirmed-ok 로 꺼진다", () => {
    const dumpTiers = new Map([["ah-ok", "ok"]]);
    const rows = [apt("ah-ok", true, 37.0, 127.0)];
    const decisions = decideFlags({ rows, candidates: new Set(), dumpTiers, approvals: new Map() });
    expect(decisions.get("ah-ok")).toEqual({ next: false, reason: "confirmed-ok" });
  });

  it("prev=false, candidate → placeholder 로 켜진다", () => {
    const rows = [apt("ah-new", false, 37.0, 127.0)];
    const decisions = decideFlags({
      rows,
      candidates: new Set(["ah-new"]),
      dumpTiers: new Map(),
      approvals: new Map(),
    });
    expect(decisions.get("ah-new")).toEqual({ next: true, reason: "placeholder" });
  });

  it("prev=false, candidate 아님 → clear (변화 없음)", () => {
    const rows = [apt("ah-clean", false, 37.0, 127.0)];
    const decisions = decideFlags({
      rows,
      candidates: new Set(),
      dumpTiers: new Map(),
      approvals: new Map(),
    });
    expect(decisions.get("ah-clean")).toEqual({ next: false, reason: "clear" });
  });

  it("prev=true 인데 id 가 dumpTiers 에 없음(부분 덤프) → sticky, 절대 꺼지지 않는다", () => {
    const rows = [apt("ah-absent", true, 37.0, 127.0)];
    const decisions = decideFlags({
      rows,
      candidates: new Set(),
      dumpTiers: new Map(), // 비어 있음 — 이 id 를 모른다
      approvals: new Map(),
    });
    expect(decisions.get("ah-absent")).toEqual({ next: true, reason: "sticky" });
  });
});

describe("decideFlags — 시흥형: 로마숫자 Ⅰ/Ⅱ 는 coreName 이 정규화하면 안 된다", () => {
  it("루체Ⅰ · 루체Ⅱ 는 서로 다른 핵심이름이라 진짜 자리표시로 잡힌다", () => {
    const lat = 37.34;
    const lng = 126.73;
    const dumpRows = [
      row("ah-si1", "시흥거모지구 대방 엘리움 더 루체Ⅰ(S-2BL)", lat, lng, "none"),
      row("ah-si2", "시흥거모지구 대방 엘리움 더 루체Ⅱ(B-2BL)", lat, lng, "none"),
    ];
    const candidates = findTruePlaceholders(dumpRows);
    expect(candidates.has("ah-si1")).toBe(true);
    expect(candidates.has("ah-si2")).toBe(true);

    const dumpTiers = new Map(dumpRows.map((r) => [r.id, r.tier]));
    const rows = [apt("ah-si1", false, lat, lng), apt("ah-si2", false, lat, lng)];
    const decisions = decideFlags({ rows, candidates, dumpTiers, approvals: new Map() });
    expect(decisions.get("ah-si1")).toEqual({ next: true, reason: "placeholder" });
    expect(decisions.get("ah-si2")).toEqual({ next: true, reason: "placeholder" });
  });
});

describe("loadHumanApprovals", () => {
  /** @returns {string} */
  function makeTmpDir() {
    return mkdtempSync(join(tmpdir(), "coord-approvals-test-"));
  }

  it("이름이 맞는 파일만 읽는다", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        join(dir, "2026-09-23-coord-approvals.json"),
        JSON.stringify([{ id: "x1", lat: 37.1, lng: 127.1 }])
      );
      writeFileSync(join(dir, "unrelated-notes.json"), JSON.stringify([{ id: "x2", lat: 1, lng: 1 }]));
      const m = loadHumanApprovals(dir);
      expect(m.size).toBe(1);
      expect(m.get("x1")).toEqual({ lat: 37.1, lng: 127.1 });
      expect(m.has("x2")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("같은 id 가 두 파일에서 30m 밖으로 어긋나면 throw 한다", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        join(dir, "2026-09-01-coord-approvals.json"),
        JSON.stringify([{ id: "dup", lat: 37.1, lng: 127.1 }])
      );
      writeFileSync(
        join(dir, "2026-09-23-coord-approvals.json"),
        JSON.stringify([{ id: "dup", lat: 37.2, lng: 127.2 }])
      );
      expect(() => loadHumanApprovals(dir)).toThrow(/충돌/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("디렉토리가 없으면 빈 Map 을 준다", () => {
    const m = loadHumanApprovals(join(tmpdir(), "no-such-dir-xyz-" + Date.now()));
    expect(m.size).toBe(0);
  });
});
