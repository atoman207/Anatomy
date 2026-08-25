"use client";

/**
 * Turns the rendered report preview into a paginated PDF `Blob`, client-side.
 *
 * Rasterizing the actual preview element (rather than re-laying-out the
 * Markdown in a PDF library) guarantees the PDF matches exactly what the
 * researcher reviewed on screen, images and all - the same principle
 * FiguresPanel already follows by exporting the same SVG string it renders.
 */
export async function renderElementToPdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  // The notebook preview lives far off-screen so it does not affect layout.
  // html2canvas often hangs or returns a blank page for those nodes, so
  // briefly park a same-size clone in the viewport for the capture only.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:794px",
    "z-index:-1",
    "opacity:1",
    "pointer-events:none",
    "background:#ffffff",
  ].join(";");
  const clone = el.cloneNode(true) as HTMLElement;
  host.appendChild(clone);
  document.body.appendChild(host);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(clone, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: clone.scrollWidth || 794,
      windowHeight: Math.max(clone.scrollHeight, 1),
    });
  } finally {
    host.remove();
  }

  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const marginMm = 10;
  const contentWidthMm = pageWidthMm - marginMm * 2;
  const pxPerMm = canvas.width / contentWidthMm;
  const pageContentHeightMm = pageHeightMm - marginMm * 2;

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const sliceHeightPx = Math.floor(pageContentHeightMm * pxPerMm);

  if (canvas.height === 0) {
    pdf.text("内容がありません。", marginMm, marginMm + 10);
    return pdf.output("blob");
  }

  let renderedPx = 0;
  let page = 0;
  const sliceCanvas = document.createElement("canvas");
  sliceCanvas.width = canvas.width;
  const ctx = sliceCanvas.getContext("2d");
  if (!ctx) throw new Error("Canvasを利用できません。");

  while (renderedPx < canvas.height) {
    const thisSlicePx = Math.min(sliceHeightPx, canvas.height - renderedPx);
    sliceCanvas.height = thisSlicePx;
    ctx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      canvas,
      0, renderedPx, canvas.width, thisSlicePx,
      0, 0, canvas.width, thisSlicePx,
    );

    if (page > 0) pdf.addPage();
    const sliceHeightMm = thisSlicePx / pxPerMm;
    pdf.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      marginMm, marginMm, contentWidthMm, sliceHeightMm,
    );

    renderedPx += thisSlicePx;
    page++;
  }

  return pdf.output("blob");
}

/** Reads a `Blob` as a base64 string (no `data:` prefix), for the upload action. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}
