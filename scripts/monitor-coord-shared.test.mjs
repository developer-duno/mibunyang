// @ts-check
import { describe, it, expect } from "vitest";
import {
  checkCoordSharedDrift,
  checkCoordCandidateDrift,
  isPastCompletion,
  fingerprintIds,
  COORD_SHARED_BASELINE_IDS,
  COORD_CANDIDATE_BASELINE_IDS,
} from "./monitor-collectors.mjs";

// 감시 ⑨ — 좌표 부정확 단지를 사장님께 알린다 (세션563, 세션568 명단화).
// 손님 화면에 경고를 다는 대신 여기서 알린다(규칙: our-defect-is-not-customer-warning).
// 세션568: 개수 대조 → id 명단 대조로 전환(세션565가 개수만 맞고 명단이 3↔3 뒤바뀐 것을 놓쳤다).

const NOW = new Date("2026-09-23T00:00:00Z");
/** @param {object} o */
const apt = (o) => ({ id: "ap-1", name: "테스트단지", completion: "202412", coord_shared: true, ...o });

describe("isPastCompletion — 실제 운영 형식으로 판정한다", () => {
  // ⚠️ 2026-09-23 운영 실측: YYYYMM 2,609건 · 빈값 447 · "미정" 9 · "2029 미…" 3 · YYYY-MM-DD **0건**.
  //    coord_shared 56곳은 **전부 YYYYMM** 이다. 그래서 YYYYMM 가지가 실전 경로다.
  it("YYYYMM — 지난 달은 true, 앞으로 올 달은 false", () => {
    expect(isPastCompletion("202407", NOW)).toBe(true);
    expect(isPastCompletion("202412", NOW)).toBe(true);
    expect(isPastCompletion("202908", NOW)).toBe(false);
    expect(isPastCompletion("203001", NOW)).toBe(false);
  });

  it("경계 — **이번 달은 아직 안 지난 것**으로 본다(월 단위 비교)", () => {
    expect(isPastCompletion("202609", NOW)).toBe(false);
    expect(isPastCompletion("202608", NOW)).toBe(true);
    expect(isPastCompletion("202610", NOW)).toBe(false);
  });

  it("⚠️ 서기 20만년 함정 — Date 생성자에 문자열을 넘기지 않는다", () => {
    expect(isPastCompletion("202211", NOW)).toBe(true);
    expect(isPastCompletion("202808", NOW)).toBe(false);
  });

  it("⚠️ 월 범위를 벗어나면 거부한다 — '202613' 이 2027-01 로 넘어가면 안 된다", () => {
    expect(isPastCompletion("202613", NOW)).toBe(false);
    expect(isPastCompletion("202600", NOW)).toBe(false);
  });

  it("⚠️ 판독 불가는 false — '지났다' 쪽으로 기울면 못 고칠 것을 매일 경보해 감시가 무뎌진다", () => {
    for (const v of ["미정", "2029 미정", "", null, undefined, "2024", "abc", "20240", "2024071"]) {
      expect(isPastCompletion(v, NOW), String(v)).toBe(false);
    }
  });

  it("숫자로 와도 판독한다 — String() 을 거친다", () => {
    expect(isPastCompletion(202407, NOW)).toBe(true);
    expect(isPastCompletion(202912, NOW)).toBe(false);
  });

  it("YYYY-MM-DD 도 받는다 — 운영엔 0건이지만 형식이 바뀔 수 있다", () => {
    expect(isPastCompletion("2024-07-01", NOW)).toBe(true);
    expect(isPastCompletion("2029-07-01", NOW)).toBe(false);
  });
});

describe("fingerprintIds — 상태 지문 (시각이 아니다)", () => {
  it("같은 id 집합(순서 무관하게 정렬해 넣으면)은 같은 지문", () => {
    expect(fingerprintIds(["a", "b", "c"])).toBe(fingerprintIds(["a", "b", "c"]));
  });

  it("정렬 순서가 다르면 다른 지문 — 정렬은 호출부 책임", () => {
    expect(fingerprintIds(["a", "b"])).not.toBe(fingerprintIds(["b", "a"]));
  });

  it("id 집합이 하나라도 다르면 지문도 다르다", () => {
    expect(fingerprintIds(["a", "b", "c"])).not.toBe(fingerprintIds(["a", "b", "d"]));
  });

  it("빈 배열도 안정적인 값을 낸다", () => {
    expect(fingerprintIds([])).toBe(fingerprintIds([]));
  });
});

