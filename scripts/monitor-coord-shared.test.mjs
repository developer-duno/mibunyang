// @ts-check
import { describe, it, expect } from "vitest";
import { checkCoordSharedDrift, isPastCompletion, COORD_SHARED_BASELINE } from "./monitor-collectors.mjs";

// 감시 ⑨ — 좌표 부정확 단지를 사장님께 알린다 (세션563).
// 손님 화면에 경고를 다는 대신 여기서 알린다(규칙: our-defect-is-not-customer-warning).

const NOW = new Date("2026-09-23T00:00:00Z");
/** @param {object} o */
const apt = (o) => ({ id: "ap-1", name: "테스트단지", completion: "202412", coord_shared: true, ...o });

describe("isPastCompletion — 실제 운영 형식으로 판정한다", () => {
  // ⚠️ 2026-09-23 운영 실측: YYYYMM 2,609건 · 빈값 447 · "미정" 9 · "2029 미…" 3 · YYYY-MM-DD **0건**.
  //    coord_shared 56곳은 **전부 YYYYMM** 이다. 그래서 YYYYMM 가지가 실전 경로다.
  it("YYYYMM — 지난 달은 true, 앞으로 올 달은 false", () => {
    // 기준 시각 = 2026-09-23. 2024년은 이미 지났다(처음에 2024를 미래로 착각해 red 를 받았다).
    expect(isPastCompletion("202407", NOW)).toBe(true);
    expect(isPastCompletion("202412", NOW)).toBe(true);
    expect(isPastCompletion("202908", NOW)).toBe(false);
    expect(isPastCompletion("203001", NOW)).toBe(false);
  });

  it("경계 — **이번 달은 아직 안 지난 것**으로 본다(월 단위 비교)", () => {
    // 준공월이 이번 달이면 그 달 안에 준공되므로 23일 시점에 "지났다"고 단정할 수 없다.
    // `src/scoring/scorePrice.ts` 의 isPresale 이 쓰는 경계(`idx >= currentMonthIndexKst`)와 같다.
    expect(isPastCompletion("202609", NOW)).toBe(false);
    expect(isPastCompletion("202608", NOW)).toBe(true);
    expect(isPastCompletion("202610", NOW)).toBe(false);
  });

  it("⚠️ 서기 20만년 함정 — Date 생성자에 문자열을 넘기지 않는다", () => {
    // "202211" + "-01" 을 new Date() 에 넘기면 **서기 202211년**이 된다(2026-09-23 실사고).
    // 그래서 준공 지난 48곳이 "전부 준공 전" 으로 보고됐다. 월 단위 정수 비교로 원천 차단.
    expect(isPastCompletion("202211", NOW)).toBe(true); // 2022년 11월 = 지났다
    expect(isPastCompletion("202808", NOW)).toBe(false); // 2028년 8월 = 아직
  });

  it("⚠️ 월 범위를 벗어나면 거부한다 — '202613' 이 2027-01 로 넘어가면 안 된다", () => {
    expect(isPastCompletion("202613", NOW)).toBe(false);
    expect(isPastCompletion("202600", NOW)).toBe(false);
  });

  it("⚠️ 판독 불가는 false — '지났다' 쪽으로 기울면 못 고칠 것을 매일 경보해 감시가 무뎌진다", () => {
    // ⚠️ 숫자 202407 은 여기 넣지 않는다 — String() 을 거쳐 정상 판독된다(직접 넣어 red 로 확인).
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

describe("checkCoordSharedDrift — 언제 알리고 언제 조용한가", () => {
  it("기준과 같거나 적고 전부 준공 전이면 조용하다 — 있다는 것 자체는 경보가 아니다", () => {
    const rows = Array.from({ length: COORD_SHARED_BASELINE }, (_, i) =>
      apt({ id: `ap-${i}`, completion: "202912" })
    );
    expect(checkCoordSharedDrift(rows, { now: NOW })).toEqual([]);
  });

  it("많이 줄면 **기준을 낮추라고** 알린다 — 잘할수록 눈머는 것을 막는다", () => {
    // 하드코딩 상한이라, 40곳으로 줄어든 뒤 통로가 다시 뚫려 55곳이 돼도 56 미만이라 침묵한다.
    // 그래서 줄어든 것 자체를 "기준 갱신하라" 로 알린다(세션563 적대검증 🟠).
    const rows = [apt({ completion: "202912" })];
    const issues = checkCoordSharedDrift(rows, { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].at).toBe("shrank:1");
    expect(issues[0].detail).toMatch(/COORD_SHARED_BASELINE/);
  });

  it("기준 근처(여유 안)면 조용하다 — 한두 곳 흔들림에 울지 않는다", () => {
    const rows = Array.from({ length: COORD_SHARED_BASELINE - 1 }, (_, i) =>
      apt({ id: `ap-${i}`, completion: "202912" })
    );
    expect(checkCoordSharedDrift(rows, { now: NOW })).toEqual([]);
  });

  it("(A) 늘어나면 알린다 — 새 단지가 자리표시 좌표를 받았다는 뜻", () => {
    const rows = Array.from({ length: COORD_SHARED_BASELINE + 3 }, (_, i) =>
      apt({ id: `ap-${i}`, completion: "202912" })
    );
    const issues = checkCoordSharedDrift(rows, { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/\+3/);
    expect(issues[0].collector).toBe("coord-shared");
  });

  it("(B) 준공일이 지났는데 안 풀렸으면 알린다 — 이제는 고칠 수 있다", () => {
    // 표본이 작아 "기준을 낮추라"(shrank) 도 함께 난다 — (B) 만 골라 본다.
    const rows = [apt({ name: "지난단지", completion: "202401" }), apt({ id: "ap-2", completion: "202912" })];
    const issues = checkCoordSharedDrift(rows, { now: NOW }).filter((i) => String(i.at).startsWith("past:"));
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
    // coord_shared 가 0곳이므로 "기준을 낮추라"(shrank:0) 만 나고, (A)(B) 는 안 난다.
    const issues = checkCoordSharedDrift(rows, { now: NOW });
    expect(issues.filter((i) => /^(grew|past):/.test(String(i.at)))).toEqual([]);
  });

  it("두 경보는 함께 날 수 있다 — 늘었고 그중 준공도 지났다", () => {
    const rows = Array.from({ length: COORD_SHARED_BASELINE + 1 }, (_, i) =>
      apt({ id: `ap-${i}`, completion: i === 0 ? "202401" : "202912" })
    );
    expect(checkCoordSharedDrift(rows, { now: NOW })).toHaveLength(2);
  });

  it("⚠️ 기준 건수는 실측값이다 — 임의로 낮추면 매일 거짓 경보가 난다", () => {
    // 2026-09-23 운영 실측 56곳. 이 값이 바뀌면 그 근거를 함께 남겨야 한다.
    expect(COORD_SHARED_BASELINE).toBe(56);
  });
});
