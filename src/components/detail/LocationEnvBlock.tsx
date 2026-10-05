import { memo, type CSSProperties, type ReactNode } from "react";
import { C, F } from "@/theme";
import { NOISE_TIERS, airAnnualBand } from "@/constants/scoringTiers";
import { PositionGauge, positionPct } from "@/components/charts/PositionGauge";
import type { Apt } from "@/types/scoring";

/**
 * 치안·환경 — 입지 탭 (세션591 "접힘 없이 한눈에" L5).
 *
 * 옛 "치안/환경" 접힘 표(`LOCATION_SECTIONS` 6칸 + 채움 도넛)를 해체한 자리 — 펼치지 않아도 보이게
 * 칩 + 소음 게이지로 올렸다(목업). 6칸이 전부 여기 있다:
 * - 치안 등급 · 대기 3년 평균(등급 + PM2.5) · 조망 · 혐오시설(이름 + 거리) → 칩
 * - 소음 → 눈금 게이지(`charts/PositionGauge` — 경계는 `NOISE_TIERS` 에서 읽는다)
 * - 오늘 대기질 → 작은 글씨 한 줄로 **따로**. 3년 평균(채점 기준)과 오늘(실시간 통합지수)은 다른 값이라
 *   한 줄에 섞지 않는다(세션560 E15/S7 · `fieldMeta.ts` airQuality 주석).
 *
 * 전부 원자료라 비로그인에도 보인다. **점수 낱말은 쓰지 않는다** — 목업의 "감점 대상 아님" 같은 말은
 * 점수 정보라 비로그인 가림 정책과 부딪힌다. 값의 사실(이름·거리·등급)만 적는다.
 *
 * 좌표 공유 단지(세션568-3 · L7 · 세션591 보완 F1·F6) — 혐오시설 이름·거리는 이 단지 좌표 반경으로 찾은 값이고,
 * 대기질은 측정소를 이 단지 좌표로 고른 값이라(scoreLocation 도 좌표 공유면 대기 등급 글자를 안 낸다) 둘 다 이 단지
 * 것이 아니다. 두 칩을 "위치 확인 중" 사실로 바꾸고(혐오시설 칩은 목록 유무와 상관없이 늘), 오늘 대기질 줄은 숨긴다.
 * 치안 등급·조망·소음은 그대로.
 */

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: F.sm,
  color: C.text,
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 99,
  padding: "3px 10px",
  lineHeight: 1.4,
};

/** 칩에 적는 혐오시설 이름 수 — 넘치면 "외 N" */
const NOXIOUS_SHOWN = 3;

/** 치안 등급(1=가장 안전 ~ 5) → 안전 정도를 점 5개로("●●○○○" = 4등급). 1~5 정수가 아니면 null */
export function crimeDots(grade: unknown): string | null {
  const g = Number(grade);
  if (grade == null || !Number.isInteger(g) || g < 1 || g > 5) return null;
  return "●".repeat(6 - g) + "○".repeat(g - 1);
}

type AirQuality = { grade?: unknown; annual?: { pm25?: unknown } | null } | null | undefined;

/** 3년 평균 PM2.5 칩 글자 — "대기 3년 평균 나쁨 · PM2.5 19.6". 값이 없으면 null */
export function airAnnualText(v: AirQuality): string | null {
  const pm = Number(v?.annual?.pm25);
  if (v?.annual?.pm25 == null || !Number.isFinite(pm)) return null;
  return `대기 3년 평균 ${airAnnualBand(pm)} · PM2.5 ${Math.round(pm * 10) / 10}`;
}

/** 오늘 대기질 글자 — "오늘 대기질 좋음". 3년 평균과 다른 값이라 따로 적는다 */
export function airTodayText(v: AirQuality): string | null {
  return typeof v?.grade === "string" && v.grade.trim() ? `오늘 대기질 ${v.grade.trim()}` : null;
}

/**
 * 소음 게이지 눈금 — `NOISE_TIERS` 경계에서 읽는다(숫자를 다시 적지 않는다).
 * 오른쪽 끝 = 가장 조용한 칸 경계(40dB) · 왼쪽 끝 = 가장 시끄러운 칸 경계(70dB) · 가운데 선 = 둘째 칸 경계(50dB).
 */
export function noiseScale() {
  const quiet = NOISE_TIERS[0].max ?? 0;
  const loud = NOISE_TIERS[NOISE_TIERS.length - 1].max ?? quiet;
  const center = NOISE_TIERS[Math.min(1, NOISE_TIERS.length - 1)].max ?? quiet;
  return { quiet, loud, center };
}

/** 소음 값이 든 `NOISE_TIERS` 칸 번호 — 마지막 경계(70dB)보다 시끄러우면 마지막 칸으로 본다 */
function noiseTierIndex(db: number): number {
  const i = NOISE_TIERS.findIndex((t) => db <= (t.max ?? Infinity));
  return i === -1 ? NOISE_TIERS.length - 1 : i;
}

/** 칸 번호 순서의 색 — 첫 칸 초록 · 둘째 파랑 · 셋째 주황 (마지막 칸은 칸 수와 무관하게 아래에서 빨강) */
const NOISE_TIER_COLORS = [C.green, C.blue, C.amber];

