const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const express = require('express');
const multer = require('multer');

const { mirrorPdf } = require(path.join(__dirname, '..', 'mirror-app', 'pdf-mirror'));
const { mirrorPptx } = require(path.join(__dirname, '..', 'mirror-app', 'ppt-mirror'));

const app = express();

const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowAny = allowedOrigins.length === 0;
  const isAllowed = allowAny || (origin && allowedOrigins.includes(origin));

  if (origin && isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }

  if (req.method === 'OPTIONS') {
    if (origin && !isAllowed) return res.status(403).end();
    return res.status(204).end();
  }

  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-mirror-upload-'));
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const safeName = (file.originalname || 'upload').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

async function cleanupDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {}
}

app.post('/api/mirror', upload.single('file'), async (req, res) => {
  const mode = String(req.body && req.body.mode ? req.body.mode : '').toLowerCase();
  if (!req.file || !req.file.path) return res.status(400).json({ error: 'No file uploaded.' });
  if (mode !== 'pdf' && mode !== 'pptx') return res.status(400).json({ error: 'mode must be pdf or pptx.' });

  const inputPath = req.file.path;
  const inputDir = path.dirname(inputPath);
  const baseWithExt = path.basename(inputPath);
  const outputPath = path.join(inputDir, `mirrored_${baseWithExt}`);

  try {
    if (mode === 'pdf') {
      await mirrorPdf(inputPath, outputPath);
    } else {
      await mirrorPptx(inputPath, outputPath);
    }

    res.download(outputPath, path.basename(outputPath), async () => {
      await cleanupDir(inputDir);
    });
  } catch (e) {
    await cleanupDir(inputDir);
    res.status(500).json({ error: e && e.message ? e.message : 'Failed to mirror file.' });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  const url = host === '0.0.0.0' ? `http://localhost:${port}` : `http://${host}:${port}`;
  console.log(`iOS web app server listening on ${url}`);
});
