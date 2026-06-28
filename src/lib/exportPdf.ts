/**
 * 비교 결과 내보내기 유틸리티
 * html2canvas + jsPDF를 dynamic import하여 번들 크기 최소화
 */

const CAPTURE_OPTS = { useCORS: true, scale: 2, backgroundColor: "#ffffff" };
const A4_WIDTH_MM = 297;
const A4_HEIGHT_MM = 210;

/** DOM 요소 → Canvas 캡처 (공통) */
async function captureElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  return html2canvas(element, CAPTURE_OPTS);
}

/** DOM 요소 → PNG 이미지 다운로드 */
export async function exportAsImage(element: HTMLElement, filename: string = "compare.png"): Promise<void> {
  const canvas = await captureElement(element);
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/** DOM 요소 → PDF 다운로드 */
export async function exportAsPdf(element: HTMLElement, filename: string = "compare.pdf"): Promise<void> {
  const [canvas, { jsPDF }] = await Promise.all([captureElement(element), import("jspdf")]);
  const imgData = canvas.toDataURL("image/png");
  const pdfW = A4_WIDTH_MM;
  const pdfH = (canvas.height * pdfW) / canvas.width;
  const pdf = new jsPDF({ orientation: pdfH > A4_HEIGHT_MM ? "portrait" : "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const scale = Math.min(pageW / pdfW, pageH / pdfH, 1);
  const finalW = pdfW * scale;
  const finalH = pdfH * scale;
  pdf.addImage(imgData, "PNG", (pageW - finalW) / 2, 10, finalW, finalH);
  pdf.setFontSize(8);
  pdf.setTextColor(150);
  pdf.text(`미분양 비교 엔진 v3.0 — ${new Date().toLocaleDateString("ko-KR")}`, pageW / 2, pageH - 5, {
    align: "center",
  });
  pdf.save(filename);
}
