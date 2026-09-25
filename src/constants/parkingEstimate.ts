// 주차 비율 추정 산식 — **한 곳**에 둔다(세션576 D5).
//
// 점수 탭(`src/scoring/scoreProduct.ts` 주차 항목)과 종합 탭(`fieldMeta.ts` parkingRatio)이 같은
// 숫자를 보여 주려면 산식이 한 곳에 있어야 한다. constants 층에 두는 이유: fieldMeta(constants)가
// 부르고 scoring 이 부른다 — constants → scoring 방향 import 는 금지(순환)라 여기가 아래층이다.
//
// 산식 = 주차대수 / max(총세대, 일반분양, 1).
//   - 분모는 총세대와 일반분양 중 **큰 쪽**(세션513) — 일반분양은 총세대의 부분집합일 수 있어
//     작은 분모와 짝지으면 비율이 부풀려진다.
//   - 결과는 `0 < r <= 3` 일 때만 쓴다. 0 은 원천 미기재(주차 0면 아파트는 없다), 3 초과는 총세대
//     기록이 오염된 자리로 본다(예: 주차 1,468면인데 총세대 5 → 293.6). 상세 근거는 scoreProduct.ts 주석.
//   - 추정할 수 없으면 null.
export function estimateParkingRatio(
  presaleParking: number | null | undefined,
  units: number | null | undefined,
  presaleGeneralSupply: number | null | undefined
): number | null {
  if (presaleParking == null) return null;
  const denom = Math.max(units ?? 0, presaleGeneralSupply ?? 0, 1);
  const r = presaleParking / denom;
  return r > 0 && r <= 3 ? r : null;
}
