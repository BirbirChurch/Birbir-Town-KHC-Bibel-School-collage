import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface PdfExportOptions {
  fileName?: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
  scale?: number;
}

/**
 * Downloads a DOM element as a real, multi-page vector/raster PDF file.
 * Handles SVG images, cross-origin assets, and iframe environments reliably.
 */
export async function downloadElementAsPdf(
  elementOrId: HTMLElement | string,
  fileName: string = 'document.pdf',
  options: PdfExportOptions = {}
): Promise<boolean> {
  const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  try {
    const element =
      typeof elementOrId === 'string'
        ? document.getElementById(elementOrId)
        : elementOrId;

    if (!element) {
      console.error('downloadElementAsPdf: target element not found', elementOrId);
      return false;
    }

    const orientation = options.orientation || 'portrait';
    const scale = options.scale || 2;
    const a4PixelWidth = orientation === 'landscape' ? 1120 : 800;

    // Capture element with html2canvas (strictly allowTaint: false to prevent SecurityError on toDataURL)
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: a4PixelWidth,
      onclone: (clonedDoc, clonedElement) => {
        // Ensure cloned element is styled to perfect A4 paper width and fully expanded
        clonedElement.style.overflow = 'visible';
        clonedElement.style.maxHeight = 'none';
        clonedElement.style.height = 'auto';
        clonedElement.style.width = `${a4PixelWidth}px`;
        clonedElement.style.maxWidth = `${a4PixelWidth}px`;
        clonedElement.style.minWidth = `${a4PixelWidth}px`;
        clonedElement.style.margin = '0 auto';
        clonedElement.style.backgroundColor = '#ffffff';

        // 1. Expand all overflow scroll containers so no table or row is clipped
        const overflowBoxes = clonedElement.querySelectorAll('.overflow-x-auto, .overflow-y-auto, .overflow-auto');
        overflowBoxes.forEach((box) => {
          (box as HTMLElement).style.overflow = 'visible';
          (box as HTMLElement).style.maxHeight = 'none';
          (box as HTMLElement).style.maxWidth = '100%';
        });

        // 2. Ensure all tables auto-fit within the container width
        const tables = clonedElement.querySelectorAll('table');
        tables.forEach((tbl) => {
          (tbl as HTMLElement).style.width = '100%';
          (tbl as HTMLElement).style.maxWidth = '100%';
          (tbl as HTMLElement).style.tableLayout = 'auto';
        });

        // 3. Ensure table cell content wraps properly
        const cells = clonedElement.querySelectorAll('th, td');
        cells.forEach((c) => {
          (c as HTMLElement).style.whiteSpace = 'normal';
          (c as HTMLElement).style.wordBreak = 'break-word';
        });

        // Clean any SVG images that might taint canvas by converting to base64 if needed
        const images = clonedElement.querySelectorAll('img');
        images.forEach((img) => {
          img.crossOrigin = 'anonymous';
          const src = img.getAttribute('src') || '';
          if (src.startsWith('data:image/svg+xml;utf8,')) {
            // Convert unencoded svg data uri to base64 data uri to avoid browser tainting
            try {
              const svgContent = decodeURIComponent(src.replace('data:image/svg+xml;utf8,', ''));
              const b64 = btoa(unescape(encodeURIComponent(svgContent)));
              img.src = `data:image/svg+xml;base64,${b64}`;
            } catch (_) {}
          }
        });

        // Hide no-print items
        const noPrintItems = clonedElement.querySelectorAll('.no-print');
        noPrintItems.forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      }
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: options.format || 'a4',
      compress: true
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Canvas aspect ratio calculations in mm
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    // First page
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    // Additional pages if the content exceeds 1 page
    while (heightLeft > 2) {
      position = -(imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }

    // Try standard jsPDF save first, with direct blob fallback for iframe/webview environments
    try {
      pdf.save(safeName);
    } catch (saveErr) {
      console.warn('pdf.save failed, falling back to Blob download:', saveErr);
      const blob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = blobUrl;
      downloadAnchor.download = safeName;
      downloadAnchor.style.display = 'none';
      downloadAnchor.target = '_blank';
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();

      setTimeout(() => {
        if (downloadAnchor.parentNode) {
          document.body.removeChild(downloadAnchor);
        }
        URL.revokeObjectURL(blobUrl);
      }, 2000);
    }

    return true;
  } catch (err) {
    console.warn('Canvas PDF generation encountered an error, falling back to direct print window:', err);
    // Graceful fallback: trigger print so user never gets stuck
    printElementDirectly(elementOrId, { orientation: options.orientation });
    return false;
  }
}

/**
 * Cleanly prints an isolated element via a hidden iframe so the main UI,
 * modal dark backdrops, and navigation never appear or cause blank printouts.
 */
export function printElementDirectly(
  elementOrId: HTMLElement | string,
  options?: { orientation?: 'portrait' | 'landscape' }
): void {
  const element =
    typeof elementOrId === 'string'
      ? document.getElementById(elementOrId)
      : elementOrId;

  if (!element) {
    window.print();
    return;
  }

  try {
    // Collect all stylesheets from current document
    let stylesHtml = '';
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      stylesHtml += node.outerHTML;
    });

    // Create a temporary hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';

    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    const printOrientation = options?.orientation || 'portrait';

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="am">
        <head>
          <meta charset="utf-8" />
          <title>ይፋዊ ሰነድ</title>
          ${stylesHtml}
          <style>
            @page {
              size: A4 ${printOrientation};
              margin: 6mm 8mm;
            }
            body {
              background: #ffffff !important;
              color: #0f172a !important;
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .no-print {
              display: none !important;
            }
            .overflow-x-auto, .overflow-y-auto {
              overflow: visible !important;
              max-height: none !important;
            }
            table {
              border-collapse: collapse !important;
              width: 100% !important;
              max-width: 100% !important;
              table-layout: auto !important;
            }
            th, td {
              border-color: #94a3b8 !important;
              padding: 4px 6px !important;
              word-break: break-word !important;
              white-space: normal !important;
            }
          </style>
        </head>
        <body>
          <div style="width: 100%; background: #ffffff; color: #0f172a; padding: 4px;">
            ${element.outerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Give images and fonts a moment to layout in iframe, then trigger print
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn('Iframe print failed, falling back to window.print', e);
        window.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 2000);
      }
    }, 450);
  } catch (err) {
    console.warn('Direct print error, falling back to standard print:', err);
    window.print();
  }
}
