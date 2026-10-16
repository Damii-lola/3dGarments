import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';
import { loadTemplate } from '../services/templates.js';
import { runScan } from '../services/scan.js';

const UUID = /^[0-9a-f-]{36}$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.uploadBytes, files: 2 },
  fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.mimetype) ? cb(null, true) : cb(new HttpError(415, `Unsupported image type: ${file.mimetype}`))),
});
const limiter = rateLimit({
  windowMs: 60 * 60_000, limit: 30, keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many scans — try again later.' },
});

export const scan = Router();

/**
 * POST /api/scan  (multipart) — open, no login required.
 *   front             the garment photo (required)      back   the back photo (optional)
 *   template          id of a published garment_templates row (optional, if template_geometry given)
 *   template_geometry JSON {pos, nrm, uv, index} of a template mesh (optional, if template id given)
 *   size              1024 | 2048 (default 2048)         format webp | png (default webp)
 * -> 200 { image: <base64>, mime, report }   the texture atlas for that template's UVs
 */
scan.post('/', limiter, upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]), ah(async (req, res) => {
  const front = req.files?.front?.[0]?.buffer, back = req.files?.back?.[0]?.buffer;
  if (!front) throw new HttpError(400, 'Attach the front photo as multipart field "front"');
  const size = [1024, 2048].includes(Number(req.body?.size)) ? Number(req.body.size) : 2048;
  const format = req.body?.format === 'png' ? 'png' : 'webp';

  let template;
  const geometry = req.body?.template_geometry;
  if (geometry) {
    try { template = JSON.parse(geometry); } catch { throw new HttpError(400, 'template_geometry must be JSON {pos, nrm, uv, index}'); }
    if (!template.pos || !template.nrm || !template.uv || !template.index) throw new HttpError(400, 'template_geometry needs pos, nrm, uv and index');
  } else {
    const id = String(req.body?.template || '');
    if (!UUID.test(id)) throw new HttpError(400, 'template must be a garment_templates id, or send template_geometry');
    template = await loadTemplate(id);
  }
  const out = await runScan({ front, back, template, size, format });
  res.json({ image: Buffer.from(out.image).toString('base64'), mime: out.mime, report: out.report });
}));
