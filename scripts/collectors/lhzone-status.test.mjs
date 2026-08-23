// @vitest-environment node
// @ts-check
/**
 * lhzone-status.mjs 테스트 — CSV 파싱(인용 필드 안 콤마) · EUC-KR 디코딩 · 이름 정규화 ·
 * 엄격 2단계 매칭(정확 / 유일 포함 / 모호 스킵).
 *
 * ⚠️ 픽스처는 **진짜 EUC-KR 바이트**다. 2026-08-22 에 받은 전국 파일
 * (`BLS5_DSTRC_MASTER.csv`, 고시월 2026-06)의 헤더 + 6행을 바이트 그대로 base64 로 떠 왔다.
 * UTF-8 로 다시 만들면 "EUC-KR 로 읽어야 한다" 는 이 수집기의 핵심 가정이 검증되지 않는다.
 */
import { describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn(), log: vi.fn(), logError: vi.fn() };
});

const {
  parseCsvLine, parseStageCsv, decodeStageCsvBuffer,
  normalizeZoneName, buildStageIndex, matchZoneStage,
} = await import("./lhzone-status.mjs");

const SRC = readFileSync(fileURLToPath(new URL("./lhzone-status.mjs", import.meta.url)), "utf8");

// 실물 EUC-KR 바이트 (헤더 + 화성동탄 · 광교 · 양주고읍 · 양주광석 · 양주신도시 · 춘천퇴계1,2)
const EUCKR_FIXTURE_B64 = [
  "IsH2sbjB9sGkufjIoyIsIsH2sbi47SIsIrDtvcO75773wfaxuLjtIiwitNyw6MTateUiLCK03LDoxNq15bjtIiwitNyw6MH4x+DE2rXlIiwitN",
  "yw6MH4x+DE2rXluO0iLCK5/bfJxNq15TEiLCK5/bfJxNq15bjtMSIsIrn9t8nE2rXlMiIsIrn9t8nE2rXluO0yIiwisO29w7n4yKMiLCKw7b3D",
  "wM/A2iIsIr3CwM6x4rD8xNq15SIsIr3CwM6x4rD8xNq15bjtIiwitOO057HisPzE2rXlIiwitOO057HisPzE2rXluO0iLCK047TnseKw/LrOvK",
  "0iLCK047TnseKw/L+stvTDsyIsIrXut8/Az73DIiwivPbBpMDPvcMiDQoiNDE1OTBLTDIwMDEwMDEiLCLIrby6tb/FusH2sbggxcPB9rCzud+7",
  "5773IiwsIlJNIiwivce9w7qvsOYiLCJETVJNIiwsIkwwMSIsIsXDwfaws7nfw8vB+Ln9IiwsLCKxucXksbPF67rOILDtvcMgwaYyMDI1LTY2Ny",
  "IsIjIwMjUxMTI1IiwiMTYxMzAwMCIsIrG5xeSxs8Xrus4iLCJCNTUyNTU1Iiwix9GxucXkwfbB1sXDsPi75yIsIrW/xbq75773uru6ziIsIjAz",
  "MS0zNzktNjkzNiIsIjIwMDgtMDUtMzEgMDA6MDA6MDAuMCIsIjIwMjYtMDMtMTMgMTE6MDg6MDMuMCINCiI0MTExNU1YMjAwNDAwMSIsIrGksb",
  "PB9rG4IMXDwfaws7nfu+e+9yIsLCJDUCIsIsHYsPgiLCJQQ0NQIiwsIkwwMSIsIsXDwfaws7nfw8vB+Ln9IiwsLCKxucXksbPF67rOILD4sO0g",
  "waYyMDI1LTY4IiwiMjAyNTAxMzEiLCIxNjEzMDAwIiwisbnF5LGzxeu6ziIsIkI1NTIwMDMiLCKw5rHiwdbFw7W1vcOw+LvnIiwisOax4sHWxc",
  "O1tb3DsPi75yDFw8H2u+e+97TcIiwiMDMxLTIyMC03MjY3IiwiMjAwOC0wNS0zMSAwMDowMDowMC4wIiwiMjAyNi0wNC0xNyAxMDo0OToyMC4w",
  "Ig0KIjQxNjMwS0wyMDAxMDAxIiwivufB1rDtwL7B9rG4IMXDwfaws7nfu+e+9yIsIr7nwdaw7cC+wfaxuCDFw8H2sLO537vnvvciLCJDUCIsIs",
  "HYsPgiLCJQQ0NQIiwsIkwwMSIsIsXDwfaws7nfw8vB+Ln9IiwsLCKxucXksbPF67rOILDtvcMgwaYyMDIwLTkiLCIyMDIwMDEwOSIsIjY0MTAw",
  "MDAiLCKw5rHitbUiLCJEMTY5MDg4IiwivufB1rvnvve6u7rOIiwix9GxucXkwfbB1sXDsPi75yC+58HWu+e+97q7us4iLCIwMzEtODIwLTg3NT",
  "EiLCIyMDA4LTA1LTMxIDAwOjAwOjAwLjAiLCIyMDIwLTA0LTI3IDE3OjE2OjM0LjAiDQoiNDE2MzBLTDIwMDQwMDEiLCK+58HWsaS8rsH2sbgg",
  "xcPB9rCzud+75773IiwivufB1rGkvK7B9rG4IMXDwfaws7nfu+e+9yIsIkRNIiwisLO537qvsOYiLCJETSIsLCJMMDEiLCLFw8H2sLO538PLwf",
  "i5/SIsLCwisOax4rW1ILDtvcMgwaYyMDIxLTE4NCIsIjIwMjEwOTMwIiwiNjQxMDAwMCIsIrDmseK1tSIsIkI1NTI1NTUiLCLH0bG5xeTB9sHW",
  "xcOw+LvnIiwix9GxucXkwfbB1sXDsPi75yC+58HWu+e+97q7us4gtNzB9rvnvvcxus4iLCIwMzEtODIwLTg3NTIiLCIyMDA4LTA1LTMxIDAwOj",
  "AwOjAwLjAiLCIyMDI1LTA2LTMwIDE1OjU3OjUyLjAiDQoiNDE2MzBLTDIwMDQwMDIiLCK+58HWvcW1tb3DKL/BwaQpxcPB9rCzud+75773Iiws",
  "IlJNIiwivce9w7qvsOYiLCJTTURNUk0iLCwiTDAxIiwixcPB9rCzud/Dy8H4uf0iLCwsIrG5xeSxs8Xrus4gsO29wyDBpjIwMjYtMzE5IiwiMj",
  "AyNjA2MzAiLCIxNjEzMDAwIiwisbnF5LGzxeu6ziIsIkI1NTI1NTUiLCLH0bG5xeTB9sHWxcOw+LvnIiwivufB1rvnvve6u7rOIiwiMDMxLTgy",
  "MC04NzUxIiwiMjAwOC0wNS0zMSAwMDowMDowMC4wIiwiMjAyNi0wNy0yOCAxNDoxMzozOS4wIg0KIjQyMTEwS0wxOTg3MDAxIiwiw+HDtcXwsO",
  "gxLDIiLCLD4cO1xfCw6DEsMiIsIkNQIiwiwdiw+CIsIkNQIiwsIkwwMSIsIsXDwfaws7nfw8vB+Ln9IiwsLCLBpjE5OTQtMTciLCIxOTk0MDEy",
  "MSIsIjE1MDAwMDAiLCKwx7yzsbPF67rOIiwsLCwsIjIwMDgtMDUtMzEgMDA6MDA6MDAuMCIsIjIwMDYtMDUtMDkgMDA6MDA6MDAuMCI=",
].join("");

