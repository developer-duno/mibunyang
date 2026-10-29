// 정적 단지 장 본문(aptStaticBody.mjs) ↔ 화면 부품 같음 시험 (세션672 PR-S4 · 클로킹 막이).
//
// 막는 것:
//  - 정적 장이 화면에 없는 값·다른 글자를 싣는다(검색 정책 위반) — 화면 부품을 jsdom 으로 그린 글자로 줄을 만들어
//    aptStaticBody.mjs 가 만든 줄과 절·순서·글자까지 toEqual(픽스처 = 운영 자료에서 뽑은 진짜 단지 44곳).
//  - 사본 함수가 원본(.ts)과 갈라진다 — 같은 입력 → 같은 출력(경계값 + 픽스처 전 행).
//  - 점수·등급 낱말이 섞여 들어온다 · 빈칸 글자(미수집·위치 확인 중)가 실린다.
// 기대 글자의 출처 = 화면 부품이 그린 DOM(아래 refSections) — 손으로 적은 기대값이 아니다.
// 픽스처 = public/data/apartments.json(2026-10-27T18:08Z) 에서 scratchpad pick.mjs 로 뽑음 — 행마다 뽑은 까닭은 보고서.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import FIX from "./aptStaticBody.fixture.json";
import * as N from "./aptStaticBody.mjs";
import {
  scopeHeadText,
  compareRows,
  dongFactParts,
  complexJeonseText,
  effectiveScope,
  PricePositionBox,
} from "@/components/detail/PricePositionBox";
import { AreaTradeTable, areaTableRows, areaTableHead } from "@/components/detail/AreaTradeTable";
import { NaverListingLine } from "@/components/detail/NaverListingLine";
import { DistanceDots, fmtDist, parseKmText } from "@/components/charts/DistanceDots";
import { SchoolInfo } from "@/components/detail/SchoolInfo";
import { PresaleTimeline, isMoveInPast, fmtRate } from "@/components/charts/PresaleTimeline";
import { PresaleInfo } from "@/components/detail/PresaleInfo";
import { UnsoldEventCard } from "@/components/detail/UnsoldEventCard";
import { BuildingInfoCard } from "@/components/detail/BuildingInfoCard";
import { LocationEnvBlock } from "@/components/detail/LocationEnvBlock";
import { transportFacts, busStopsText } from "@/components/detail/TransportCard";
import {
  fmtPrice,
  fmtMoveIn,
  fmtAddress,
  fmtCompletion,
  fmtPriceGap,
  fmtPriceRange,
  fmtPriceEok1,
  fmtPriceRangeEok1,
  fmtPresaleSchedule,
  fmtRecruitDate,
} from "@/lib/format";
import { hasKnownArea } from "@/lib/area";
import { groupAreaRows } from "@/lib/areaGroups";
import { schoolsOf } from "@/lib/nearbySchools";
import { hasRange } from "@/constants/cardChips";
import { FIELD_META } from "@/constants/fieldMeta";
import { DISTANCE_AXES } from "@/constants/distanceAxes";
import { SENTINEL, SENTINEL_RADIUS_KM, isSentinel } from "@/constants/sentinels";
import {
  TRADE_SCOPE_PEER_YEARS,
  TRADE_SCOPE_PER_M2_TOL_M2,
  airAnnualBand,
  NOISE_TIERS,
} from "@/constants/scoringTiers";
import { parseCompletionMonth } from "@/scoring/scorePrice";

/** @type {Array<Record<string, any>>} */
const APTS = FIX.data;
/** 시험 PC 시간대(분) — 부품은 브라우저 시간대로 날짜를 그린다. 사본 기본값(KST)은 따로 시험한다. */
const LOCAL_TZ = -new Date().getTimezoneOffset();

beforeAll(() => {
  // 분양 탭 PresaleInfo 의 청약홈 공식 일정은 실행 중 조회 — 정적 장엔 없다(못 받은 상태 = 정적과 같은 조건)
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("no network")));
});
afterEach(() => cleanup());

/** @param {Element | null | undefined} el */
// 글자 그대로(공백을 접지 않는다 — 단지·정류장 이름 안의 두 칸 공백도 같은지 본다 · 앞뒤만 자름)
const txt = (el) => (el?.textContent ?? "").trim();
/** @param {import("react").ReactElement} el */
const draw = (el) => render(el).container;

// ── 화면 부품으로 줄 만들기(기준 조립기 — 세션672 proto.test.jsx.txt 꼴을 부품 DOM 기준으로 바로잡음) ──

