// @ts-check
/**
 * 정적 단지 장 본문 — 상세 창 탭에 **이미 손님에게 보이는 값**을 **화면과 같은 글자**로 옮긴다(세션672 PR-S4 · 결정 44~49).
 *
 * 검색 로봇이 처음 받는 `dist/apt/{id}/index.html` 본문(`scripts/postbuild-prerender.mjs`)이 쓴다.
 * 앱 화면 코드는 하나도 바꾸지 않는다 — 화면 함수(.ts·.tsx)는 node 빌드 스크립트가 못 읽어서 여기 **사본**을 두고,
 * `aptStaticBody.test.jsx` 가 화면 부품을 jsdom 으로 그린 글자와 이 파일이 만든 줄을 절·순서·글자까지 맞댄다
 * (클로킹 막이 — 사람과 로봇이 같은 값). 사본마다 원본 위치를 적어 둔다 — 원본을 고치면 같음 시험이 빨개진다.
 *
 * 싣지 않는 것(결정 44~49 · 목업 「빼는 것」): 점수·판정·등급 글자 전부(학군 A~D·시공사 등급·치안·대기/소음 등급 낱말) ·
 * 적정가 대비 %·혜택 금액·편차 막대 · 대출·금융 · 실행 중 조회 값(추이·청약홈 공식 일정) · 층별 매매가·지역 통계 ·
 * 분양 문의 전화번호·특징 글 · 「미수집」「아직 없어요」「위치 확인 중」 같은 빈칸 글자.
 * 값이 없는 줄은 빼고, 줄이 하나도 없는 절은 제목째 뺀다(결정 45).
 *
 * `.vercelignore` 는 `scripts/` 새 파일을 막고 `src/**\/*.mjs` 는 통과시킨다 — 그래서 여기(`src/utils/`)에 둔다.
 */

/** 상세 창 종합 탭 맨 아래 출처 글 — 원본 `src/components/DetailModal.tsx` 출처 footer(글자 그대로 · 시험이 소스 대조) */
export const SOURCE_TEXT =
  "출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)";

/** 절 제목(결정 47 순서) */
export const SECTION_TITLES = /** @type {const} */ ([
  "기본 정보",
  "실거래 비교",
  "교통·주변 시설",
  "학교",
  "분양 정보",
  "건물 정보",
]);

/** 학교 표에서 싣는 학교 수(앞 8곳 · 결정 49) */
export const SCHOOL_LIST_MAX = 8;

/** KST(UTC+9) — 손님 화면이 그리는 날짜와 맞추려고 빌드 시간대(Vercel = UTC)와 무관하게 쓴다 */
const KST_OFFSET_MIN = 540;

// ── 표기 함수 사본 (원본: src/lib/format.ts · src/lib/area.ts) ────────────────────

/**
 * YYYYMM → "YYYY년 MM월", 아니면 원문. 원본 format.ts fmtCompletion(빈 값 → "-" 는 부르는 쪽이 거른다).
 * @param {unknown} v @returns {string}
 */