describe("checkCoordSharedDrift — 명단(id 집합)으로 신규·풀림을 가른다", () => {
  const BASELINE = ["ap-1", "ap-2", "ap-3"];

  it("명단과 완전히 같으면(집합 일치) 조용하다 — 있다는 것 자체는 경보가 아니다", () => {
    const rows = BASELINE.map((id) => apt({ id, completion: "202912" }));
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    expect(issues.filter((i) => /^(new|resolved):/.test(String(i.at)))).toEqual([]);
  });

  it("★개수는 같은데 명단이 뒤바뀌면(3↔3) 신규·풀림 둘 다 잡는다 — 세션565가 놓친 자리", () => {
    // BASELINE = [ap-1, ap-2, ap-3]. 실제 표시는 [ap-1, ap-4, ap-5] — 개수는 똑같이 3.
    const rows = ["ap-1", "ap-4", "ap-5"].map((id) => apt({ id, completion: "202912" }));
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    const newcomer = issues.find((i) => String(i.at).startsWith("new:"));
    const resolved = issues.find((i) => String(i.at).startsWith("resolved:"));
    expect(newcomer, "명단 밖 2곳(ap-4, ap-5)이 신규로 잡혀야 한다").toBeTruthy();
    expect(newcomer?.detail).toMatch(/2곳/);
    expect(resolved, "명단 2곳(ap-2, ap-3)이 풀림으로 잡혀야 한다").toBeTruthy();
    expect(resolved?.detail).toMatch(/2곳/);
    expect(resolved?.detail).toMatch(/ap-2/);
    expect(resolved?.detail).toMatch(/ap-3/);
  });

  it("명단 그대로면(순서만 다르게 줘도) 조용하다", () => {
    const rows = ["ap-3", "ap-1", "ap-2"].map((id) => apt({ id, completion: "202912" }));
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    expect(issues.filter((i) => /^(new|resolved):/.test(String(i.at)))).toEqual([]);
  });

  it("(A-신규) 명단 밖 id 가 새로 표시되면 알린다", () => {
    const rows = [...BASELINE, "ap-9"].map((id) => apt({ id, completion: "202912" }));
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    const newcomer = issues.find((i) => String(i.at).startsWith("new:"));
    expect(newcomer).toBeTruthy();
    expect(newcomer?.detail).toMatch(/명단 밖/);
    expect(newcomer?.detail).toMatch(/ap-9/);
    expect(newcomer?.collector).toBe("coord-shared");
  });

  it("(A-풀림) 명단에 있던 id 가 표시에서 빠지면 '명단에서 빼라' 로 알린다", () => {
    const rows = [apt({ id: "ap-1", completion: "202912" })]; // ap-2, ap-3 는 빠짐
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    const resolved = issues.find((i) => String(i.at).startsWith("resolved:"));
    expect(resolved).toBeTruthy();
    expect(resolved?.detail).toMatch(/풀린/);
    expect(resolved?.detail).toMatch(/명단에서 빼라/);
  });

  it("(B) 준공일이 지났는데 안 풀렸으면 알린다 — 이제는 고칠 수 있다", () => {
    const rows = [apt({ id: "ap-1", name: "지난단지", completion: "202401" }), apt({ id: "ap-2", completion: "202912" })];
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: ["ap-1", "ap-2"] }).filter((i) =>
      String(i.at).startsWith("past:"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/준공일이 지난/);
    expect(issues[0].detail).toMatch(/지난단지/); // 어느 단지인지 알려준다
  });

  it("⚠️ coord_shared 가 아닌 행은 세지 않는다 — true 만 본다(엄격 비교)", () => {
    const rows = [
      apt({ id: "a", coord_shared: false, completion: "202401" }),
      apt({ id: "b", coord_shared: null, completion: "202401" }),
      apt({ id: "c", coord_shared: "true", completion: "202401" }),
    ];
    // 표시된 게 0곳이므로 baselineIds 전부가 "풀림" 으로만 잡히고 (A)(B) 는 안 난다.
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: ["ap-x"] });
    expect(issues.filter((i) => /^(new|past):/.test(String(i.at)))).toEqual([]);
    expect(issues.some((i) => String(i.at).startsWith("resolved:"))).toBe(true);
  });

  it("두 경보는 함께 날 수 있다 — 신규가 생겼고 그중 준공도 지났다", () => {
    const rows = [...BASELINE, "ap-9"].map((id) =>
      apt({ id, completion: id === "ap-9" ? "202401" : "202912" }),
    );
    const issues = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    expect(issues.some((i) => String(i.at).startsWith("new:"))).toBe(true);
    expect(issues.some((i) => String(i.at).startsWith("past:"))).toBe(true);
  });

  it("`at` 은 시각이 아니라 상태 지문 — 같은 표시 집합이면 매번 같은 값", () => {
    const rows = [...BASELINE, "ap-9"].map((id) => apt({ id, completion: "202912" }));
    const issues1 = checkCoordSharedDrift(rows, { now: NOW, baselineIds: BASELINE });
    const issues2 = checkCoordSharedDrift(rows, { now: new Date("2026-09-24T00:00:00Z"), baselineIds: BASELINE });
    const at1 = issues1.find((i) => String(i.at).startsWith("new:"))?.at;
    const at2 = issues2.find((i) => String(i.at).startsWith("new:"))?.at;
    expect(at1).toBe(at2);
  });

  it("⚠️ 기준 명단은 실측값이다 — 임의로 줄이면 매일 거짓 경보가 난다", () => {
    // 2026-09-24 세션568 라이브 재확인: 8곳, 전부 준공 전.
    expect(COORD_SHARED_BASELINE_IDS).toHaveLength(8);
    expect(COORD_SHARED_BASELINE_IDS).toEqual(
      [...COORD_SHARED_BASELINE_IDS].sort(),
    );
    for (const id of [
      "ah-2024910225", "ah-2025910011", "ah-2025910034", "ah-2025910268",
      "ah-2025910269", "ah-2025930013", "ap-6025734", "ap-6028554",
    ]) {
      expect(COORD_SHARED_BASELINE_IDS).toContain(id);
    }
  });
});

