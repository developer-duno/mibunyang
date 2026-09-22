// @vitest-environment node
// ↑ 이 파일은 DOM 이 아니라 **디스크의 소스 파일**을 읽어 대조한다. jsdom 환경에서는
//   `import.meta.url` 이 http:// 스킴이라 readFileSync 가 못 읽는다(세션562 실측).
//
// 지도 핀의 좌표 의심 표시가 **실제로 배선돼 있는지** 소스로 확인하는 가드 (세션562).
//
// 왜 SVG 단위 테스트로 부족한가: `markerSvg.test.ts` 는 "coordShared=true 면 점선이 나온다"만
// 증명한다. 그런데 호출부가 **캐시 키(`imgKey`)에 coordShared 를 안 넣으면**, 같은 점수·가격인
// 단지끼리 MarkerImage 를 공유해 **좌표가 멀쩡한 단지에 점선이 붙는다**(경고가 거짓이 된다).
// 그 배선은 렌더 없이는 SVG 로 관찰되지 않으므로 소스를 읽어 확인한다.
//
// ⚠️ 주석을 먼저 걷어내고 검사한다 — 주석 안의 설명 문구에 매칭돼 **껍데기 가드**가 되는 사고가
//    이 저장소에서 반복됐다(세션491 소스 grep 가드 3건).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./KakaoMapView.tsx", import.meta.url), "utf8");

/** 블록·줄 주석을 제거한 코드 본문 (문자열 리터럴 안의 `//` 는 이 파일에 없다 — 있으면 가드를 다시 본다) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("지도 핀 좌표 의심 표시 — 배선 가드", () => {
  it("마커 캐시 키(imgKey)에 coordShared 가 들어간다", () => {
    // 이게 빠지면 같은 점수·가격 단지끼리 캐시를 공유해 엉뚱한 단지에 점선이 붙는다.
    const m = CODE.match(/const\s+imgKey\s*=\s*`([^`]*)`/);
    expect(m, "imgKey 선언을 못 찾았다 — 변수명이 바뀌었으면 이 가드를 함께 고칠 것").toBeTruthy();
    expect(m![1]).toContain("coordShared");
  });

  it("buildMarkerSvg 호출 2곳(일반·강조)이 모두 coordShared 를 넘긴다", () => {
    // ⚠️ `[^)]*` 로 인자를 자르면 **중첩 괄호**(`gr(res.total)`)의 첫 `)` 에서 끊겨
    //    엉뚱한 조각을 검사하는 껍데기 가드가 된다(세션562에 실제로 겪었다).
    //    그래서 괄호 깊이를 세어 호출 전체를 잘라낸다.
    const calls: string[] = [];
    for (let i = CODE.indexOf("buildMarkerSvg("); i !== -1; i = CODE.indexOf("buildMarkerSvg(", i + 1)) {
      let depth = 0;
      for (let j = i + "buildMarkerSvg".length; j < CODE.length; j++) {
        if (CODE[j] === "(") depth++;
        else if (CODE[j] === ")" && --depth === 0) {
          calls.push(CODE.slice(i, j + 1));
          break;
        }
      }
    }
    expect(calls.length, "buildMarkerSvg 호출이 2곳(일반·강조)이어야 한다").toBeGreaterThanOrEqual(2);
    const missing = calls.filter((c) => !/coordShared/.test(c));
    expect(missing, `coordShared 를 안 넘기는 호출: ${missing.join(" | ")}`).toEqual([]);
  });

  it("점선 안내가 점 보기에서만·해당 핀이 있을 때만 뜬다", () => {
    // 늘 띄우면 1.6%(40곳) 때문에 나머지 손님 화면이 지저분해진다.
    expect(CODE).toMatch(/mode\s*!==\s*"choropleth"/);
    expect(CODE).toMatch(/filtered\.some\(\([^)]*\)\s*=>\s*[^)]*coordShared\s*===\s*true\)/);
  });
});