export function fmtCompletionNode(v) {
  const s = String(v);
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(0, 4)}년 ${s.slice(4, 6)}월`;
}

/**
 * 만원 → "2억 4,675만". 원본 format.ts fmtPrice.
 * @param {unknown} v @returns {string}
 */
export function fmtPriceNode(v) {
  if (v == null) return "-";
  const n = Number(v);
  if (!(n > 0)) return "-";
  const eok = Math.floor(n / 10000);
  const man = n % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
}

/**
 * 입주 표시값. 원본 format.ts fmtMoveIn.
 * @param {unknown} completion @param {unknown} presaleMoveIn @returns {string}
 */
export function fmtMoveInNode(completion, presaleMoveIn) {
  if (completion && /^\d{6}$/.test(String(completion))) return fmtCompletionNode(completion);
  const raw = typeof presaleMoveIn === "string" ? presaleMoveIn.trim() : "";
  if (raw) return raw;
  const stored = typeof completion === "string" ? completion.trim() : "";
  return stored || "-";
}

/**
 * 총 세대 표시 — 원본 fieldMeta.ts FIELD_META.units.fmt: 모르거나 1 이하·미분양보다 작으면 "정보 없음".
 * @param {unknown} units @param {unknown} unsold @returns {string}
 */
export function hubUnitsText(units, unsold) {
  if (units == null) return "정보 없음";
  const n = Number(units);
  if (!(n > 1)) return "정보 없음";
  if (unsold != null && Number(unsold) > n) return "정보 없음";
  return `${n.toLocaleString("ko-KR")}세대`;
}

/**
 * 미분양 표시 — 원본 fieldMeta.ts FIELD_META.unsold.fmt(0·모름은 "—").
 * @param {unknown} v @returns {string}
 */
export function unsoldFieldText(v) {
  return v != null && Number(v) > 0 ? `${Number(v).toLocaleString("ko-KR")}세대` : "—";
}

/** 원본 format.ts ADDR_SIDO_SHORT */
/** @type {Record<string, string>} */
const ADDR_SIDO_SHORT = { 전남광주통합특별시: "광주", 광주광역시: "광주", 전라남도: "전남" };

/**
 * 주소 표시용 시도 접두 축약. 원본 format.ts fmtAddress.
 * @param {unknown} v @returns {string}
 */
export function fmtAddressNode(v) {
  if (!v || typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  const sp = s.indexOf(" ");
  if (sp <= 0) return s;
  const head = s.slice(0, sp);
  const shortHead = ADDR_SIDO_SHORT[head];
  return shortHead ? `${shortHead}${s.slice(sp)}` : s;
}

/** 원본 area.ts hasKnownArea @param {unknown} area @returns {boolean} */
export function hasKnownAreaNode(area) {
  return area != null && Number(area) > 0;
}

/** 원본 format.ts fmtPriceGap(+ priceGapParts) @param {number} dev @returns {string} */
export function fmtPriceGapNode(dev) {
  const pct = Math.abs(dev).toFixed(1);
  if (pct === "0.0") return "분양가가 같음";
  return `분양가가 ${pct}% ${dev > 0 ? "낮음" : "높음"}`;
}

/** 원본 format.ts fmtPriceRange @param {number | null | undefined} min @param {number | null | undefined} max @returns {string} */
export function fmtPriceRangeNode(min, max) {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min === max) return fmtPriceNode(min);
  const lo = min != null ? fmtPriceNode(min) : "?";
  const hi = max != null ? fmtPriceNode(max) : "?";
  return `${lo} ~ ${hi}`;
}

/** 원본 format.ts fmtPriceEok1 @param {number | null | undefined} v @returns {string} */
export function fmtPriceEok1Node(v) {
  if (v == null || !(v > 0)) return "-";
  if (v < 10000) return `${Math.round(v).toLocaleString()}만`;
  return `${Math.round(v / 1000) / 10}억`;
}

/** 원본 format.ts fmtPriceRangeEok1 @param {number | null | undefined} min @param {number | null | undefined} max @returns {string} */
export function fmtPriceRangeEok1Node(min, max) {
  const lo = fmtPriceEok1Node(min);
  const hi = fmtPriceEok1Node(max);
  return lo === hi ? lo : `${lo}~${hi}`;
}

/** @param {unknown} x @returns {x is Record<string, any>} */
const isObj = (x) => typeof x === "object" && x !== null;

/** 원본 format.ts fmtPresaleSchedule @param {unknown} schedule @returns {string} */
export function fmtPresaleScheduleNode(schedule) {
  if (!schedule) return "—";
  if (typeof schedule === "string") return schedule;
  if (Array.isArray(schedule)) {
    const items = schedule
      .filter((s) => isObj(s) && Boolean(s.scheduleName || s.dateInfo))
      .map((s) => `${s.scheduleName ?? ""} ${s.dateInfo ?? ""}`.trim());
    return items.length > 0 ? items.join(", ") : "—";
  }
  if (isObj(schedule)) {
    if (schedule.scheduleName || schedule.dateInfo) {
      return `${schedule.scheduleName ?? ""} ${schedule.dateInfo ?? ""}`.trim();
    }
    if (schedule.schdl_info) {
      return typeof schedule.schdl_info === "string" ? schedule.schdl_info : "일정 있음";
    }
  }
  return "—";
}

/** 원본 format.ts fmtRecruitDate @param {unknown} v @returns {string} */
export function fmtRecruitDateNode(v) {
  if (!v) return "—";
  if (!(typeof v === "string" || v instanceof Date)) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return typeof v === "string" ? v : "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// ── 시세 탭 사본 (원본: src/components/detail/PricePositionBox.tsx · AreaTradeTable.tsx · src/lib/areaGroups.ts ·
//    src/constants/cardChips.ts hasRange · src/constants/scoringTiers.ts) ────────────────────

/** 원본 scoringTiers.ts */
export const TRADE_SCOPE_PER_M2_TOL_M2 = 20;
/** 원본 scoringTiers.ts */
export const TRADE_SCOPE_PEER_YEARS = 10;

/** 원본 cardChips.ts hasRange(+ isJudgedScope) @param {Record<string, any>} apt @returns {boolean} */
export function hasRangeNode(apt) {
  return (
    (apt.cmpScope === "complex" || apt.cmpScope === "dong_peer") &&
    Number.isFinite(apt.cmpMin) &&
    Number.isFinite(apt.cmpMax)
  );
}

/** 원본 PricePositionBox.tsx effectiveScope @param {Record<string, any>} apt @returns {"complex" | "dong_peer" | "none" | null} */
export function effectiveScopeNode(apt) {
  const s = apt.cmpScope;
  if (s == null) return null;
  if ((s === "complex" || s === "dong_peer") && Number(apt.cmpFairPrice) > 0) return s;
  return "none";
}

/** 원본 PricePositionBox.tsx compareLabel @param {Record<string, any>} apt @param {"complex" | "dong_peer"} scope */
function compareLabel(apt, scope) {
  if (scope === "dong_peer") return "같은 동 또래 실거래";
  return apt.cmpSrc === "presale" ? "이 단지 분양권 거래" : "이 단지 실거래";
}

/** 원본 PricePositionBox.tsx devOf @param {Record<string, any> | null | undefined} priceCat @param {string | null} scope @returns {number | null} */
function devOf(priceCat, scope) {
  if (scope == null || scope === "none") return null;
  if (!(Number(priceCat?.fairPrice) > 0) || priceCat?.deviation == null) return null;
  if (priceCat.fairPriceScope !== scope) return null;
  const dev = Number(priceCat.deviation);
  return Number.isFinite(dev) ? dev : null;
}

/** 원본 PricePositionBox.tsx scopeHeadText @param {Record<string, any>} apt @returns {string | null} */
export function scopeHeadTextNode(apt) {
  const scope = effectiveScopeNode(apt);
  if (scope == null) return null;
  if (scope === "none") return "비교할 실거래가 아직 없어요";
  const perM2 = apt.cmpAreaMode === "per_m2";
  const areaText = hasKnownAreaNode(apt.area) ? `(전용 ${Math.round(Number(apt.area) * 100) / 100}㎡)` : "";
  const area = `${perM2 ? "비슷한" : "같은"} 평수${areaText}`;
  const who =
    scope === "dong_peer"
      ? `같은 동 비슷한 연식(±${TRADE_SCOPE_PEER_YEARS}년)·${area} 실거래`
      : `이 단지 ${area} ${apt.cmpSrc === "presale" ? "분양권 거래" : "실거래"}`;
  const tail = perM2 ? ` (면적 ${TRADE_SCOPE_PER_M2_TOL_M2}㎡ 이내 ㎡당 환산)` : "";
  return `${who}와 견주면${tail}`;
}

/** 원본 PricePositionBox.tsx complexJeonseText @param {Record<string, any>} apt @returns {string | null} */
export function complexJeonseTextNode(apt) {
  const r = apt.complexJeonseRate;
  if (r == null || !Number.isFinite(Number(r))) return null;
  const rate = `${Math.round(Number(r) * 10) / 10}%`;
  const jn = Number(apt.complexJeonseN),
    sn = Number(apt.complexSaleN);
  return jn > 0 && sn > 0 ? `${rate} (전세 ${jn}건 ÷ 매매 ${sn}건)` : rate;
}

/**
 * 원본 PricePositionBox.tsx compareRows.
 * @param {Record<string, any>} apt @param {Record<string, any> | null | undefined} priceCat
 * @returns {Array<{ key: string, label: string, value: string, sub?: string }>}
 */
export function compareRowsNode(apt, priceCat) {
  /** @type {Array<{ key: string, label: string, value: string, sub?: string }>} */
  const rows = [];
  const scope = effectiveScopeNode(apt);
  if (scope === "complex" || scope === "dong_peer") {
    const price = Number(apt.price);
    if (price > 0) rows.push({ key: "price", label: "분양가", value: fmtPriceNode(price) });
    const n = Number(apt.cmpN ?? 0) || 0;
    const months = Number(apt.cmpMonths ?? 0);
    const counts = [n > 0 ? `${n}건` : null, months > 0 ? `최근 ${months}개월` : null].filter(Boolean).join(" · ");
    const dev = devOf(priceCat, scope);
    if (hasRangeNode(apt)) {
      const sub = [counts || null, apt.cmpAreaMode === "per_m2" ? "㎡당 환산" : null].filter(Boolean).join(" · ");
      rows.push({
        key: "range",
        label: compareLabel(apt, scope),
        value: fmtPriceRangeNode(Number(apt.cmpMin), Number(apt.cmpMax)),
        ...(sub ? { sub } : {}),
      });
      rows.push({ key: "median", label: "가운데 값", value: fmtPriceNode(Number(apt.cmpFairPrice)) });
      if (dev != null && price > 0) rows.push({ key: "gap", label: "차이", value: fmtPriceGapNode(dev) });
      const jMin = apt.complexJeonseMin,
        jMax = apt.complexJeonseMax;
      if (Number.isFinite(jMin) && Number.isFinite(jMax)) {
        const jn = Number(apt.complexJeonseN);
        rows.push({
          key: "jeonseRange",
          label: scope === "dong_peer" ? "이 단지 전세" : "전세",
          value: `${fmtPriceRangeNode(Number(jMin), Number(jMax))}${jn > 0 ? ` (${jn}건)` : ""}`,
        });
      }
    } else {
      rows.push({
        key: "median",
        label: `${compareLabel(apt, scope)} 중앙값`,
        value: `${fmtPriceNode(Number(apt.cmpFairPrice))}${counts ? ` (${counts})` : ""}`,
      });
      if (dev != null && price > 0) rows.push({ key: "gap", label: "차이", value: fmtPriceGapNode(dev) });
    }
  }
  const jeonse = complexJeonseTextNode(apt);
  if (jeonse) rows.push({ key: "jeonse", label: "전세가율", value: jeonse });
  return rows;
}

/** 원본 PricePositionBox.tsx dongFactParts @param {Record<string, any>} apt */
export function dongFactPartsNode(apt) {
  const scope = effectiveScopeNode(apt);
  if (scope !== "dong_peer" && scope !== "none") return null;
  const f = apt.dongFact;
  if (!f || !(Number(f.n) > 0)) return null;
  const count = `같은 동·같은 평수 실거래 ${f.n}건`;
  const min = Number(f.min),
    max = Number(f.max);
  const dropPrice = scope === "dong_peer" && hasRangeNode(apt);
  const price =
    !dropPrice && min > 0 && max > 0
      ? min === max
        ? fmtPriceNode(min)
        : `최저 ${fmtPriceNode(min)} ~ 최고 ${fmtPriceNode(max)}`
      : null;
  /** @type {string | null} */
  let year = null;
  if (f.build_year_min != null && f.build_year_max != null) {
    const span =
      f.build_year_min === f.build_year_max ? `${f.build_year_min}년` : `${f.build_year_min}~${f.build_year_max}년`;
    const g = f.age_gap_years == null ? 0 : Math.round(Number(f.age_gap_years));
    const gap = g > 0 ? ` (이 단지보다 약 ${g}년 오래됨)` : g < 0 ? ` (이 단지보다 약 ${-g}년 새 집)` : "";
    year = `${span}에 지은 집${gap}`;
  }
  return { count, price, year };
}

/** 원본 areaGroups.ts AREA_CHAIN_GAP_M2 */
const AREA_CHAIN_GAP_M2 = 1;
/** @param {number} v */
const round2 = (v) => Math.round(v * 100) / 100;
/** @param {number} a @param {number} b */
const within = (a, b) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= AREA_CHAIN_GAP_M2 * 100;
/** @param {unknown} rows @returns {Array<Record<string, any>>} */
const validRows = (rows) =>
  Array.isArray(rows)
    ? rows.filter(
        (r) =>
          r != null &&
          Number(r.area) > 0 &&
          Number(r.n) > 0 &&
          r.min != null &&
          r.max != null &&
          Number.isFinite(Number(r.min)) &&
          Number.isFinite(Number(r.max))
      )
    : [];
/** @param {Array<Record<string, any>>} rows @returns {{ n: number, min: number, max: number } | null} */
function statOf(rows) {
  if (rows.length === 0) return null;
  return {
    n: rows.reduce((s, r) => s + Number(r.n), 0),
    min: Math.min(...rows.map((r) => Number(r.min))),
    max: Math.max(...rows.map((r) => Number(r.max))),
  };
}

/**
 * @typedef {{ key: number, areas: number[], saleAreas: number[], sale: { n: number, min: number, max: number } | null, jeonse: { n: number, min: number, max: number } | null, isBase: boolean }} AreaGroupRowNode
 */

/** 원본 areaGroups.ts groupAreaRows @param {unknown} sale @param {unknown} jeonse @param {unknown} baseArea @returns {AreaGroupRowNode[]} */
export function groupAreaRowsNode(sale, jeonse, baseArea) {
  const s = validRows(sale).map((r) => ({ ...r, area: round2(Number(r.area)) }));
  const j = validRows(jeonse).map((r) => ({ ...r, area: round2(Number(r.area)) }));
  const all = [...new Set([...s, ...j].map((r) => r.area))].sort((a, b) => a - b);
  if (all.length === 0) return [];
  /** @type {number[][]} */
  const chains = [];
  for (const a of all) {
    const last = chains[chains.length - 1];
    if (last && within(last[last.length - 1], a)) last.push(a);
    else chains.push([a]);
  }
  const baseC = Number(baseArea) > 0 ? Math.round(Number(baseArea) * 100) : null;
  let baseIdx = -1;
  let baseDist = Infinity;
  if (baseC != null) {
    chains.forEach((c, i) => {
      for (const a of c) {
        const d = Math.abs(Math.round(a * 100) - baseC);
        if (d <= AREA_CHAIN_GAP_M2 * 100 && d < baseDist) {
          baseDist = d;
          baseIdx = i;
        }
      }
    });
  }
  return chains.map((c, i) => {
    /** @param {{ area: number }} r */
    const inChain = (r) => c.includes(r.area);
    const sr = s.filter(inChain);
    const jr = j.filter(inChain);
    return {
      key: Math.floor(c[0]),
      areas: c,
      saleAreas: [...new Set(sr.map((r) => r.area))].sort((a, b) => a - b),
      sale: statOf(sr),
      jeonse: statOf(jr),
      isBase: i === baseIdx,
    };
  });
}

/** 원본 AreaTradeTable.tsx areaTableHead(+ areaTableKind) @param {Record<string, any>} apt */
export function areaTableHeadNode(apt) {
  const kind =
    effectiveScopeNode(apt) === "complex" && (apt.cmpSrc === "sale" || apt.cmpSrc === "presale") ? apt.cmpSrc : null;
  const title =
    kind === "sale"
      ? "이 단지 평형별 실거래"
      : kind === "presale"
        ? "이 단지 평형별 분양권 거래"
        : "이 단지 평형별 거래";
  const saleLabel = kind === "sale" ? "매매" : kind === "presale" ? "분양권" : "거래";
  const months = Number(apt.cmpMonths ?? 0);
  return { title, period: months > 0 ? `최근 ${months}개월` : null, saleLabel };
}

/** 원본 AreaTradeTable.tsx areaTableRows(+ sameAsBox) @param {Record<string, any>} apt @returns {AreaGroupRowNode[]} */
export function areaTableRowsNode(apt) {
  const grouped = groupAreaRowsNode(apt.complexTable, apt.complexJeonseTable, apt.area);
  if (grouped.length === 0) return [];
  const scope = effectiveScopeNode(apt);
  const boxed = scope === "complex" || scope === "dong_peer";
  const rows = boxed ? grouped : grouped.map((r) => (r.isBase ? { ...r, isBase: false } : r));
  const same =
    scope === "complex" &&
    apt.cmpAreaMode === "same_area" &&
    hasRangeNode(apt) &&
    rows.length === 1 &&
    rows[0].isBase &&
    rows[0].saleAreas.length === 1;
  return same ? [] : rows;
}

/**
 * 원본 NaverListingLine.tsx — 사실 글자(머리 「네이버 매물 현황」 뒤) + 수집 날짜.
 * 화면은 브라우저 시간대로 날짜를 그린다 — 손님 대부분이 KST 라 기본값은 KST(빌드 시간대 UTC 와 하루 갈리지 않게).
 * 같음 시험은 시험 PC 시간대를 넘겨 부품과 맞댄다.
 * @param {Record<string, any>} apt @param {number} [tzOffsetMin] 분 단위 UTC 편차(KST = 540)
 * @returns {string | null}
 */
export function naverListingTextNode(apt, tzOffsetMin = KST_OFFSET_MIN) {
  const counts = [
    ["naverSellCount", "매매"],
    ["naverJeonseCount", "전세"],
    ["naverWolseCount", "월세"],
  ]
    .map(([f, label]) => ({ label, value: apt[f] }))
    .filter((c) => c.value != null);
  /** @type {string[]} */
  const facts = [];
  if (counts.length > 0) facts.push(counts.map((c) => `${c.label} ${String(c.value)}건`).join(" · "));
  if (apt.naverBuildYear != null) facts.push(`주변 단지 평균 건축연도 ${String(apt.naverBuildYear)}년`);
  if (facts.length === 0) return null;
  /** @type {string | null} */
  let fetched = null;
  if (apt.naverFetchedAt != null) {
    const d = new Date(String(apt.naverFetchedAt));
    if (!Number.isNaN(d.getTime())) {
      const z = new Date(d.getTime() + tzOffsetMin * 60000);
      fetched = `${z.getUTCMonth() + 1}/${z.getUTCDate()}`;
    }
  }
  return `${facts.join(" · ")}${fetched ? ` (수집 ${fetched})` : ""}`;
}

// ── 입지 탭 사본 (원본: src/constants/sentinels.ts · distanceAxes.ts · src/lib/nearbySchools.ts ·
//    src/components/charts/DistanceDots.tsx · detail/TransportCard.tsx · detail/SchoolInfo.tsx · detail/LocationEnvBlock.tsx) ──

/** 원본 sentinels.ts SENTINEL */
export const SENTINEL = { subwayDist: 9999, icDist: 99, ktxDist: 99 };
/** 원본 sentinels.ts SENTINEL_RADIUS_KM @type {Record<string, number>} */
export const SENTINEL_RADIUS_KM = { subwayDist: 10, icDist: 20, ktxDist: 20 };

/** 원본 sentinels.ts isSentinel @param {string} field @param {unknown} value @returns {boolean} */
export function isSentinelNode(field, value) {
  if (!(field in SENTINEL)) return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n >= /** @type {Record<string, number>} */ (SENTINEL)[field];
}

/**
 * 원본 distanceAxes.ts DISTANCE_AXES (같음 시험이 원본과 toEqual).
 * @type {Array<{ title: string, cap: number, capLabel: string, onlyWhenPresent?: boolean, items: Array<{ field: string, label: string, countField?: string, unit?: "km", schoolType?: string, nameField?: string, kmInText?: boolean }> }>}
 */
export const DISTANCE_AXES = [
  {
    title: "걸어서 5분 안팎",
    cap: 500,
    capLabel: "500m",
    items: [
      { field: "convDist", label: "편의점", countField: "conv" },
      { field: "cafeDist", label: "카페", countField: "cafe" },
      { field: "pharmacyDist", label: "약국", countField: "pharmacy" },
    ],
  },
  {
    title: "걸어서 갈 만한 거리",
    cap: 1000,
    capLabel: "1km",
    items: [
      { field: "childcareDist", label: "어린이집", countField: "childcare" },
      { field: "cultureDist", label: "문화시설", countField: "culture" },
      { field: "hospitalDist", label: "병원", countField: "hospital" },
      { field: "parkDist", label: "공원", countField: "park" },
      { field: "bankDist", label: "은행", countField: "bank" },
      { field: "martDist", label: "마트", countField: "mart" },
      { field: "nearbySchools", label: "초등학교", schoolType: "초" },
      { field: "nearbySchools", label: "중학교", schoolType: "중" },
      { field: "nearbySchools", label: "고등학교", schoolType: "고" },
    ],
  },
  {
    title: "차로 가는 거리",
    cap: 10000,
    capLabel: "10km",
    items: [
      { field: "subwayDist", label: "지하철역" },
      { field: "policeDist", label: "경찰관서", countField: "police" },
      { field: "emergencyDist", label: "응급의료", countField: "emergency" },
    ],
  },
  {
    title: "고속도로·KTX",
    cap: 20000,
    capLabel: "20km",
    items: [
      { field: "icDist", label: "고속도로 IC", unit: "km" },
      { field: "ktxDist", label: "KTX역", unit: "km" },
    ],
  },
  {
    title: "개발 사업지까지",
    cap: 5000,
    capLabel: "5km",
    onlyWhenPresent: true,
    items: [
      { field: "devDist", label: "교통 개발", nameField: "transitDev", unit: "km" },
      { field: "cityDev", label: "도시 개발", kmInText: true },
      { field: "industryDev", label: "산업 개발", kmInText: true },
    ],
  },
];

/** 원본 nearbySchools.ts isSchoolName·schoolsOf @param {unknown} nearbySchools @returns {Array<Record<string, any>>} */
export function schoolsOfNode(nearbySchools) {
  return Array.isArray(nearbySchools)
    ? nearbySchools.filter(
        (s) => s != null && typeof s.name === "string" && /(?:초등학교|중학교|고등학교|학교)$/.test(s.name.trim())
      )
    : [];
}

/** 원본 nearbySchools.ts nearestSchoolDistance @param {Array<Record<string, any>>} schools @param {string} type @returns {number | null} */
function nearestSchoolDistance(schools, type) {
  /** @type {number | null} */
  let best = null;
  for (const s of schools) {
    if (s.type !== type || s.distance == null) continue;
    const d = Number(s.distance);
    if (!Number.isFinite(d) || d < 0) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}

/** 원본 DistanceDots.tsx fmtDist @param {number} m @returns {string} */
export function fmtDistNode(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, "")}km` : `${Math.round(m)}m`;
}

