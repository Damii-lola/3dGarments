import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { loadTemplate } from '../services/templates.js';
import { runScan } from '../services/scan.js';

const UUID = /^[0-9a-f-]{36}$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.uploadBytes, files: 2 },
  fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.mimetype) ? cb(null, true) : cb(new HttpError(415, `Unsupported image type: ${file.mimetype}`))),
});
const limiter = rateLimit({
  windowMs: 60 * 60_000, limit: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many scans — try again later.' },
});

export const scan = Router();

/** a signed-in user, or (only when SCAN_LAB_KEY is set on the server) the lab's shared key */
function userOrLabKey(req, res, next) {
  const key = req.headers['x-scan-key'];
  if (config.scanLabKey && key && key === config.scanLabKey) { req.user = { id: 'lab' }; return next(); }
  return requireUser(req, res, next);
}

/**
 * POST /api/scan  (multipart)
 *   front     the garment photo (required)      back   the back photo (optional)
 *   template  id of a published garment_templates row (required)
 *   size      1024 | 2048 (default 2048)         format webp | png (default webp)
 * -> 200 { image: <base64>, mime, report }   the texture atlas for that template's UVs
 */
scan.post('/', userOrLabKey, limiter, upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]), ah(async (req, res) => {
  const front = req.files?.front?.[0]?.buffer, back = req.files?.back?.[0]?.buffer;
  if (!front) throw new HttpError(400, 'Attach the front photo as multipart field "front"');
  const id = String(req.body?.template || '');
  if (!UUID.test(id)) throw new HttpError(400, 'template must be a garment_templates id');
  const size = [1024, 2048].includes(Number(req.body?.size)) ? Number(req.body.size) : 2048;
  const format = req.body?.format === 'png' ? 'png' : 'webp';
  const template = await loadTemplate(id);
  const out = await runScan({ front, back, template, size, format });
  res.json({ image: Buffer.from(out.image).toString('base64'), mime: out.mime, report: out.report });
}));
