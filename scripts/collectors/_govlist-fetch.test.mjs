// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDaeguList, parseDaeguView, parseChungnamList, parseChungnamView, pickLatest, pickXlsx, titleMonthEnd, monthEnd,
  fetchLatestGovlist, GovlistFetchError,
} from "./_govlist-fetch.mjs";

const FX = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/govlist");
const html = (/** @type {string} */ f) => readFileSync(resolve(FX, f), "utf8");

describe("목록·첨부 HTML (세션687 실접속 발췌)", () => {
  it("대구 목록 → 9월말 글이 기준월 최신(829484)", () => {
    const items = parseDaeguList(html("daegu-list.html"));
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(pickLatest(items)).toMatchObject({ id: "829484", asOf: "2026-09-30" });
  });
  it("게시 순서가 아니라 제목의 기준월로 고른다", () => {
    const items = [{ id: "1", title: "", asOf: "2026-08-31" }, { id: "2", title: "", asOf: "2026-09-30" }, { id: "3", title: "", asOf: "2026-07-31" }];
    expect(pickLatest(items)?.id).toBe("2");
    expect(pickLatest([...items].reverse())?.id).toBe("2");
    // 같은 기준월 재게시 → 글 번호 큰 쪽
    expect(pickLatest([{ id: "10", title: "", asOf: "2026-09-30" }, { id: "12", title: "", asOf: "2026-09-30" }])?.id).toBe("12");
  });
  it("대구 글 → 첨부 2개 중 이름이 .xlsx 인 것(fileSn 1)", () => {
    const files = parseDaeguView(html("daegu-view.html"));
    expect(files.map((f) => f.name.slice(-4))).toEqual(["xlsx", ".hwp"]);
    expect(pickXlsx(files)?.url).toBe("https://www.daegu.go.kr/icms/cmm/fms/FileDown.do?atchFileId=FILE_000000000728147&fileSn=1");
    // 순서가 바뀐 달(8월 = hwp 가 sn 1)에도 이름으로 고른다
    expect(pickXlsx([...files].reverse())?.name).toMatch(/\.xlsx$/);
  });
  it("충남 목록 → 6월말(2180612) · 글 → .xlsx 첨부", () => {
    const items = parseChungnamList(html("chungnam-list.html"));
    expect(pickLatest(items)).toMatchObject({ id: "2180612", asOf: "2026-06-30" });
    const files = parseChungnamView(html("chungnam-view.html"));
    expect(files).toHaveLength(1);
    expect(pickXlsx(files)?.url).toContain("fileDown.do?menuNo=5100253&atchFileId=4ef2905c1acd4090a92aee45d49cadf4&fileSn=1");
  });
  it("제목 기준월 → 말일 · 윤년", () => {
    expect(titleMonthEnd("2026년 9월말 대구 공동주택 미분양 현황")).toBe("2026-09-30");
    expect(titleMonthEnd("2028년 2월말 기준")).toBe("2028-02-29");
    expect(titleMonthEnd("2026년 13월말")).toBeNull();
    expect(monthEnd(2026, 2)).toBe("2026-02-28");
  });
});

describe("fetchLatestGovlist — 호출 3회 · xlsx 아니면 거부", () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  /** @param {Buffer} file */
  const fake = (file) => {
    /** @type {string[]} */ const urls = [];
    const f = /** @type {typeof fetch} */ (/** @type {any} */ (async (/** @type {string} */ url) => {
      urls.push(url);
      if (url.includes("FileDown") || url.includes("fileDown")) return new Response(new Uint8Array(file), { status: 200 });
      if (url.includes("list.do")) return new Response(html("chungnam-list.html"));
      if (url.includes("view.do")) return new Response(html("chungnam-view.html"));
      return new Response(urls.length === 1 ? html("daegu-list.html") : html("daegu-view.html"));
    }));
    return { f, urls };
  };
  it("대구: 목록 → 글 → 첨부", async () => {
    const { f, urls } = fake(zip);
    const r = await fetchLatestGovlist("daegu", { fetchImpl: f });
    expect(r).toMatchObject({ calls: 3, postId: "829484", titleAsOf: "2026-09-30" });
    expect(urls).toHaveLength(3);
  });
  it("충남: 목록 → 글 → 첨부", async () => {
    const { f } = fake(zip);
    const r = await fetchLatestGovlist("chungnam", { fetchImpl: f });
    expect(r).toMatchObject({ calls: 3, postId: "2180612", titleAsOf: "2026-06-30" });
  });
  it("첨부가 zip 이 아니면(오류 페이지) GovlistFetchError", async () => {
    const { f } = fake(Buffer.from("<html>오류</html>"));
    await expect(fetchLatestGovlist("daegu", { fetchImpl: f })).rejects.toBeInstanceOf(GovlistFetchError);
  });
});
