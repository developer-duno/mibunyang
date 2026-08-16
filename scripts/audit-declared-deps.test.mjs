// @ts-check
import { describe, it, expect } from "vitest";
import { extractBareImports, findUndeclared } from "./audit-declared-deps.mjs";

describe("extractBareImports — 외부 패키지만 뽑는다", () => {
  it("정적 import 의 패키지 이름을 잡는다", () => {
    expect([...extractBareImports(`import yaml from "js-yaml";`)]).toEqual(["js-yaml"]);
  });

  it("export ... from 도 잡는다", () => {
    expect([...extractBareImports(`export { parse } from "csv-parse/sync";`)]).toEqual([
      "csv-parse",
    ]);
  });

  it("side-effect import 를 잡는다", () => {
    expect([...extractBareImports(`import "dotenv/config";`)]).toEqual(["dotenv"]);
  });

  it("동적 import 를 잡는다", () => {
    expect([...extractBareImports(`const m = await import("unzipper");`)]).toEqual(["unzipper"]);
  });

  it("CJS require 를 잡는다", () => {
    expect([...extractBareImports(`const y = require("js-yaml");`)]).toEqual(["js-yaml"]);
  });

  it("scoped 패키지는 두 조각까지가 이름", () => {
    expect([...extractBareImports(`import { createClient } from "@supabase/supabase-js";`)]).toEqual(
      ["@supabase/supabase-js"],
    );
  });

  it("서브경로가 붙어도 패키지 이름만 남긴다", () => {
    expect([...extractBareImports(`import x from "js-yaml/dist/js-yaml.mjs";`)]).toEqual([
      "js-yaml",
    ]);
  });

  // ⚠️ 이 저장소의 실제 결함 자리 — 첫 구현이 `from\s*\(?` 로 괄호를 허용해
  // Supabase 쿼리의 테이블 이름 26종을 "미선언 패키지"로 오검출했다(세션518).
  it("Supabase 쿼리 .from(\"테이블\") 은 import 가 아니다", () => {
    const src = `
      const { data } = await sb.from("apartments").select("id");
      await sb.from('regions').update({ x: 1 });
      const q = supabase .from("trades");
    `;
    expect([...extractBareImports(src)]).toEqual([]);
  });

  it("같은 파일에 쿼리와 import 가 섞여 있어도 import 만 뽑는다", () => {
    const src = `
      import yaml from "js-yaml";
      const { data } = await sb.from("apartments").select("*");
    `;
    expect([...extractBareImports(src)]).toEqual(["js-yaml"]);
  });

  it("Node 내장은 접두사가 있든 없든 제외한다", () => {
    const src = `import fs from "node:fs";\nimport path from "path";\nimport { readFile } from "node:fs/promises";`;
    expect([...extractBareImports(src)]).toEqual([]);
  });

  it("@/ 별칭과 상대·절대 경로는 제외한다", () => {
    const src = `import { calcCats } from "@/scoring/engine";\nimport { x } from "./_shared.mjs";\nimport y from "/abs/mod.mjs";`;
    expect([...extractBareImports(src)]).toEqual([]);
  });

  // ⚠️ 소스를 grep 하는 가드의 단골 취약점 — 주석 처리된 줄이 "실제로 쓴다"는 증거가
  // 되면 안 된다([[guards-must-be-mutation-tested]] §소스 grep 가드).
  it("주석 안의 import 는 잡지 않는다", () => {
    const src = `
      // import ghost from "ghost-pkg";
      /* import other from "other-pkg"; */
      import real from "js-yaml";
    `;
    expect([...extractBareImports(src)]).toEqual(["js-yaml"]);
  });

  it("중복은 한 번만 센다", () => {
    const src = `import a from "js-yaml";\nimport b from "js-yaml";`;
    expect([...extractBareImports(src)]).toEqual(["js-yaml"]);
  });
});

describe("findUndeclared", () => {
  it("선언되지 않은 것만 정렬해 돌려준다", () => {
    expect(findUndeclared(["js-yaml", "vitest", "unzipper"], ["vitest"])).toEqual([
      "js-yaml",
      "unzipper",
    ]);
  });

  it("전부 선언돼 있으면 빈 배열", () => {
    expect(findUndeclared(["vitest"], new Set(["vitest", "js-yaml"]))).toEqual([]);
  });

  it("Set 과 배열을 모두 받는다", () => {
    expect(findUndeclared(new Set(["a"]), new Set(["b"]))).toEqual(["a"]);
  });
});