/** 원본 DistanceDots.tsx parseKmText @param {unknown} raw @returns {{ name: string | null, m: number | null }} */
export function parseKmTextNode(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { name: null, m: null };
  const t = raw.trim();
  const mm = /^(.*?)\s*(\d+(?:\.\d+)?)\s*km\s*$/i.exec(t);
  if (!mm) return { name: t, m: null };
  const km = Number(mm[2]);
  return { name: mm[1].trim() || null, m: Number.isFinite(km) ? km * 1000 : null };
}

/**
 * 원본 DistanceDots.tsx readRow(+ usable·outOfRange·usableCount) — 한 줄의 라벨·거리·센티널 글자·이름.
 * @param {(typeof DISTANCE_AXES)[number]["items"][number]} it @param {Record<string, any>} raw
 */
function readRow(it, raw) {
  if (it.schoolType) {
    const v = nearestSchoolDistance(schoolsOfNode(raw[it.field]), it.schoolType);
    return { label: it.label, name: null, v, out: null, present: v != null };
  }
  if (it.kmInText) {
    const p = parseKmTextNode(raw[it.field]);
    return { label: it.label, name: p.name, v: p.m, out: null, present: p.name != null || p.m != null };
  }
  const rv = raw[it.field];
  /** @type {number | null} */
  let n = null;
  if (rv != null) {
    const x = Number(rv);
    if (Number.isFinite(x) && x >= 0 && !isSentinelNode(it.field, x)) n = x;
  }
  const v = n == null ? null : it.unit === "km" ? n * 1000 : n;
  /** @type {string | null} */
  let out = null;
  if (
    rv != null &&
    isSentinelNode(it.field, rv) &&
    !(it.field === "subwayDist" && raw.icDist == null && raw.ktxDist == null)
  ) {
    out = `${SENTINEL_RADIUS_KM[it.field]}km 안에 없음`;
  }
  const name =
    it.nameField && typeof raw[it.nameField] === "string" && raw[it.nameField].trim() ? raw[it.nameField].trim() : null;
  /** @type {number | null} */
  let cnt = null;
  if (it.countField && raw[it.countField] != null) {
    const c = Number(raw[it.countField]);
    if (Number.isFinite(c) && c > 0) cnt = Math.round(c);
  }
  return {
    label: cnt != null ? `${it.label} ${cnt}곳` : it.label,
    name,
    v,
    out,
    present: name != null || v != null || out != null,
  };
}