describe("checkCoordCandidateDrift — 같은 좌표 후보 중 '기준 명단 밖 신규'만 알린다", () => {
  /** @param {object} o */
  const coordApt = (o) => ({ id: "x", name: "단지", lat: 37.5, lng: 127.0, coord_shared: false, ...o });

  it("기준 안 후보만 있으면 조용하다", () => {
    const rows = [
      coordApt({ id: "a", name: "A아파트1차" }),
      coordApt({ id: "b", name: "B빌리지2차" }),
    ];
    const issues = checkCoordCandidateDrift(rows, { baselineIds: ["a", "b"] });
    expect(issues).toEqual([]);
  });

  it("기준 명단에 없던 새 후보가 생기면 알린다", () => {
    const rows = [
      coordApt({ id: "a", name: "A아파트1차" }),
      coordApt({ id: "b", name: "B빌리지2차" }),
    ];
    const issues = checkCoordCandidateDrift(rows, { baselineIds: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toBe("coord-candidate");
    expect(issues[0].detail).toMatch(/새로 공유/);
    expect(issues[0].detail).toMatch(/2곳/);
  });

  it("이미 coord_shared=true 로 표시된 것은 후보 알림에서 제외한다 — ⑨ 본 점검과 중복 회피", () => {
    const rows = [
      coordApt({ id: "a", name: "A아파트1차", coord_shared: true }),
      coordApt({ id: "b", name: "B빌리지2차", coord_shared: true }),
    ];
    const issues = checkCoordCandidateDrift(rows, { baselineIds: [] });
    expect(issues).toEqual([]);
  });

  it("같은 좌표라도 별개 단지가 아니면(이름이 하나로 모임) 후보에 안 잡힌다", () => {
    // groupSharedCoords 는 hasDistinctProjects 를 통과해야 후보다. 같은 이름 회차 분리는 하나로 모인다.
    const rows = [
      coordApt({ id: "a", name: "같은단지 무순위 1차" }),
      coordApt({ id: "b", name: "같은단지 무순위 2차" }),
    ];
    const issues = checkCoordCandidateDrift(rows, { baselineIds: [] });
    expect(issues).toEqual([]);
  });

  it("사라진 후보는 알리지 않는다(정보 로그만, issue 없음)", () => {
    // 기준 명단에 c 가 있지만 지금은 후보가 아니게 됨(a, b 만 있고 c 는 아예 데이터에 없음)
    const rows = [coordApt({ id: "a", name: "A아파트1차" }), coordApt({ id: "b", name: "B빌리지2차" })];
    const issues = checkCoordCandidateDrift(rows, { baselineIds: ["a", "b", "c"] });
    expect(issues).toEqual([]);
  });

  it("⚠️ 기준 후보 명단은 실측값이다", () => {
    // 2026-09-24 세션568 라이브 실측: groupSharedCoords 후보 217개 중 coord_shared 표시 8개를 뺀 209개.
    expect(COORD_CANDIDATE_BASELINE_IDS).toHaveLength(209);
    expect(COORD_CANDIDATE_BASELINE_IDS).toEqual([...COORD_CANDIDATE_BASELINE_IDS].sort());
  });
});
