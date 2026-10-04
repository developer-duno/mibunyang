import { isSentinel } from "@/constants/sentinels";
import { fmtDist } from "@/components/charts/DistanceDots";
import type { Apt } from "@/types/scoring";

/**
 * 교통 사실 글자 — 입지 탭 (세션591 "접힘 없이 한눈에" L3).
 *
 * 옛 "교통 상세" 접힘 카드(세션508 PR-3b B1)를 해체한 자리다. 6칸이 각자 갈 곳으로 갔다:
 * - 역 이름·노선(+역까지 거리) · 버스 노선 수 → 입지 판정 한 줄에 병기(`transportFacts`,
 *   목업 "입지 우수 · 평촌역(4호선) 1.3km · 버스 12개 노선")
 * - 버스 정류장 이름 → "학군 · 버스" 칩(`busStopsText`, `detail/SchoolInfo`)
 * - IC·KTX 거리 → 거리 점 그림의 "고속도로·KTX" 줄(`charts/DistanceDots`)
 *
 * 이 글자는 **점수 판정이 아니라 원자료 사실**이라 비로그인에도 보인다(판정 글자만 가린다).
 *
 * 좌표 자리표시 의심(사장님 결정, 세션568-3) — 역·정류장은 전부 이 단지 좌표로 찾은 값이라,
 * 좌표가 다른 단지와 공유되면 이 단지 것이 아니다. **경고문이 아니라 틀린 값을 안 보여주는 것**
 * (.claude/rules/our-defect-is-not-customer-warning.md) — 두 함수 모두 null 을 돌려주고, 거리 그림이
 * 같은 자리에 "위치 확인 중" 사실 한 줄을 그린다.
 */

/** "평촌역(4호선) 1.3km · 버스 12개 노선" — 적을 게 없으면 null */
export function transportFacts(apt: Apt): string | null {
  if (apt.coordShared === true) return null;
  const parts: string[] = [];
  const name = typeof apt.subwayName === "string" ? apt.subwayName.trim() : "";
  if (name) {
    const lines = typeof apt.subwayLines === "string" && apt.subwayLines.trim() ? `(${apt.subwayLines.trim()})` : "";
    const d = Number(apt.subwayDist);
    // 9999(10km 안에 없음)는 역 이름과 함께 적을 거리가 아니다
    const dist =
      apt.subwayDist != null && Number.isFinite(d) && d >= 0 && !isSentinel("subwayDist", d) ? ` ${fmtDist(d)}` : "";
    parts.push(`${name}${lines}${dist}`);
  }
  const bus = Number(apt.busRoutes);
  if (apt.busRoutes != null && Number.isFinite(bus) && bus > 0) parts.push(`버스 ${Math.round(bus)}개 노선`);
  return parts.length ? parts.join(" · ") : null;
}

/** 칩에 적는 정류장 이름 수 — 넘치면 "외 N" */
const BUS_STOP_SHOWN = 3;

/** "버스 정류장 한신아파트 · 농수산물시장 · 평촌IC(미정차) 외 9" — 없으면 null */
export function busStopsText(apt: Apt): string | null {
  if (apt.coordShared === true) return null;
  const names = String(apt.busStopNames ?? "")
    .split(",")
    .map((s) => s.trim())
    // 버스가 서지 않는 정류장은 이름·"외 N" 개수 둘 다에서 뺀다(세션591 보완 F7). 실측(10/02 사본 1,822곳 ·
    // 이름 17,848개): "미정차" 든 이름 262개 — "…(미정차)" 끝 258 · 괄호가 가운데 2 · 괄호 없이 가운데 2.
    .filter((s) => Boolean(s) && !s.includes("미정차"));
  if (!names.length) return null;
  const rest = names.length - BUS_STOP_SHOWN;
  return `버스 정류장 ${names.slice(0, BUS_STOP_SHOWN).join(" · ")}${rest > 0 ? ` 외 ${rest}` : ""}`;
}