/**
 * 거리 묶음 줄 — 원본 DistanceDots.tsx 가 그리는 축(묶음)마다 한 줄 `{묶음}(0 ~ {상한}): {라벨} {값} · …`.
 * 값이 「미수집」인 항목은 빼고(빈칸 글자) 「N km 안에 없음」은 둔다 · 항목이 0개인 묶음은 뺀다 ·
 * 좌표 공유(「위치 확인 중」)·그림이 빈 상태(「아직 모으지 못했어요」)면 줄 없음.
 * @param {Record<string, any>} apt @returns {string[]}
 */
export function distanceGroupLinesNode(apt) {
  if (apt.coordShared === true) return [];
  const axes = DISTANCE_AXES.map((ax) => {
    const rows = ax.items.map((it) => readRow(it, apt));
    const keep = rows.filter((r, i) => r.present || !(ax.onlyWhenPresent || ax.items[i].schoolType));
    return { ...ax, rows: keep };
  }).filter((ax) => ax.rows.length > 0);
  const filled = axes.reduce((s, a) => s + a.rows.filter((r) => r.v != null || r.out != null).length, 0);
  if (filled === 0) return [];
  /** @type {string[]} */
  const lines = [];
  for (const ax of axes) {
    /** @type {string[]} */
    const parts = [];
    for (const r of ax.rows) {
      const value = r.v != null ? fmtDistNode(r.v) : r.out != null ? r.out : null;
      if (value == null) continue; // 화면 글자 「미수집」
      parts.push(`${r.label} ${value}${r.name ? ` ${r.name}` : ""}`);
    }
    if (parts.length > 0) lines.push(`${ax.title}(0 ~ ${ax.capLabel}): ${parts.join(" · ")}`);
  }
  return lines;
}

