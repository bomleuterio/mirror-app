import mupdf from 'mupdf';
import fs from 'fs/promises';

console.log('mupdf keys:', Object.keys(mupdf).join(', '));
console.log('Document:', typeof mupdf.Document);

// Test rendering a simple PDF
const pdfBytes = await fs.readFile('C:/temp/test-render.pdf').catch(() => null);
if (pdfBytes) {
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  console.log('Pages:', doc.countPages());
  const page = doc.loadPage(0);
  console.log('Page type:', typeof page);
  const pixmap = page.toPixmap([1, 0, 0, 1, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
  console.log('Pixmap w/h:', pixmap.getWidth(), pixmap.getHeight());
  const png = pixmap.asPNG();
  console.log('PNG bytes:', png.length);
} else {
  console.log('No test PDF found at C:/temp/test-render.pdf - just checking API');
}
