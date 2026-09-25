/**
 * 단지 면적(㎡)을 "안다"고 볼 수 있는가 — 상세 화면(시세 표·대출 표·헤더)이 함께 쓰는 판정 한 곳.
 * null·undefined·0·음수·숫자가 아닌 값은 "면적 없음"이다. 점수 엔진의 `_noArea`
 * (`src/scoring/engine.ts`)와 같은 판정이다 — 두 곳이 갈리면 화면과 점수가 서로 다른 단지를 본다.
 * ⚠️ 옛 화면 코드는 `Number(apt.area ?? 0)` 로 없는 면적을 0㎡ 로 바꿔
 *    "0㎡ 기준 ±20㎡" 로 표를 걸러 행을 지웠다(세션576 D2 — 정적 JSON 1,912곳 중 161곳).
 */
export function hasKnownArea(area: unknown): boolean {
  return area != null && Number(area) > 0;
}