/** 원본 TransportCard.tsx transportFacts @param {Record<string, any>} apt @returns {string | null} */
export function transportFactsNode(apt) {
  if (apt.coordShared === true) return null;
  /** @type {string[]} */
  const parts = [];
  const name = typeof apt.subwayName === "string" ? apt.subwayName.trim() : "";
  if (name) {
    const lines = typeof apt.subwayLines === "string" && apt.subwayLines.trim() ? `(${apt.subwayLines.trim()})` : "";
    const d = Number(apt.subwayDist);
    const dist =
      apt.subwayDist != null && Number.isFinite(d) && d >= 0 && !isSentinelNode("subwayDist", d)
        ? ` ${fmtDistNode(d)}`
        : "";
    parts.push(`${name}${lines}${dist}`);
  }
  const bus = Number(apt.busRoutes);
  if (apt.busRoutes != null && Number.isFinite(bus) && bus > 0) parts.push(`버스 ${Math.round(bus)}개 노선`);
  return parts.length ? parts.join(" · ") : null;
}

/** 원본 TransportCard.tsx busStopsText @param {Record<string, any>} apt @returns {string | null} */
export function busStopsTextNode(apt) {
  if (apt.coordShared === true) return null;
  const names = String(apt.busStopNames ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && !s.includes("미정차"));
  if (!names.length) return null;
  const rest = names.length - 3;
  return `버스 정류장 ${names.slice(0, 3).join(" · ")}${rest > 0 ? ` 외 ${rest}` : ""}`;
}