/** 상세 창 머리글(DetailModal.tsx 421~451) + 종합 탭 FIELD_META 표기 + 분양 탭 경쟁률·추가 모집 카드 */
function refBasic(m) {
  const out = [];
  if (m.address) {
    const t = `${fmtAddress(String(m.address))}${m.district ? ` (${String(m.district)})` : ""}`;
    if (t.trim()) out.push(`주소: ${t}`);
  } else {
    const where = [m.region, m.gu, m.dong].filter(Boolean).join(" ");
    if (where) out.push(`위치: ${where}`);
  }
  if (m.roadAddress) out.push(`도로명: ${String(m.roadAddress)}`);
  if (fmtPrice(m.price) !== "-")
    out.push(`분양가: ${fmtPrice(m.price)}${hasKnownArea(m.area) ? ` (전용 ${m.area}㎡)` : ""}`);
  const u = FIELD_META.units.fmt(m.units, m);
  const s = FIELD_META.unsold.fmt(m.unsold, m);
  const uu = [u !== "정보 없음" ? `총 ${u}` : null, s !== "—" ? `미분양 ${s}` : null].filter(Boolean);
  if (uu.length) out.push(uu.join(" · "));
  const mi = fmtMoveIn(m.completion, m.presaleMoveIn);
  if (mi !== "-") out.push(`입주: ${mi}`);
  if (m.builder) {
    // 화면 시공사 칩 = `{원문} ({등급})` — 등급 괄호를 뗀 원문만
    expect(FIELD_META.builder.fmt(m.builder, m).startsWith(`${m.builder} (`)).toBe(true);
    out.push(`시공사: ${String(m.builder)}`);
  }
  if (m.noticeName && m.noticeName !== m.name) out.push(`공고명: ${String(m.noticeName)}`);
  const tl = draw(
    <PresaleTimeline
      competitionRate={m.competitionRate}
      competitionSupply={m.competitionSupply}
      competitionApplicants={m.competitionApplicants}
    />
  );
  const rate = [...tl.querySelectorAll("b")].map(txt).find((t) => / : 1$/.test(t));
  if (rate) {
    const detail = [...tl.querySelectorAll("div")].map(txt).find((t) => /^[\d,]+명 신청 \/ [\d,]+세대 모집$/.test(t));
    out.push(`청약 경쟁률: ${rate}${detail ? ` (${detail})` : ""}`);
  }
  cleanup();
  const ue = draw(<UnsoldEventCard apt={m} />);
  const cnt = txt(ue.querySelector('[data-field="unsoldEventCount"]'));
  if (cnt && !cnt.endsWith("—")) {
    const last = txt(ue.querySelector('[data-field="lastUnsoldEventAt"]'));
    out.push(`${cnt}${last && !last.endsWith("—") ? ` ${last}` : ""}`);
  }
  cleanup();
  return out;
}

