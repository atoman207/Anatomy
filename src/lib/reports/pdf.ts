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
  let zones: { top: number; bottom: number }[];
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
    // A page break must never fall inside a figure, table, or rule - a photo
    // or data table sliced across two printed pages is unreadable. Measured
    // from the still-mounted clone (not the canvas) and converted into
    // canvas-pixel space, so the boundary picker below can push a whole
    // element onto the next page instead of cutting through it.
    zones = measureAtomicZones(clone, canvas.height);
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
    const naiveEnd = Math.min(renderedPx + sliceHeightPx, canvas.height);
    const pageEnd = pageBreakBoundary(renderedPx, naiveEnd, zones);
    const thisSlicePx = pageEnd - renderedPx;
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

/** Bounding boxes (in canvas-pixel space) of elements a page break must not cut through. */
function measureAtomicZones(
  clone: HTMLElement,
  canvasHeight: number,
): { top: number; bottom: number }[] {
  const cloneRect = clone.getBoundingClientRect();
  if (cloneRect.height <= 0) return [];
  const ratio = canvasHeight / cloneRect.height;
  const atoms = clone.querySelectorAll(".note-figure, table, hr");
  const zones: { top: number; bottom: number }[] = [];
  for (const el of atoms) {
    const rect = el.getBoundingClientRect();
    const top = (rect.top - cloneRect.top) * ratio;
    const bottom = (rect.bottom - cloneRect.top) * ratio;
    if (bottom > top) zones.push({ top, bottom });
  }
  return zones.sort((a, b) => a.top - b.top);
}

/**
 * Moves a naive page-break boundary earlier, to just before any atomic zone
 * it would otherwise cut through, so that zone starts fresh on the next page
 * instead. An element too tall to ever fit on one page (rare, since figures
 * are height-capped in CSS) is left to be cut - there is no other option.
 */
function pageBreakBoundary(
  pageStart: number,
  naiveEnd: number,
  zones: readonly { top: number; bottom: number }[],
): number {
  for (const z of zones) {
    if (z.top < naiveEnd && z.bottom > naiveEnd && z.top > pageStart) {
      return z.top;
    }
  }
  return naiveEnd;
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
