/**
 * 비교 결과 내보내기 유틸리티
 * html2canvas + jsPDF를 dynamic import하여 번들 크기 최소화
 */

/** DOM 요소 → PNG 이미지 다운로드 */
export async function exportAsImage(element, filename = "compare.png") {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(element, {
    useCORS: true,
    scale: 2,
    backgroundColor: "#ffffff",
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/** DOM 요소 → PDF 다운로드 */
export async function exportAsPdf(element, filename = "compare.pdf") {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");
  const canvas = await html2canvas(element, {
    useCORS: true,
    scale: 2,
    backgroundColor: "#ffffff",
  });
  const imgData = canvas.toDataURL("image/png");
  const imgW = canvas.width;
  const imgH = canvas.height;
  // A4 가로 기준 (mm)
  const pdfW = 297;
  const pdfH = (imgH * pdfW) / imgW;
  const pdf = new jsPDF({ orientation: pdfH > 210 ? "portrait" : "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const scale = Math.min(pageW / pdfW, pageH / pdfH, 1);
  const finalW = pdfW * scale;
  const finalH = pdfH * scale;
  pdf.addImage(imgData, "PNG", (pageW - finalW) / 2, 10, finalW, finalH);
  // 하단 워터마크
  pdf.setFontSize(8);
  pdf.setTextColor(150);
  pdf.text(`미분양 비교 엔진 v3.0 — ${new Date().toLocaleDateString("ko-KR")}`, pageW / 2, pageH - 5, { align: "center" });
  pdf.save(filename);
}
