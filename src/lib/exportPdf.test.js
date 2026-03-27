import { describe, it, expect, vi } from "vitest";

// html2canvas와 jspdf를 모킹하여 DOM 없이 테스트
vi.mock("html2canvas", () => ({
  default: vi.fn(() => Promise.resolve({
    toDataURL: () => "data:image/png;base64,fake",
    width: 800,
    height: 600,
  })),
}));

vi.mock("jspdf", () => ({
  jsPDF: vi.fn(function() {
    this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    this.addImage = vi.fn();
    this.setFontSize = vi.fn();
    this.setTextColor = vi.fn();
    this.text = vi.fn();
    this.save = vi.fn();
  }),
}));

describe("exportPdf", () => {
  // exportAsImage: canvas → download link 생성
  it("exportAsImage가 다운로드 링크를 생성", async () => {
    const { exportAsImage } = await import("@/lib/exportPdf");
    const mockElement = document.createElement("div");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await exportAsImage(mockElement, "test.png");
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
  });

  // exportAsPdf: canvas → PDF save 호출
  it("exportAsPdf가 PDF를 저장", async () => {
    const { exportAsPdf } = await import("@/lib/exportPdf");
    const { jsPDF } = await import("jspdf");
    const mockElement = document.createElement("div");
    await exportAsPdf(mockElement, "test.pdf");
    // jsPDF 인스턴스가 생성되었는지
    expect(jsPDF).toHaveBeenCalled();
  });

  // 빈 요소도 크래시 없음
  it("빈 div 요소도 크래시 없이 처리", async () => {
    const { exportAsImage } = await import("@/lib/exportPdf");
    const empty = document.createElement("div");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await expect(exportAsImage(empty)).resolves.not.toThrow();
    clickSpy.mockRestore();
  });
});