const FIXTURE_BUFFER = Buffer.from(EUCKR_FIXTURE_B64, "base64");

// ── CSV 파싱 ────────────────────────────────────────────────────────
describe("parseCsvLine", () => {
  it("인용 필드 안의 콤마를 구분자로 보지 않는다 (실물 '춘천퇴계1,2')", () => {
    // 이 가드가 없으면 전국 1,372행 중 5행이 통째로 밀려 엉뚱한 컬럼을 단계로 읽는다.
    expect(parseCsvLine('"42110KL1987001","춘천퇴계1,2","춘천퇴계1,2","CP","준공"')).toEqual([
      "42110KL1987001", "춘천퇴계1,2", "춘천퇴계1,2", "CP", "준공",
    ]);
  });

  it("따옴표 없는 빈 필드(`,,`)를 빈 문자열로 돌려준다", () => {
    expect(parseCsvLine('"a",,"b"')).toEqual(["a", "", "b"]);
  });

  it("이스케이프된 따옴표(\"\")를 한 개로 되돌린다", () => {
    expect(parseCsvLine('"가""나","다"')).toEqual(['가"나', "다"]);
  });
});

describe("parseStageCsv", () => {
  it("헤더를 컬럼명으로 삼아 객체 배열을 만든다", () => {
    const rows = parseStageCsv('"지구명","단계코드명"\r\n"광교지구","준공"\r\n');
    expect(rows).toEqual([{ 지구명: "광교지구", 단계코드명: "준공" }]);
  });

  it("빈 줄은 건너뛴다 (첫 줄은 헤더)", () => {
    expect(parseStageCsv('"지구명"\n\n"가"\n\n"나"\n\n')).toEqual([{ 지구명: "가" }, { 지구명: "나" }]);
  });

  it("헤더뿐이거나 빈 입력이면 0행", () => {
    expect(parseStageCsv("")).toEqual([]);
    expect(parseStageCsv('"지구명"')).toEqual([]);
  });
});

