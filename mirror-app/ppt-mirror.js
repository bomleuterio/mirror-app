const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const sharp = require('sharp');
const pptxgen = require('pptxgenjs');

const EXPORT_DPI = 150;
const SCALE = EXPORT_DPI / 72;

// Windows: PowerShell + PowerPoint COM
async function exportSlidesCOM(inputPath, exportDir) {
  const absInput = path.resolve(inputPath).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const absExport = path.resolve(exportDir).replace(/\\/g, '\\\\').replace(/'/g, "''");

  const script = `
$ErrorActionPreference = 'Stop'
$pptApp = New-Object -ComObject PowerPoint.Application
$pptApp.Visible = 1
try {
  $pres = $pptApp.Presentations.Open('${absInput}', 1, 1, 0)
  $wPt = $pres.PageSetup.SlideWidth
  $hPt = $pres.PageSetup.SlideHeight
  $wPx = [int]($wPt / 72.0 * ${EXPORT_DPI})
  $hPx = [int]($hPt / 72.0 * ${EXPORT_DPI})
  $n   = $pres.Slides.Count
  for ($i = 1; $i -le $n; $i++) {
    $f = '${absExport}\\\\slide-' + $i.ToString('D3') + '.png'
    $pres.Slides($i).Export($f, 'PNG', $wPx, $hPx)
  }
  $pres.Close()
  Write-Output "OK:$wPt\`t$hPt\`t$n"
} finally {
  $pptApp.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pptApp)
}
`;

  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 180000,
  });

  if (result.error) throw new Error(`Failed to start PowerShell: ${result.error.message}`);

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  if (result.status !== 0 || !stdout.startsWith('OK:')) {
    throw new Error(`PowerPoint export failed.\n${stderr || stdout}`);
  }

  const parts = stdout.slice(3).split('\t');
  const widthPt = parseFloat(parts[0]);
  const heightPt = parseFloat(parts[1]);
  const count = parseInt(parts[2], 10);

  const slides = [];
  for (let i = 1; i <= count; i++) {
    slides.push({
      pngPath: path.join(exportDir, `slide-${String(i).padStart(3, '0')}.png`),
      widthPt,
      heightPt,
    });
  }
  return slides;
}

// Linux: LibreOffice PPTX→PDF, then mupdf PDF→PNG
async function exportSlidesLibreOffice(inputPath, exportDir, tmpRoot) {
  // Use a unique HOME per conversion so concurrent jobs don't conflict
  const loHome = path.join(tmpRoot, 'lo-home');
  await fs.mkdir(loHome, { recursive: true });

  const result = spawnSync('libreoffice', [
    '--headless',
    '--norestore',
    '--nofirststartwizard',
    '--convert-to', 'pdf',
    '--outdir', exportDir,
    inputPath,
  ], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, HOME: loHome },
  });

  if (result.error) throw new Error(`LibreOffice not found: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`LibreOffice failed:\n${result.stderr || result.stdout}`);
  }

  // Find the PDF LibreOffice created
  const files = await fs.readdir(exportDir);
  const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'));
  if (!pdfFile) throw new Error('LibreOffice did not produce a PDF output.');
  const pdfPath = path.join(exportDir, pdfFile);

  // Render the PDF pages with mupdf (mupdf renders PDF reliably)
  const { default: mupdf } = await import('mupdf');
  const data = await fs.readFile(pdfPath);
  const doc = mupdf.Document.openDocument(data, 'application/pdf');
  const numPages = doc.countPages();
  if (numPages === 0) throw new Error('No pages found in converted PDF.');

  const slides = [];
  for (let i = 0; i < numPages; i++) {
    const page = doc.loadPage(i);
    const bounds = page.getBounds();
    const widthPt = bounds[2] - bounds[0];
    const heightPt = bounds[3] - bounds[1];
    const pixmap = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
    const png = pixmap.asPNG();
    const outPath = path.join(exportDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
    await fs.writeFile(outPath, Buffer.from(png));
    slides.push({ pngPath: outPath, widthPt, heightPt });
  }

  return slides;
}

async function mirrorPptx(inputPath, outputPath) {
  const handle = await fs.open(inputPath, 'r');
  try {
    const hdr = Buffer.alloc(2);
    const { bytesRead } = await handle.read(hdr, 0, 2, 0);
    if (bytesRead < 2 || hdr[0] !== 0x50 || hdr[1] !== 0x4b) {
      throw new Error('Not a valid .pptx file (expected ZIP/Office format).');
    }
  } finally {
    await handle.close();
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-mirror-'));
  const exportDir = path.join(tmpRoot, 'export');
  const mirroredDir = path.join(tmpRoot, 'mirrored');
  await fs.mkdir(exportDir, { recursive: true });
  await fs.mkdir(mirroredDir, { recursive: true });

  try {
    const slides = process.platform === 'win32'
      ? await exportSlidesCOM(inputPath, exportDir)
      : await exportSlidesLibreOffice(inputPath, exportDir, tmpRoot);

    const mirroredSlides = [];
    for (const slide of slides) {
      const outPng = path.join(mirroredDir, path.basename(slide.pngPath));
      await sharp(slide.pngPath).flop().png().toFile(outPng);
      mirroredSlides.push({ ...slide, pngPath: outPng });
    }

    const { widthPt, heightPt } = mirroredSlides[0];
    const widthIn = widthPt / 72;
    const heightIn = heightPt / 72;

    const pres = new pptxgen();
    pres.defineLayout({ name: 'SLIDE', width: widthIn, height: heightIn });
    pres.layout = 'SLIDE';

    for (const slide of mirroredSlides) {
      const s = pres.addSlide();
      s.addImage({ path: slide.pngPath, x: 0, y: 0, w: widthIn, h: heightIn });
    }

    await pres.writeFile({ fileName: outputPath });
    return outputPath;
  } finally {
    try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { mirrorPptx };