/**
 * 소음 칸 색 — 제목 글자(`noiseLabel`)와 **같은 칸**에서 읽는다(세션595 사장님 결정 D1).
 * 옛 판은 색을 칸 순서로만 정해(첫 칸 초록·마지막 빨강·사이 주황) 50dB '우수' 가 주황으로 보였다.
 */
export function noiseColor(db: number): string {
  const i = noiseTierIndex(db);
  if (i === NOISE_TIERS.length - 1) return C.red;
  return NOISE_TIER_COLORS[Math.min(i, NOISE_TIER_COLORS.length - 1)];
}

/** 소음 칸 글자 — `NOISE_TIERS` 의 label(최고·우수·양호·보통). 경계 밖은 마지막 칸 글자 */
export function noiseLabel(db: number): string {
  return NOISE_TIERS[noiseTierIndex(db)].label ?? "";
}

export const LocationEnvBlock = memo(function LocationEnvBlock({ apt }: { apt: Apt }) {
  const coordUnknown = apt.coordShared === true;
  const air = apt.airQuality as AirQuality;

  const chips: { key: string; node: ReactNode }[] = [];
  const crime = crimeDots(apt.crimeSafetyGrade);
  if (crime) {
    chips.push({
      key: "crime",
      node: (
        <>
          치안 {apt.crimeSafetyGrade}등급{" "}
          <span aria-hidden style={{ letterSpacing: 1, color: C.muted }}>
            {crime}
          </span>
        </>
      ),
    });
  }
  // 대기질 — 측정소를 이 단지 **좌표**로 고르므로(scoreLocation 의 세션568 결정: 좌표 공유면 대기 등급 글자를
  // 안 낸다) 좌표 공유 단지는 3년 평균 칩을 "위치 확인 중" 사실로 바꾸고 오늘 대기질 줄은 숨긴다(세션591 보완 F1).
  const airText = airAnnualText(air);
  const todayRaw = airTodayText(air);
  if (coordUnknown && (airText || todayRaw)) {
    chips.push({
      key: "air",
      node: (
        <>
          대기 <span data-state="coord-unknown">위치 확인 중</span>
        </>
      ),
    });
  } else if (airText) chips.push({ key: "air", node: airText });
  if (typeof apt.view === "string" && apt.view.trim()) chips.push({ key: "view", node: `조망 ${apt.view.trim()}` });

  const nox = Array.isArray(apt.noxious) ? (apt.noxious as unknown[]).filter((s) => typeof s === "string" && s) : [];
  if (coordUnknown) {
    // 좌표 공유면 시설 목록 유무와 상관없이 늘 그린다 — 목록이 있을 때만 그리면 "근처에 시설이 있다"는
    // 사실(이 단지 것이 아닌 값)이 칩의 있고 없음으로 샌다(세션591 보완 F6).
    chips.push({
      key: "noxious",
      node: (
        <>
          혐오시설 <span data-state="coord-unknown">위치 확인 중</span>
        </>
      ),
    });
  } else if (nox.length > 0) {
    const d = Number(apt.noxiousDist);
    const dist = apt.noxiousDist != null && Number.isFinite(d) && d > 0 ? ` ${Math.round(d)}m` : "";
    const rest = nox.length - NOXIOUS_SHOWN;
    chips.push({
      key: "noxious",
      node: `혐오시설 ${nox.slice(0, NOXIOUS_SHOWN).join("·")}${rest > 0 ? ` 외 ${rest}` : ""}${dist}`,
    });
  }

  const noise = apt.noise != null && Number.isFinite(Number(apt.noise)) ? Number(apt.noise) : null;
  const today = coordUnknown ? null : todayRaw;

  if (chips.length === 0 && noise == null && !today) return null;

  const sc = noiseScale();

  return (
    <div
      style={{
        background: C.bg,
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 10,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>치안 · 환경</div>
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => (
            <span key={c.key} style={chipStyle} data-chip={c.key}>
              {c.node}
            </span>
          ))}
        </div>
      )}
      {noise != null && (
        // 흰 바탕 — 게이지 눈금(slate100)이 이 칸의 회색 바탕(C.bg)과 거의 같은 색이라 바탕 위에선
        // 눈금이 안 보였다(캡처 실측). 부품(PositionGauge)은 시세 보관본과 바이트 동일로 두고 감싸는 쪽에서 맞춘다.
        <div
          style={{ marginTop: 10, background: C.card, borderRadius: 8, padding: "6px 10px" }}
          data-testid="noise-gauge"
          data-noise-db={noise}
        >
          {/* 값은 제목에 적고 게이지 가운데 글자는 비운다(세션591 보완 F4) — 가운데 글자가 가운데 눈금(50dB)
              바로 밑에 찍혀 "50dB 눈금 = 40dB" 처럼 읽혔고, 오른쪽 끝 "조용함 40dB" 와 숫자가 두 번 나왔다. */}
          <div style={{ fontSize: F.sm, fontWeight: 700, color: noiseColor(noise) }} data-testid="noise-title">
            소음 {noise}dB · {noiseLabel(noise)}
          </div>
          <PositionGauge
            pct={positionPct(noise, sc.center, sc.quiet, sc.loud)}
            color={noiseColor(noise)}
            leftLabel={`시끄러움 ${sc.loud}dB`}
            centerLabel=""
            rightLabel={`조용함 ${sc.quiet}dB`}
          />
        </div>
      )}
      {today && <div style={{ marginTop: 8, fontSize: F.xs, color: C.muted }}>{today}</div>}
    </div>
  );
});