// ── EUC-KR 디코딩 ───────────────────────────────────────────────────
describe("decodeStageCsvBuffer — 실물 EUC-KR 픽스처", () => {
  it("EUC-KR 로 읽으면 한글이 온전하다", () => {
    const rows = parseStageCsv(decodeStageCsvBuffer(FIXTURE_BUFFER));
    expect(rows).toHaveLength(6);
    expect(rows[0]["지구명"]).toBe("화성동탄지구 택지개발사업");
    expect(rows[0]["단계코드명"]).toBe("실시변경");
    expect(rows[1]["지구명"]).toBe("광교지구 택지개발사업");
    expect(rows[1]["단계코드명"]).toBe("준공");
    expect(rows[5]["지구명"]).toBe("춘천퇴계1,2"); // 인용 필드 안 콤마 + EUC-KR 동시 검증
  });

  it("⚠️ 뮤테이션 대상 — UTF-8 로 읽으면 이름이 깨져 매칭이 통째로 0건이 된다", () => {
    // 되돌림(TextDecoder 인자를 utf-8 로) 시 위 테스트가 red 여야 한다는 것을 여기서 실증한다.
    const utf8Rows = parseStageCsv(FIXTURE_BUFFER.toString("utf8"));
    expect(utf8Rows[1]?.["지구명"]).not.toBe("광교지구 택지개발사업");
  });
});

// ── 이름 정규화 ─────────────────────────────────────────────────────
describe("normalizeZoneName", () => {
  it("공백을 없애고 꼬리말을 **반복해서** 떼어낸다", () => {
    expect(normalizeZoneName("광교지구 택지개발사업")).toBe("광교");
    expect(normalizeZoneName("양평 공흥지구 도시개발사업지구")).toBe("양평공흥");
    expect(normalizeZoneName("양평 빈양지구 도시개발구역")).toBe("양평빈양");
  });

  it("괄호 안 내용을 버린다 (반각·전각 모두)", () => {
    expect(normalizeZoneName("양주신도시(옥정)택지개발사업")).toBe("양주신도시");
    expect(normalizeZoneName("마산해양신도시（서항지구）도시개발사업")).toBe("마산해양신도시");
  });

  it("꼬리말만으로 이루어진 이름을 빈 문자열로 갉아먹지 않는다", () => {
    // s.length > suf.length 조건이 없으면 "지구" 가 "" 가 되어 아무 이름에나 걸린다.
    expect(normalizeZoneName("지구")).toBe("지구");
  });

  it("빈 값·null 은 빈 문자열", () => {
    expect(normalizeZoneName(null)).toBe("");
    expect(normalizeZoneName(undefined)).toBe("");
    expect(normalizeZoneName("")).toBe("");
  });
});

// ── 색인 · 매칭 ─────────────────────────────────────────────────────
/**
 * @param {[string, string, string?][]} triples [지구명, 단계코드명, 고시사업지구명?]
 * @returns {Record<string, string>[]}
 */
function csvRows(triples) {
  return triples.map(([name, step, alt]) => ({
    지구명: name, 단계코드명: step, 고시사업지구명: alt ?? "",
  }));
}

describe("buildStageIndex", () => {
  it("지구명과 고시사업지구명 둘 다 색인 키가 된다", () => {
    const idx = buildStageIndex(csvRows([["가나다지구", "준공", "라마바지구 택지개발사업"]]));
    expect(idx.byKey.get("가나다")).toEqual(new Set(["준공"]));
    expect(idx.byKey.get("라마바")).toEqual(new Set(["준공"]));
  });

  it("단계코드명이 비면 색인에 넣지 않는다", () => {
    expect(buildStageIndex(csvRows([["가나다지구", ""]])).keys).toEqual([]);
  });

  it("같은 키에 서로 다른 단계가 오면 둘 다 보관한다 (매칭 단계가 모호로 버린다)", () => {
    const idx = buildStageIndex(csvRows([["가나다지구", "준공"], ["가나다", "실시계획"]]));
    expect(idx.byKey.get("가나다")).toEqual(new Set(["준공", "실시계획"]));
  });
});