/**
 * 환경 줄 — 원본 LocationEnvBlock.tsx 칩·소음 제목에서 **값만**(등급 낱말·치안 등급 빼고):
 * 대기 3년 평균 PM2.5 값 · 혐오시설 이름·거리 · 소음 dB. 좌표 공유면 대기·혐오시설은 화면이 「위치 확인 중」이라 뺀다.
 * @param {Record<string, any>} apt @returns {string | null}
 */
export function envLineNode(apt) {
  const coordUnknown = apt.coordShared === true;
  /** @type {string[]} */
  const parts = [];
  const pm = Number(apt.airQuality?.annual?.pm25);
  if (!coordUnknown && apt.airQuality?.annual?.pm25 != null && Number.isFinite(pm)) {
    parts.push(`대기 3년 평균 PM2.5 ${Math.round(pm * 10) / 10}`);
  }
  const nox = Array.isArray(apt.noxious)
    ? apt.noxious.filter((/** @type {unknown} */ s) => typeof s === "string" && s)
    : [];
  if (!coordUnknown && nox.length > 0) {
    const d = Number(apt.noxiousDist);
    const dist = apt.noxiousDist != null && Number.isFinite(d) && d > 0 ? ` ${Math.round(d)}m` : "";
    const rest = nox.length - 3;
    parts.push(`혐오시설 ${nox.slice(0, 3).join("·")}${rest > 0 ? ` 외 ${rest}` : ""}${dist}`);
  }
  if (apt.noise != null && Number.isFinite(Number(apt.noise))) parts.push(`소음 ${Number(apt.noise)}dB`);
  return parts.length ? `환경: ${parts.join(" · ")}` : null;
}

/** 원본 SchoolInfo.tsx fmtDist(학교 표 거리 칸) @param {number | null | undefined} d @returns {string} */
export function schoolDistTextNode(d) {
  return d == null ? "—" : d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`;
}

/**
 * 학교 절 줄 — 원본 SchoolInfo.tsx: ① 1km 안 학교 수(머리) · 초등 도보 칩 ② 「전체 N개 학교 보기」 표 앞 8곳
 * (`{학교명}({초·중·고}) {도보거리}`). 학군 등급 칩 글자는 싣지 않는다. 좌표 공유면 화면이 「위치 확인 중」뿐이라 줄 없음.
 * @param {Record<string, any>} apt @returns {string[]}
 */
export function schoolLinesNode(apt) {
  if (apt.coordShared === true) return [];
  const schools = schoolsOfNode(apt.nearbySchools);
  if (schools.length === 0 && !busStopsTextNode(apt)) return [];
  const counts = ["초", "중", "고"]
    .map((t) => {
      const w = schools.filter((s) => s.type === t && s.distance != null && s.distance <= 1000);
      return w.length > 0 ? `${t} ${w.length}` : null;
    })
    .filter(Boolean);
  const walk = apt.naverSchoolWalkMin;
  const head = [counts.length > 0 ? `${counts.join(" · ")} (1km)` : null, walk != null ? `초등 도보 ${walk}분` : null]
    .filter(Boolean)
    .join(" · ");
  /** @type {string[]} */
  const lines = head ? [head] : [];
  const sorted = [...schools].sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, SCHOOL_LIST_MAX);
  for (const s of sorted) {
    const dist = schoolDistTextNode(s.distance);
    lines.push(`${s.name}(${s.type})${dist === "—" ? "" : ` ${dist}`}`);
  }
  return lines;
}

// ── 분양 탭 사본 (원본: src/scoring/scorePrice.ts · src/components/charts/PresaleTimeline.tsx ·
//    detail/PresaleInfo.tsx · detail/UnsoldEventCard.tsx) ────────────────────

/** 원본 scorePrice.ts parseCompletionMonth @param {unknown} completion @returns {number | null} */
export function parseCompletionMonthNode(completion) {
  if (completion == null) return null;
  const s = String(completion).trim();
  if (!s) return null;
  const m = /^(\d{4})(\d{2})$/.exec(s) ?? /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/** 원본 PresaleTimeline.tsx isMoveInPast(+ scorePrice.ts currentMonthIndexKst) @param {unknown} moveIn @param {unknown} completion @param {Date} now */
export function isMoveInPastNode(moveIn, completion, now) {
  const idx = parseCompletionMonthNode(moveIn) ?? parseCompletionMonthNode(completion);
  if (idx == null) return false;
  const kst = new Date(now.getTime() + KST_OFFSET_MIN * 60000);
  return idx < kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/** 원본 PresaleTimeline.tsx fmtRate @param {number} v @returns {string} */
export function fmtRateNode(v) {
  return v >= 10 ? Math.round(v).toLocaleString("ko-KR") : String(Math.round(v * 100) / 100);
}

/** 청약 경쟁률 줄 — 원본 PresaleTimeline.tsx 경쟁률 칸(`{rate} : 1` + 신청·모집 줄) @param {Record<string, any>} apt @returns {string | null} */
export function competitionLineNode(apt) {
  const r = apt.competitionRate;
  if (!(r != null && r > 0)) return null;
  const supply = apt.competitionSupply != null && apt.competitionSupply > 0 ? apt.competitionSupply : null;
  const applicants =
    apt.competitionApplicants != null && apt.competitionApplicants > 0 ? apt.competitionApplicants : null;
  const tail =
    supply != null && applicants != null
      ? ` (${Number(applicants).toLocaleString("ko-KR")}명 신청 / ${Number(supply).toLocaleString("ko-KR")}세대 모집)`
      : "";
  return `청약 경쟁률: ${fmtRateNode(Number(r))} : 1${tail}`;
}

/** 추가 모집 줄 — 원본 UnsoldEventCard.tsx(ah- 만 · 횟수 없으면 뺌 · 「마지막 YYYY.MM」) @param {Record<string, any>} apt @returns {string | null} */
export function unsoldEventLineNode(apt) {
  if (!String(apt.id ?? "").startsWith("ah-")) return null;
  const count = Number(apt.unsoldEventCount ?? 0);
  if (!((count ?? 0) > 0)) return null;
  const last = apt.lastUnsoldEventAt;
  let tail = "";
  if (last != null) {
    const d = new Date(last);
    if (!Number.isNaN(d.getTime())) tail = ` · 마지막 ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return `추가 모집 ${count}회${tail}`;
}