function refTrade(m) {
  const out = [];
  const box = draw(<PricePositionBox priceCat={m.catsCache?.price ?? null} apt={m} />);
  const head = txt(box.querySelector('[data-testid="price-scope-head"]'));
  if (head && head !== "비교할 실거래가 아직 없어요") out.push(head);
  // 비교 표 줄은 범위와 무관하게 부품이 그리면 싣는다(세션673 — none 에서도 「전세가율」 줄을 그린다)
  for (const row of box.querySelectorAll('[data-testid="price-compare-table"] [data-row]')) {
    const [l, v] = [...row.children].map(txt);
    if (l === "분양가") continue;
    const sub = txt(box.querySelector(`[data-row-sub="${row.getAttribute("data-row")}"]`));
    out.push(`${l} ${v}${sub ? ` (${sub})` : ""}`);
  }
  // 동네 사실 줄은 범위와 무관하게 부품이 그리면 싣는다(세션673 — 비교 없는 장도 화면 상자가 이 줄을 그린다)
  const fact = txt(box.querySelector('[data-testid="dong-fact-line"]'));
  if (fact) out.push(fact);
  cleanup();
  const tb = draw(<AreaTradeTable apt={m} />);
  const table = tb.querySelector('[data-testid="area-trade-table"]');
  if (table) {
    const titleEl = /** @type {Element} */ (table.querySelector('[data-testid="area-trade-title"]'));
    const title = txt(titleEl.firstChild);
    const period = txt(titleEl.querySelector("span"));
    out.push({ text: `${title}${period ? ` (${period})` : ""}`, h3: true });
    const saleLabel = txt(table.children[1].children[1]);
    for (const row of table.querySelectorAll("[data-area-group]")) {
      const areaDiv = row.children[0];
      const name = [...areaDiv.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("");
      const cell = (part, label) => {
        const c = row.querySelector(`[data-part="${part}"]`);
        if (!c || txt(c) === "—") return null;
        return `${label} ${txt(c.firstChild)} ${txt(c.querySelector("span"))}`;
      };
      out.push([name, cell("sale", saleLabel), cell("jeonse", "전세")].filter(Boolean).join(" · "));
    }
  }
  cleanup();
  const nl = draw(<NaverListingLine apt={m} />);
  const line = txt(nl.querySelector('[data-testid="naver-listing-line"]'));
  if (line) out.push(line.replace(/^네이버 매물 현황 /, "네이버 매물 현황: "));
  cleanup();
  return out;
}

function refAround(m) {
  const out = [];
  const tf = transportFacts(m);
  if (tf) out.push(`교통: ${tf}`);
  const si = draw(<SchoolInfo apt={m} />);
  const bus = txt(si.querySelector('[data-chip="bus"]'));
  if (bus) out.push(bus);
  cleanup();
  const dd = draw(<DistanceDots apt={m} />);
  /** @type {Map<Element, string[]>} */
  const groups = new Map();
  for (const row of dd.querySelectorAll("[data-row]")) {
    const axis = /** @type {Element} */ (row.parentElement);
    const first = row.children[0];
    const label = txt(first.children[0]);
    const outEl = row.querySelector('[data-state="out-of-range"]');
    const value = outEl ? txt(outEl) : txt(first.children[first.children.length - 1]);
    const name = txt(row.querySelector("[data-name-row]"));
    if (!groups.has(axis)) groups.set(axis, []);
    if (value === "미수집") continue;
    groups.get(axis)?.push(`${label} ${value}${name ? ` ${name}` : ""}`);
  }
  for (const [axis, parts] of groups) {
    const [t, cap] = [...axis.children[0].children].map(txt);
    if (parts.length) out.push(`${t}(${cap}): ${parts.join(" · ")}`);
  }
  cleanup();
  const env = draw(<LocationEnvBlock apt={m} />);
  const parts = [];
  const air = env.querySelector('[data-chip="air"]');
  if (air && !air.querySelector('[data-state="coord-unknown"]')) {
    const t = txt(air);
    const band = airAnnualBand(Number(m.airQuality.annual.pm25));
    expect(t.startsWith(`대기 3년 평균 ${band} · `)).toBe(true);
    parts.push(t.replace(`대기 3년 평균 ${band} · `, "대기 3년 평균 "));
  }
  const nox = env.querySelector('[data-chip="noxious"]');
  if (nox && !nox.querySelector('[data-state="coord-unknown"]')) parts.push(txt(nox));
  const noise = txt(env.querySelector('[data-testid="noise-title"]'));
  if (noise) parts.push(noise.split(" · ")[0]);
  if (parts.length) out.push(`환경: ${parts.join(" · ")}`);
  cleanup();
  return out;
}

function refSchool(m) {
  const out = [];
  const si = draw(<SchoolInfo apt={m} />);
  if (!si.querySelector('[data-state="coord-unknown"]') && si.firstChild) {
    const spans = [...si.querySelectorAll("span")].map(txt);
    const head = [spans.find((t) => / \(1km\)$/.test(t)), spans.find((t) => /^초등 도보 \d+분$/.test(t))].filter(
      Boolean
    );
    if (head.length) out.push(head.join(" · "));
    const btn = si.querySelector("button[aria-expanded]");
    if (btn) {
      fireEvent.click(btn);
      const rows = [...si.querySelectorAll("tbody tr")].slice(0, N.SCHOOL_LIST_MAX);
      for (const tr of rows) {
        const [name, kind, dist] = [...tr.children].map(txt);
        out.push(`${name}(${kind.split("(")[0]})${dist === "—" ? "" : ` ${dist}`}`);
      }
    }
  }
  cleanup();
  return out;
}

const EMPTY = new Set(["-", "—", "0동", "미정"]);
function refPresale(m, hasMoveIn) {
  const pi = draw(<PresaleInfo apt={m} />);
  const root = pi.firstElementChild;
  const out = [];
  if (root && txt(root.children[0]?.children[0]) === "네이버 분양정보") {
    const headSpans = [...root.children[0].children].slice(1);
    const stage = headSpans.find((s) => /** @type {HTMLElement} */ (s).style.padding);
    const type = headSpans.find((s) => !(/** @type {HTMLElement} */ (s).style.padding));
    const first = [stage && txt(stage), type && txt(type)].filter(Boolean).join(" · ");
    const kv = [];
    let schedule = null;
    for (const ch of [...root.children].slice(1)) {
      const el = /** @type {HTMLElement} */ (ch);
      if (txt(el.firstElementChild?.firstElementChild) === "분양가 범위") {
        for (const card of el.children) kv.push([txt(card.children[0]), txt(card.children[1])]);
      } else if (el.style.display === "grid") {
        for (const cell of el.children) kv.push([txt(cell.children[0]), txt(cell.children[1])]);
      } else if (txt(el.firstElementChild) === "일정:") {
        schedule = txt(el).replace(/^일정: /, "");
      }
    }
    const cells = [
      ...(first ? [first] : []),
      ...kv.filter(([l, v]) => !EMPTY.has(v) && !(hasMoveIn && l === "입주시기")).map(([l, v]) => `${l} ${v}`),
    ];
    for (let i = 0; i < cells.length; i += 3) out.push(cells.slice(i, i + 3).join(" · "));
    if (schedule && !EMPTY.has(schedule)) out.push(`일정: ${schedule}`);
  }
  cleanup();
  return out;
}

function refBuilding(m) {
  const bc = draw(<BuildingInfoCard apt={m} />);
  const head = bc.querySelector('[role="button"]');
  if (!head) return [];
  fireEvent.click(head);
  const parts = [...bc.querySelectorAll("[data-field]")]
    .map((c) => [txt(c.children[0]), txt(c.children[1])])
    .filter(([, v]) => v !== "미수집")
    .map(([l, v]) => `${l} ${v}`);
  cleanup();
  return parts.length ? [parts.join(" · ")] : [];
}

/** 화면 부품으로 만든 절 — 절 제목·빈 절 빼기 규칙은 aptStaticBody 와 같다 */
function refSections(m) {
  const out = [];
  const add = (title, lines) => {
    const ls = lines.map((l) => (typeof l === "string" ? { text: l } : l)).filter((l) => l.text);
    if (ls.some((l) => !l.h3)) out.push({ title, lines: ls });
  };
  const basic = refBasic(m);
  add("기본 정보", basic);
  add("실거래 비교", refTrade(m));
  add("교통·주변 시설", refAround(m));
  add("학교", refSchool(m));
  add(
    "분양 정보",
    refPresale(
      m,
      basic.some((l) => l.startsWith("입주: "))
    )
  );
  add("건물 정보", refBuilding(m));
  return out;
}

// ── 같음 시험 ──

describe("정적 본문 = 화면 부품 글자 (픽스처 진짜 단지 전부)", () => {
  it("픽스처는 진짜 단지 30곳 이상 · 목업 4곳 포함", () => {
    expect(APTS.length).toBeGreaterThanOrEqual(30);
    for (const id of ["ah-2025910101", "ap-6028727", "ah-2022910046", "ap-6028729"]) {
      expect(APTS.some((a) => a.id === id)).toBe(true);
    }
  });

  it.each(APTS.map((a) => [a.id, a]))("%s — 절·순서·글자까지 같다", (_id, m) => {
    const ref = refSections(m);
    expect(ref.length).toBeGreaterThan(0);
    expect(N.buildAptSections(m, { tzOffsetMin: LOCAL_TZ })).toEqual(ref);
  });

  it("출처 글 = 상세 창 종합 탭 맨 아래 글자 그대로(소스 대조)", () => {
    const src = readFileSync("src/components/DetailModal.tsx", "utf-8");
    expect(src).toContain(N.SOURCE_TEXT);
  });
});

describe("목업 예시값 (고척 푸르지오 힐스테이트 ah-2025910101)", () => {
  const m = /** @type {Record<string, any>} */ (APTS.find((a) => a.id === "ah-2025910101"));
  const S = N.buildAptSections(m);
  const lines = (title) => S.find((s) => s.title === title)?.lines.map((l) => l.text) ?? [];
  it("절 순서 = 기본 → 실거래 → 교통·주변 → 학교 → 분양 → 건물", () => {
    expect(S.map((s) => s.title)).toEqual([
      "기본 정보",
      "실거래 비교",
      "교통·주변 시설",
      "학교",
      "분양 정보",
      "건물 정보",
    ]);
  });
  it("기본 정보 줄", () => {
    expect(lines("기본 정보")).toEqual([
      "주소: 서울시 구로구 고척동",
      "분양가: 9억 870만 (전용 59.95㎡)",
      "총 983세대 · 미분양 29세대",
      "입주: 2028년 08월",
      "시공사: (주)대우건설, 현대엔지니어링(주)",
      "청약 경쟁률: 90 : 1 (3,502명 신청 / 39세대 모집)",
      "추가 모집 1회 · 마지막 2025.05",
    ]);
  });
  it("실거래 비교 — 「분양가」 줄 없음 · 평형 표 h3", () => {
    const L = lines("실거래 비교");
    expect(L.slice(0, 4)).toEqual([
      "이 단지 비슷한 평수(전용 59.95㎡) 분양권 거래와 견주면 (면적 20㎡ 이내 ㎡당 환산)",
      "이 단지 분양권 거래 9억 6,861만 ~ 11억 9,900만 (5건 · 최근 12개월 · ㎡당 환산)",
      "가운데 값 9억 8,388만",
      "차이 분양가가 7.6% 낮음",
    ]);
    expect(L.some((l) => l.startsWith("분양가 "))).toBe(false);
    const h3 = S.find((s) => s.title === "실거래 비교")
      ?.lines.filter((l) => l.h3)
      .map((l) => l.text);
    expect(h3).toEqual(["이 단지 평형별 분양권 거래 (최근 12개월)"]);
  });
  it("교통·학교·건물 예시", () => {
    expect(lines("교통·주변 시설")[0]).toBe("교통: 개봉역(1호선) 1km · 버스 20개 노선");
    expect(lines("교통·주변 시설")).toContain(
      "걸어서 5분 안팎(0 ~ 500m): 편의점 12곳 198m · 카페 34곳 209m · 약국 8곳 207m"
    );
    expect(lines("학교")[0]).toBe("초 7 · 중 3 · 고 2 (1km) · 초등 도보 5분");
    expect(lines("학교")[1]).toBe("서울고척초등학교(초) 305m");
    expect(lines("건물 정보")).toEqual([
      "최고층 23층 · 난방연료 도시가스 · 대표 향 남서향 · 용적률 257% · 건폐율 22% · 평면구조 3베이판상",
    ]);
  });
});

// ── 규칙 시험(③1~9 경계) ──

/** 픽스처 한 행을 바꿔 부른다 */
const base = /** @type {Record<string, any>} */ (APTS.find((a) => a.id === "ah-2025910101"));
const sec = (m, title) => N.buildAptSections(m).find((s) => s.title === title);
const all = (m) =>
  N.buildAptSections(m)
    .flatMap((s) => [s.title, ...s.lines.map((l) => l.text)])
    .join("\n");

describe("규칙 — 빈 줄·빈 절·빈칸 글자", () => {
  it("줄이 하나도 없는 절은 제목째 빠진다(건물 정보 전부 빈칸 · 분양 단계 없음 · 학교 0)", () => {
    const m = { ...base, maxFloor: null, corridorType: null, heatFuel: null, primaryDirection: null };
    Object.assign(m, { floorAreaRatio: null, buildingCoverageRatio: null, layout: null, presaleStage: null });
    Object.assign(m, { nearbySchools: [], busStopNames: null, naverSchoolWalkMin: null });
    const titles = N.buildAptSections(m).map((s) => s.title);
    expect(titles).not.toContain("건물 정보");
    expect(titles).not.toContain("분양 정보");
    expect(titles).not.toContain("학교");
  });
  it("평형 표 제목(h3)만 남고 줄이 없으면 그 절도 빠진다", () => {
    const m = { ...base, cmpScope: "none", complexTable: [], complexJeonseTable: [], naverSellCount: null };
    Object.assign(m, { naverJeonseCount: null, naverWolseCount: null, naverBuildYear: null, complexJeonseRate: null });
    m.dongFact = null; // none 에서도 동네 사실 줄은 실리므로(세션673) 이 시험은 그 줄도 비운다
    expect(sec(m, "실거래 비교")).toBeUndefined();
  });
  it("비교 범위 none(「비교할 실거래가 아직 없어요」) → 머리 문장만 빠지고 「전세가율」 줄·동네 사실 줄은 실린다(세션673)", () => {
    const m = { ...base, cmpScope: "none", complexJeonseRate: 66.5, dongFact: { n: 3, min: 50000, max: 60000 } };
    const t = all(m);
    expect(t).not.toContain("비교할 실거래가 아직 없어요");
    const trade = (sec(m, "실거래 비교")?.lines ?? []).map((l) => l.text);
    // 전세가율 줄 = 화면 부품이 그린 글자 그대로(complexJeonseText) · none 이면 비교 줄은 이 한 줄뿐
    const jt = complexJeonseText(/** @type {any} */ (m));
    expect(jt).toBeTruthy();
    expect(trade.slice(0, 2)).toEqual([`전세가율 ${jt}`, "같은 동·같은 평수 실거래 3건 · 최저 5억 ~ 최고 6억"]);
    // 같음 시험 — 화면 부품 DOM 으로 만든 절과 그대로 같다
    expect(N.buildAptSections(m, { tzOffsetMin: LOCAL_TZ })).toEqual(refSections(m));
    // 범위 칸이 없으면(effectiveScope null) 화면처럼 동네 사실도 없다
    const n = { ...m, cmpScope: null };
    expect(all(n)).not.toContain("같은 동·같은 평수");
  });
  it("미분양 0 단지 — 「총 N세대」 줄에 미분양 글자 없음(화면 「—」) · 입주 6자리 → 「입주: YYYY년 MM월」", () => {
    const z = /** @type {Record<string, any>} */ (APTS.find((a) => a.id === "ah-2020910014"));
    expect(z.unsold).toBe(0);
    expect(String(z.completion)).toBe("202308");
    const b = N.basicLinesNode(z);
    expect(b).toContain("총 1,218세대");
    expect(b.join("\n")).not.toContain("미분양");
    expect(b).toContain("입주: 2023년 08월");
    // 픽스처 한 행의 칸만 바꿔 경계 확인 — 미분양 0 이면 다른 단지도 같은 꼴 · 6자리 입주 다른 달
    const c = { ...base, unsold: 0, completion: "202311", presaleMoveIn: null };
    const cb = N.basicLinesNode(c);
    expect(cb.find((l) => l.startsWith("총 "))).not.toContain("미분양");
    expect(cb).toContain("입주: 2023년 11월");
  });
  it("「추가 모집 —」 은 안 나온다(횟수 0 · ap-)", () => {
    expect(all({ ...base, unsoldEventCount: 0 })).not.toContain("추가 모집");
    expect(all({ ...base, id: "ap-1", unsoldEventCount: 3 })).not.toContain("추가 모집");
    for (const a of APTS) expect(all(a)).not.toContain("추가 모집 —");
  });
  it("거리 「미수집」 항목은 빠지고 「N km 안에 없음」 은 남는다", () => {
    const m = { ...base, cafeDist: null, cafe: null, subwayDist: 9999 };
    const t = all(m);
    expect(t).not.toContain("카페");
    expect(t).toContain("지하철역 10km 안에 없음");
    for (const a of APTS) expect(all(a)).not.toContain("미수집");
  });
  it("좌표 공유 장 — 「위치 확인 중」 없음 · 교통·거리·학교·대기·혐오 줄 없음(소음은 남음)", () => {
    const cs = APTS.filter((a) => a.coordShared === true);
    expect(cs.length).toBeGreaterThan(0);
    for (const a of cs) {
      const t = all(a);
      expect(t).not.toContain("위치 확인 중");
      expect(t).not.toContain("교통: ");
      expect(t).not.toContain("PM2.5");
      expect(t).not.toContain("혐오시설");
      expect(sec(a, "학교")).toBeUndefined();
    }
    expect(all({ ...base, coordShared: true, noise: 55 })).toContain("환경: 소음 55dB");
  });
  it("분양 칸 값이 -·0동·미정 이면 그 칸만 빠진다", () => {
    const m = { ...base, presaleBuildings: 0, presaleRecruitDate: "미정", presalePp: 0, presaleParking: 0 };
    const t = (sec(m, "분양 정보")?.lines ?? []).map((l) => l.text).join("\n");
    expect(t).not.toContain("동수");
    expect(t).not.toContain("분양시기");
    expect(t).not.toContain("평당가");
    expect(t).not.toContain("주차대수");
    expect(t).toContain("일반분양");
  });
  it("기본 정보에 입주 줄이 있으면 분양 입주시기 칸은 빠지고, 없으면 실린다", () => {
    const m = { ...base, presaleMoveIn: "2028-08" };
    expect(all(m)).not.toContain("입주시기");
    const n = { ...m, completion: null, presaleMoveIn: "2028-08" };
    // 기본 정보 입주 = fmtMoveIn(completion 없음 → presaleMoveIn) 이라 여전히 있다 → 빠짐
    expect(all(n)).toContain("입주: 2028-08");
    expect(all(n)).not.toContain("입주시기");
    expect(N.presaleLinesNode({ ...m }, { hasMoveIn: false, now: new Date() }).join(" ")).toContain("입주시기 2028-08");
  });
  it("분양 문의 전화번호·특징 글은 장에 없다", () => {
    for (const a of APTS) {
      if (a.presaleInquiry) expect(all(a)).not.toContain(String(a.presaleInquiry));
      if (a.presaleFeatures) expect(all(a)).not.toContain(String(a.presaleFeatures));
    }
    expect(APTS.some((a) => a.presaleInquiry)).toBe(true);
  });
  it("학교 표는 앞 8곳까지(9곳 이상 단지)", () => {
    const many = APTS.filter((a) => a.coordShared !== true && schoolsOf(a.nearbySchools).length >= 9);
    expect(many.length).toBeGreaterThan(0);
    for (const a of many) {
      const s = sec(a, "학교")?.lines ?? [];
      expect(s.filter((l) => /\((초|중|고)\)/.test(l.text))).toHaveLength(8);
    }
    expect(N.SCHOOL_LIST_MAX).toBe(8);
  });
});

describe("규칙 — 점수·등급 낱말이 픽스처 전 장에 없다", () => {
  const grades = ["A", "B", "C", "D"];
  it("학군 등급·시공사 등급 괄호·치안·대기/소음 등급 낱말", () => {
    const air = ["좋음", "보통", "나쁨", "매우나쁨"];
    const noise = NOISE_TIERS.map((t) => t.label).filter(Boolean);
    for (const a of APTS) {
      const t = all(a);
      expect(t).not.toMatch(/학군/);
      expect(t).not.toMatch(/\((1군|2군|3군|기타|브랜드 해당없음)\)/);
      expect(t).not.toMatch(/치안|등급|●|○/);
      for (const w of air) expect(t).not.toContain(`평균 ${w}`);
      for (const w of noise) expect(t).not.toContain(`dB · ${w}`);
      expect(t).not.toMatch(/\d+점\)/); // layout 점수 접미
      if (a.schoolGrade) for (const g of grades) expect(t).not.toContain(` 학군 ${g}`);
    }
  });
  it("조망·치안 칩은 싣지 않는다", () => {
    const v = APTS.find((a) => a.view);
    expect(v).toBeTruthy();
    expect(all(v)).not.toContain("조망");
  });
});

