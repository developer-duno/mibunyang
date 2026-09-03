// @vitest-environment node
// ↑ 소스 파일을 디스크에서 읽어 검사한다. jsdom 에서는 import.meta.url 이 http 스킴이라 못 읽는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 카드가 첫 화면에서 지고 있는 짐을 지키는 가드.
 *
 * **사고 기록(세션 487)** — `DeviationRow` 가 aria 문구를 예쁘게 만들려고
 * `FIELD_META` 를 import 했더니, 149엔트리짜리 그 사전이 lazy `DetailModal` 청크에서
 * **초기 번들로 통째 끌려왔다**. 초기 gzip 67.56 → 75.02 KB (+7.46). 스크린리더 문구
 * 하나 때문에 모든 방문자가 그 비용을 치르는 셈이라, 단위만 `deviationFields.ts` 에
 * 적어 두고 자체 포맷으로 바꿔 +2.81 KB 로 낮췄다.
 *
 * 이 테스트가 없으면 다음에 누가 "라벨 쓰기 편하니까" 하고 다시 넣어도 아무도 모른다.
 */
const HEAVY_LAZY_MODULES = [
  { name: "fieldMeta", why: "149엔트리 필드 사전. lazy DetailModal 청크 소속" },
  { name: "dataSections", why: "fieldMeta 를 다시 끌고 온다" },
  { name: "exportPdf", why: "html2canvas + jsPDF 600KB" },
];

const CARD_MODULES = ["DeviationRow.tsx", "DeviationStrip.tsx"];

describe("편차 스트립은 초기 번들을 무겁게 하지 않는다", () => {
  for (const file of CARD_MODULES) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    for (const mod of HEAVY_LAZY_MODULES) {
      it(`${file} 은 ${mod.name} 을 import 하지 않는다 — ${mod.why}`, () => {
        expect(src).not.toMatch(new RegExp(`from\\s+["'][^"']*${mod.name}["']`));
      });
    }
  }

  // ⚠️ 옛 단언은 `toContain("formatDeviationValue")` 였다 — 그 이름이 소스 **어디에든**(import 줄·주석·
  //    문자열) 있기만 하면 통과해서, 실제로 값 포맷에 그 함수를 **부르는지**는 안 봤다(세션539 C-2).
  //    import 만 남기고 호출을 지워도 초록불이었다. 호출 문맥(`formatDeviationValue(spec,`)까지 고정한다.
  //    ⚠️ 좌변을 안 고정하면 import 줄에도 매칭되므로 여는 괄호와 첫 인자까지 함께 본다.
  it("aria 문구용 값 포맷은 deviationFields 의 자체 함수를 **호출**한다", () => {
    const src = readFileSync(new URL("./DeviationRow.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/formatDeviationValue\(\s*spec\s*,/);
  });
});
