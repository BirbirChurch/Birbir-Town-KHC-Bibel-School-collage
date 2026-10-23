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
 * Automatically slices long documents (such as 4-semester graduation transcripts)
 * cleanly into consecutive A4 pages.
 */
export async function downloadElementAsPdf(
  elementOrId: HTMLElement | string,
  fileName: string = 'document.pdf',
  options: PdfExportOptions = {}
): Promise<boolean> {
  try {
    const element =
      typeof elementOrId === 'string'
        ? document.getElementById(elementOrId)
        : elementOrId;

    if (!element) {
      console.error('downloadElementAsPdf: target element not found', elementOrId);
      return false;
    }

    // Capture element with high pixel ratio for crisp Ethiopian typography & graphics
    const scale = options.scale || 2;
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: element.scrollWidth || 1024,
      onclone: (clonedDoc, clonedElement) => {
        // Ensure cloned element is visible and expanded
        clonedElement.style.overflow = 'visible';
        clonedElement.style.maxHeight = 'none';
        clonedElement.style.height = 'auto';
        clonedElement.style.width = '100%';
        clonedElement.style.backgroundColor = '#ffffff';

        // Remove any no-print items
        const noPrintItems = clonedElement.querySelectorAll('.no-print');
        noPrintItems.forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      }
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const orientation = options.orientation || 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: options.format || 'a4'
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

    // Save and trigger file download
    const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    pdf.save(safeName);
    return true;
  } catch (err) {
    console.error('Error generating PDF download:', err);
    return false;
  }
}

/**
 * Cleanly prints an isolated element via a hidden iframe so the main UI,
 * modal dark backdrops, and navigation never appear or cause blank printouts.
 */
export function printElementDirectly(elementOrId: HTMLElement | string): void {
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

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="am">
        <head>
          <meta charset="utf-8" />
          <title>Print Document</title>
          ${stylesHtml}
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm 12mm;
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
            table {
              border-collapse: collapse !important;
              width: 100% !important;
            }
            th, td {
              border-color: #94a3b8 !important;
            }
          </style>
        </head>
        <body>
          <div style="width: 100%; background: #ffffff; color: #0f172a;">
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
        }, 1500);
      }
    }, 400);
  } catch (err) {
    console.warn('Direct print error, falling back to standard print:', err);
    window.print();
  }
}