describe("수집 날짜 — 기본은 KST(빌드 시간대와 무관)", () => {
  it("19:05 UTC 수집 = KST 다음 날", () => {
    const a = { naverSellCount: 3, naverFetchedAt: "2026-10-27T19:05:00+00:00" };
    expect(N.naverListingTextNode(a)).toBe("매매 3건 (수집 10/28)");
    expect(N.naverListingTextNode(a, 0)).toBe("매매 3건 (수집 10/27)");
    expect(N.naverListingTextNode({ naverFetchedAt: "2026-10-27T19:05:00+00:00" })).toBeNull();
  });
});

// ── 사본 같음 시험(원본 .ts 와 같은 입력 → 같은 출력) ──

describe("사본 함수 = 원본 (경계값 + 픽스처 전 행)", () => {
  const nums = [
    null,
    undefined,
    0,
    -5,
    1,
    9999,
    10000,
    10001,
    24675,
    90870,
    124060,
    57600,
    58400,
    8000.4,
    0.5,
    9.99,
    10,
    1234.5,
  ];
  it("표기 함수(format.ts · area.ts · fieldMeta units/unsold)", () => {
    for (const v of nums) {
      expect(N.fmtPriceNode(v)).toBe(fmtPrice(v));
      expect(N.fmtPriceEok1Node(v)).toBe(fmtPriceEok1(v));
      expect(N.hasKnownAreaNode(v)).toBe(hasKnownArea(v));
      expect(N.unsoldFieldText(v)).toBe(FIELD_META.unsold.fmt(v));
      for (const w of nums) {
        expect(N.fmtPriceRangeNode(v, w)).toBe(fmtPriceRange(v, w));
        expect(N.fmtPriceRangeEok1Node(v, w)).toBe(fmtPriceRangeEok1(v, w));
        expect(N.hubUnitsText(v, w)).toBe(FIELD_META.units.fmt(v, { unsold: w }));
      }
    }
    for (const d of [-7.64, 7.6, 0.04, -0.04, 0, 12.35, -100]) expect(N.fmtPriceGapNode(d)).toBe(fmtPriceGap(d));
    for (const s of ["202808", "2029 미", "미정", "2025-06-01", "[1회]20"])
      expect(N.fmtCompletionNode(s)).toBe(fmtCompletion(s));
    for (const [c, p] of [
      ["202808", null],
      ["2029 미", "2029 미정"],
      [null, " 미정 "],
      ["미정", null],
      [null, null],
      ["", ""],
    ]) {
      expect(N.fmtMoveInNode(c, p)).toBe(fmtMoveIn(c, p));
    }
    for (const s of [
      "전남광주통합특별시 광산구 월계동 870-1",
      "광주광역시 북구",
      "전라남도 순천시",
      "서울시 구로구",
      "세종",
      "  ",
      "",
      null,
    ]) {
      expect(N.fmtAddressNode(s)).toBe(fmtAddress(s));
    }
    for (const s of ["2025-05-08", "2026-11", "2026 미정", "미정", "", null, 5])
      expect(N.fmtRecruitDateNode(s)).toBe(fmtRecruitDate(s));
    const sch = [
      null,
      "",
      "2026-11",
      [{ scheduleName: "당첨자계약", dateInfo: "2025-06-09" }],
      [{}],
      { schdl_info: "x" },
      { schdl_info: 1 },
      {},
    ];
    for (const s of sch) expect(N.fmtPresaleScheduleNode(s)).toBe(fmtPresaleSchedule(s));
  });
  it("시세 탭 함수(PricePositionBox · AreaTradeTable · areaGroups · cardChips)", () => {
    const strip = (rows) => rows.map(({ small: _s, ...r }) => r);
    for (const a of APTS) {
      expect(N.effectiveScopeNode(a)).toBe(effectiveScope(a));
      expect(N.hasRangeNode(a)).toBe(hasRange(a));
      expect(N.scopeHeadTextNode(a)).toBe(scopeHeadText(a));
      expect(N.compareRowsNode(a, a.catsCache?.price)).toEqual(strip(compareRows(a, a.catsCache?.price)));
      expect(N.dongFactPartsNode(a)).toEqual(dongFactParts(a));
      expect(N.complexJeonseTextNode(a)).toBe(complexJeonseText(a));
      expect(N.groupAreaRowsNode(a.complexTable, a.complexJeonseTable, a.area)).toEqual(
        groupAreaRows(a.complexTable, a.complexJeonseTable, a.area)
      );
      expect(N.areaTableRowsNode(a)).toEqual(areaTableRows(a));
      expect(N.areaTableHeadNode(a)).toEqual(areaTableHead(a));
    }
    expect([N.TRADE_SCOPE_PEER_YEARS, N.TRADE_SCOPE_PER_M2_TOL_M2]).toEqual([
      TRADE_SCOPE_PEER_YEARS,
      TRADE_SCOPE_PER_M2_TOL_M2,
    ]);
  });
  it("입지 탭 함수·상수(TransportCard · DistanceDots · sentinels · distanceAxes · nearbySchools)", () => {
    expect(N.DISTANCE_AXES).toEqual(DISTANCE_AXES);
    expect(N.SENTINEL).toEqual(SENTINEL);
    expect(N.SENTINEL_RADIUS_KM).toEqual(SENTINEL_RADIUS_KM);
    for (const a of APTS) {
      expect(N.transportFactsNode(a)).toBe(transportFacts(a));
      expect(N.busStopsTextNode(a)).toBe(busStopsText(a));
      expect(N.schoolsOfNode(a.nearbySchools)).toEqual(schoolsOf(a.nearbySchools));
      for (const f of ["cityDev", "industryDev"]) expect(N.parseKmTextNode(a[f])).toEqual(parseKmText(a[f]));
    }
    for (const m of [0, 1, 499.6, 999, 1000, 1001, 1049, 1050, 9484, 20000]) expect(N.fmtDistNode(m)).toBe(fmtDist(m));
    for (const [f, v] of [
      ["subwayDist", 9999],
      ["subwayDist", 9998],
      ["icDist", 99],
      ["icDist", "99"],
      ["ktxDist", "x"],
      ["convDist", 1e9],
    ]) {
      expect(N.isSentinelNode(f, v)).toBe(isSentinel(f, v));
    }
  });
  it("분양 탭 함수(scorePrice · PresaleTimeline)", () => {
    for (const s of ["202605", "2026-05", "2026-5", "2026-05-01", "202613", "2030 미", "", null, " 202605 "]) {
      expect(N.parseCompletionMonthNode(s)).toBe(parseCompletionMonth(s));
    }
    const now = new Date("2026-10-28T03:00:00+09:00");
    for (const [mi, c] of [
      ["2026-10", null],
      ["2026-09", null],
      [null, "202609"],
      ["미정", "202611"],
      [null, null],
    ]) {
      expect(N.isMoveInPastNode(mi, c, now)).toBe(isMoveInPast(mi, c, now));
    }
    for (const v of [0.5, 1.234, 9.99, 10, 90.4, 1234.5, 437995]) expect(N.fmtRateNode(v)).toBe(fmtRate(v));
  });
  it("건물 정보 칸 = 카드 순서·이름·FIELD_META 표기(layout 은 점수 접미 없는 카드 꼴)", () => {
    expect(N.BUILDING_FIELDS.map(([f, l]) => [f, l])).toEqual(N.BUILDING_FIELDS.map(([f]) => [f, FIELD_META[f].label]));
    for (const [f, , fmt] of N.BUILDING_FIELDS) {
      if (f === "layout") continue;
      for (const v of [null, 0, -1, 23, "도시가스", "", "남서향"]) expect(fmt(v)).toBe(String(FIELD_META[f].fmt(v))); // 화면은 값을 글자로 그린다
    }
    const card = readFileSync("src/components/detail/BuildingInfoCard.tsx", "utf-8");
    const order = [...card.matchAll(/^ {2}"(\w+)",$/gm)].map((x) => x[1]);
    expect(order).toEqual(N.BUILDING_FIELDS.map(([f]) => f));
  });
});