/** 분양 칸에서 빼는 값(빈칸 글자) */
const PRESALE_EMPTY = new Set(["-", "—", "0동", "미정"]);

/**
 * 분양 정보 절 — 원본 PresaleInfo.tsx 본문(분양 단계 있을 때만): 단계 배지·유형 → 분양가 범위·평당가 → 정보 칸 → 일정.
 * 칸을 ` · ` 로 3개씩 한 줄(첫 칸 = `{단계} · {유형}`). 전화번호·특징 글·수집 날짜·청약홈 공식 일정(실행 중 조회)은 싣지 않는다.
 * @param {Record<string, any>} apt @param {{ hasMoveIn: boolean, now: Date }} o hasMoveIn = 기본 정보에 입주 줄이 있음
 * @returns {string[]}
 */
export function presaleLinesNode(apt, o) {
  if (!apt.presaleStage) return [];
  const hideStageBadge =
    apt.presaleStage === "임대모집" ||
    (apt.presaleStage === "입주예정" && isMoveInPastNode(apt.presaleMoveIn, apt.completion, o.now));
  const first = [hideStageBadge ? null : String(apt.presaleStage), apt.presaleType ? String(apt.presaleType) : null]
    .filter(Boolean)
    .join(" · ");
  /** @type {Array<[string, string]>} */
  const kv = [];
  if (apt.presaleMinPrice != null || apt.presaleMaxPrice != null) {
    kv.push(["분양가 범위", fmtPriceRangeNode(apt.presaleMinPrice, apt.presaleMaxPrice)]);
    if (apt.presalePp != null) kv.push(["평당가", fmtPriceNode(apt.presalePp)]);
  }
  const generalSupply = Number(apt.presaleGeneralSupply ?? NaN);
  const buildings = Number(apt.presaleBuildings ?? NaN);
  const parking = Number(apt.presaleParking ?? NaN);
  if (Number.isFinite(generalSupply)) kv.push(["일반분양", `${generalSupply.toLocaleString("ko-KR")}세대`]);
  if (Number.isFinite(buildings)) kv.push(["동수", `${buildings}동`]);
  if (Number.isFinite(parking) && parking > 0) kv.push(["주차대수", `${parking.toLocaleString("ko-KR")}대`]);
  if (apt.presaleHousingType) kv.push(["주택유형", String(apt.presaleHousingType)]);
  if (apt.presaleMoveIn && !o.hasMoveIn) kv.push(["입주시기", String(apt.presaleMoveIn)]);
  if (apt.presaleRecruitDate) kv.push(["분양시기", fmtRecruitDateNode(apt.presaleRecruitDate)]);
  const cells = [
    ...(first ? [first] : []),
    ...kv.filter(([, v]) => !PRESALE_EMPTY.has(v)).map(([l, v]) => `${l} ${v}`),
  ];
  /** @type {string[]} */
  const lines = [];
  for (let i = 0; i < cells.length; i += 3) lines.push(cells.slice(i, i + 3).join(" · "));
  if (apt.presaleSchedule) {
    const sch = fmtPresaleScheduleNode(apt.presaleSchedule);
    if (!PRESALE_EMPTY.has(sch)) lines.push(`일정: ${sch}`);
  }
  return lines;
}

// ── 종합 탭 건물 정보 사본 (원본: detail/BuildingInfoCard.tsx + fieldMeta.ts 각 칸 fmt·label) ────────────────────

/** @param {unknown} v @param {string} unit 원본 fieldMeta.ts nPos */
const nPos = (v, unit) => (v != null && Number(v) > 0 ? `${v}${unit}` : "미수집");
/** @param {unknown} v 원본 fieldMeta.ts `v || "미수집"` */
const orMissing = (v) => (v ? String(v) : "미수집");

/** 카드 순서·이름·표기 — 원본 BuildingInfoCard.tsx FIELDS + FIELD_META label/fmt(layout 은 카드 전용 fmtLayout) */
export const BUILDING_FIELDS = /** @type {const} */ ([
  ["maxFloor", "최고층", (/** @type {unknown} */ v) => nPos(v, "층")],
  ["corridorType", "복도유형", orMissing],
  ["heatFuel", "난방연료", orMissing],
  ["primaryDirection", "대표 향", orMissing],
  ["floorAreaRatio", "용적률", (/** @type {unknown} */ v) => nPos(v, "%")],
  ["buildingCoverageRatio", "건폐율", (/** @type {unknown} */ v) => nPos(v, "%")],
  ["layout", "평면구조", orMissing],
]);

