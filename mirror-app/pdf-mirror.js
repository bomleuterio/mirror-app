const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;

async function mirrorPdf(inputPath, outputPath) {
  try {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const mirroredPdf = await PDFDocument.create();
    const pages = pdfDoc.getPages();
    const pageIndices = pages.map((_, idx) => idx);
    const embeddedPages = await mirroredPdf.embedPdf(pdfDoc, pageIndices);

    for (let i = 0; i < embeddedPages.length; i++) {
      const embedded = embeddedPages[i];
      const sourcePage = pages[i];
      const width = sourcePage.getWidth();
      const height = sourcePage.getHeight();
      const newPage = mirroredPdf.addPage([width, height]);
      newPage.drawPage(embedded, { x: width, y: 0, xScale: -1, yScale: 1 });
    }

    const mirroredPdfBytes = await mirroredPdf.save();
    await fs.writeFile(outputPath, mirroredPdfBytes);
    return outputPath;
  } catch (error) {
    console.error('Error mirroring PDF file:', error);
    throw error;
  }
}

module.exports = { mirrorPdf };
