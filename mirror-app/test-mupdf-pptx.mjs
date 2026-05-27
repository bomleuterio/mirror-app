import mupdf from 'mupdf';
import fs from 'fs/promises';

const data = await fs.readFile('C:/temp/test.pptx');
const doc = mupdf.Document.openDocument(data, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
console.log('Pages:', doc.countPages());

const page = doc.loadPage(0);
const bounds = page.getBounds();
console.log('Bounds (points):', bounds);
console.log('Width inches:', (bounds[2] - bounds[0]) / 72);
console.log('Height inches:', (bounds[3] - bounds[1]) / 72);

// Render at 150 DPI
const scale = 150 / 72;
const pixmap = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
console.log('Rendered size:', pixmap.getWidth(), 'x', pixmap.getHeight());