describe("matchZoneStage — 엄격 2단계", () => {
  const index = buildStageIndex(csvRows([
    ["광교지구 택지개발사업", "준공"],
    ["화성동탄지구 택지개발사업", "실시변경"],
    ["고양향동공공주택지구조성", "준공"],        // 포함 매칭 대상
    ["곤지암역세권1 도시개발구역", "지구지정"],   // 모호(포함 후보 2) 대상 1
    ["곤지암역세권2 도시개발구역", "실시계획"],   // 모호(포함 후보 2) 대상 2
    ["서울우면2", "준공"],                      // 같은 키 다른 단계 1
    ["서울우면2지구", "실시변경"],               // 같은 키 다른 단계 2
  ]));

  it("① 정규화 이름이 정확히 일치하면 그 단계", () => {
    expect(matchZoneStage("광교지구 택지개발사업", index)).toEqual({ via: "exact", step: "준공", key: "광교" });
    // 표기가 달라도 정규화 후 같으면 정확 일치다.
    expect(matchZoneStage("화성동탄", index)).toMatchObject({ via: "exact", step: "실시변경" });
  });

  it("② 포함 후보가 **딱 하나**일 때만 그 단계", () => {
    const m = matchZoneStage("고양향동 공공주택지구", index);
    expect(m).toMatchObject({ via: "contains", step: "준공", key: "고양향동공공주택지구조성" });
  });

  it("⚠️ 뮤테이션 대상 — 포함 후보가 둘 이상이면 채우지 않는다(모호 스킵)", () => {
    // `if (candidates.length > 1) return { via: "ambiguous" }` 를 지우면 첫 후보의 단계를
    // 조용히 채워 넣는다 — 틀린 단계를 넣느니 비워 두는 것이 이 수집기의 계약이다.
    const m = matchZoneStage("곤지암역세권", index);
    expect(m.via).toBe("ambiguous");
    expect(m.step).toBeUndefined();
  });

  it("⚠️ 뮤테이션 대상 — 정확 일치해도 한 키에 단계가 여럿이면 모호 스킵", () => {
    const m = matchZoneStage("서울우면2", index);
    expect(m.via).toBe("ambiguous");
    expect(m.step).toBeUndefined();
  });

  it("⚠️ 뮤테이션 대상 — **포함**으로 잡은 후보라도 그 키에 단계가 여럿이면 모호 스킵", () => {
    // 정확 일치 경로와 포함 경로는 `steps.size > 1` 검사가 **서로 다른 줄**에 있다.
    // 위 테스트는 정확 일치 줄만 지키므로 포함 쪽 줄을 지워도 통과해 버린다
    // (세션523 뮤테이션에서 실제로 green 이 나와 이 구멍을 발견했다).
    // "서울우면2단계" 는 색인에 정확 일치가 없고 "서울우면2" 를 포함해 후보 1개로 잡히는데,
    // 그 키에는 준공·실시변경 두 단계가 달려 있다 — 어느 쪽인지 정할 수 없으니 버려야 한다.
    const m = matchZoneStage("서울우면2단계", index);
    expect(m.via).toBe("ambiguous");
    expect(m.step).toBeUndefined();
  });

  it("아무 후보도 없으면 none", () => {
    expect(matchZoneStage("전혀다른이름", index)).toEqual({ via: "none" });
  });

  it("두 글자 이름은 정확 일치만 허용하고 포함 검사에는 쓰지 않는다", () => {
    // "광교"(2글자)는 정식 이름이라 정확 일치는 되어야 하고(위 ① 테스트),
    // 포함 검사에 쓰이면 "광교신도시"·"광교테크노밸리" 를 동시에 물어 정밀도가 무너진다.
    expect(matchZoneStage("지구", index)).toEqual({ via: "none" }); // 색인에 없는 2글자
    expect(matchZoneStage("광교신도시", index).via, "2글자 키가 포함 후보가 되면 안 된다").toBe("none");
    expect(matchZoneStage(null, index)).toEqual({ via: "none" });
  });
});

// ── 배선 가드 (소스 grep — 좌변까지 고정) ────────────────────────────
describe("배선", () => {
  it("lh_zone 만 갱신하고 다른 kind 는 건드리지 않는다", () => {
    expect(SRC).toMatch(/const\s+TARGET_KIND\s*=\s*"lh_zone"/);
    expect(SRC).toMatch(/\.eq\("kind",\s*TARGET_KIND\)/);
    expect(SRC).toMatch(/\.update\(\{\s*progression_step:\s*m\.step\s*\}\)/);
  });

  it("dry-run 은 DB 쓰기도 collector_runs 기록도 하지 않는다", () => {
    // 세션515 "dry-run 위장 success" 답습 — dry-run 분기가 기록 전에 return 해야 한다.
    const dryBlock = SRC.slice(SRC.indexOf("if (dryRun) {"), SRC.indexOf("let changed = 0;"));
    expect(dryBlock).toContain("dry-run — DB 쓰기 생략");
    expect(dryBlock).not.toContain("await recordCollectorRun(");
    expect(dryBlock).toMatch(/\n\s*return;\n/);
  });

  it("list.json 요청에 tNm 을 함께 보낸다 (빠지면 406)", () => {
    expect(SRC).toMatch(/const\s+body\s*=\s*`tNm=\$\{TABLE\}&table=\$\{TABLE\}/);
  });
});