/** 건물 정보 한 줄 — 7칸 `{이름} {값}` 을 ` · ` 로, 「미수집」 칸 뺌 @param {Record<string, any>} apt @returns {string | null} */
export function buildingLineNode(apt) {
  if (!BUILDING_FIELDS.some(([f]) => apt[f] != null)) return null;
  const parts = BUILDING_FIELDS.map(([f, label, fmt]) => [label, fmt(apt[f])]).filter(([, v]) => v !== "미수집");
  return parts.length ? parts.map(([l, v]) => `${l} ${v}`).join(" · ") : null;
}

// ── 조립 ────────────────────

/**
 * 기본 정보 줄 — 상세 창 머리글(주소·도로명·분양가·공고명) + 종합 탭 칸 + 분양 탭 경쟁률·추가 모집.
 * @param {Record<string, any>} a 목록 행 ∪ 꾸러미 행 @returns {string[]}
 */
export function basicLinesNode(a) {
  /** @type {string[]} */
  const out = [];
  if (a.address) {
    const addr = `${fmtAddressNode(String(a.address))}${a.district ? ` (${String(a.district)})` : ""}`;
    if (addr.trim()) out.push(`주소: ${addr}`);
  } else {
    const where = [a.region, a.gu, a.dong].filter(Boolean).join(" ");
    if (where) out.push(`위치: ${where}`);
  }
  if (a.roadAddress) out.push(`도로명: ${String(a.roadAddress)}`);
  const price = fmtPriceNode(a.price);
  if (price !== "-") out.push(`분양가: ${price}${hasKnownAreaNode(a.area) ? ` (전용 ${a.area}㎡)` : ""}`);
  const units = hubUnitsText(a.units, a.unsold);
  const unsold = unsoldFieldText(a.unsold);
  const uu = [units !== "정보 없음" ? `총 ${units}` : null, unsold !== "—" ? `미분양 ${unsold}` : null].filter(Boolean);
  if (uu.length) out.push(uu.join(" · "));
  const moveIn = fmtMoveInNode(a.completion, a.presaleMoveIn);
  if (moveIn !== "-") out.push(`입주: ${moveIn}`);
  if (a.builder) out.push(`시공사: ${String(a.builder)}`);
  if (a.noticeName && a.noticeName !== a.name) out.push(`공고명: ${String(a.noticeName)}`);
  const comp = competitionLineNode(a);
  if (comp) out.push(comp);
  const ue = unsoldEventLineNode(a);
  if (ue) out.push(ue);
  return out;
}

/**
 * @typedef {{ text: string, h3?: boolean }} BodyLine
 * @typedef {{ title: string, lines: BodyLine[] }} BodySection
 */

/**
 * 단지 장 본문 절 전부(결정 47 순서 · 빈 절 제외).
 * @param {Record<string, any>} a 목록 행 ∪ 꾸러미 행(앱 상세 창 병합과 같은 방향 — 꾸러미 칸이 덮음)
 * @param {{ now?: Date, tzOffsetMin?: number }} [opts] now = 입주 시기 지남 판정 시각 · tzOffsetMin = 수집 날짜 시간대(기본 KST)
 * @returns {BodySection[]}
 */
export function buildAptSections(a, opts = {}) {
  const now = opts.now ?? new Date();
  /** @type {BodySection[]} */
  const out = [];
  /** @param {string} title @param {Array<string | BodyLine | null | undefined>} lines */
  const add = (title, lines) => {
    /** @type {BodyLine[]} */
    const ls = [];
    for (const l of lines) {
      if (l == null) continue;
      if (typeof l === "string") {
        if (l) ls.push({ text: l });
      } else if (l.text) ls.push(l);
    }
    if (ls.some((l) => !l.h3)) out.push({ title, lines: ls });
  };

  const basic = basicLinesNode(a);
  add(SECTION_TITLES[0], basic);

  // 실거래 비교 — 시세 탭 비교 상자(「비교할 실거래가 아직 없어요」면 상자 줄 통째로 뺌) · 평형 표 · 네이버 줄
  /** @type {Array<string | BodyLine>} */
  const trade = [];
  const head = scopeHeadTextNode(a);
  if (effectiveScopeNode(a) !== "none") {
    if (head) trade.push(head);
    for (const r of compareRowsNode(a, a.catsCache?.price ?? null)) {
      if (r.label === "분양가") continue; // 기본 정보 분양가와 같은 값
      trade.push(`${r.label} ${r.value}${r.sub ? ` (${r.sub})` : ""}`);
    }
    const df = dongFactPartsNode(a);
    if (df) trade.push([df.count, df.price, df.year].filter(Boolean).join(" · "));
  }
  const ar = areaTableRowsNode(a);
  if (ar.length > 0) {
    const h = areaTableHeadNode(a);
    const hasJeonse = ar.some((r) => r.jeonse != null);
    trade.push({ text: `${h.title}${h.period ? ` (${h.period})` : ""}`, h3: true });
    for (const r of ar) {
      const sale = r.sale ? `${h.saleLabel} ${fmtPriceRangeEok1Node(r.sale.min, r.sale.max)} ${r.sale.n}건` : null;
      const jeonse =
        hasJeonse && r.jeonse ? `전세 ${fmtPriceRangeEok1Node(r.jeonse.min, r.jeonse.max)} ${r.jeonse.n}건` : null;
      trade.push([`${r.isBase ? "★ " : ""}${r.key}㎡대`, sale, jeonse].filter(Boolean).join(" · "));
    }
  }
  const naver = naverListingTextNode(a, opts.tzOffsetMin);
  if (naver) trade.push(`네이버 매물 현황: ${naver}`);
  add(SECTION_TITLES[1], trade);

  const tf = transportFactsNode(a);
  add(SECTION_TITLES[2], [
    tf ? `교통: ${tf}` : null,
    busStopsTextNode(a),
    ...distanceGroupLinesNode(a),
    envLineNode(a),
  ]);
  add(SECTION_TITLES[3], schoolLinesNode(a));
  add(SECTION_TITLES[4], presaleLinesNode(a, { hasMoveIn: basic.some((l) => l.startsWith("입주: ")), now }));
  add(SECTION_TITLES[5], [buildingLineNode(a)]);
  return out;
}
