import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { config, missingConfig } from './config.js';
import { HttpError } from './lib/errors.js';
import { supabaseConfigured } from './lib/supabase.js';
import { health } from './routes/health.js';
import { garments } from './routes/garments.js';
import { me } from './routes/me.js';
import { ngl } from './routes/ngl.js';
import { groups } from './routes/groups.js';
import { recoverStaleGroups } from './services/groups.js';
import { recoverStaleJobs, ensureBucket } from './services/pipeline.js';

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new HttpError(403, `Origin ${origin} not allowed (add it to CORS_ORIGINS)`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));
const smallJson = express.json({ limit: '256kb' });
app.use((req, res, next) => (req.path.startsWith('/api/ngl/') ? next() : smallJson(req, res, next))); // photos: the route's own limit

app.get('/', (_req, res) => res.json({ service: '3dgarments-api', docs: '/health' }));
app.use('/health', health);
// the web app (GitHub Pages) reads its public Supabase settings from here, so every key lives in
// Render's env. Only browser-safe values: the project URL and the anon key (RLS guards the data).
app.get('/api/public-config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl: config.supabase.anonKey ? config.supabase.url : '',
    supabaseAnonKey: config.supabase.anonKey,
  });
});
app.use('/api/garments', garments);
app.use('/api/me', me);
app.use('/api/groups', groups);
app.use('/api/ngl', ngl);

app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Internal error';
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `Image too large (max ${config.limits.uploadBytes / 1048576} MB)` : err.message;
  }
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({ error: status >= 500 && config.env === 'production' ? 'Internal error' : message, ...(err.details ? { details: err.details } : {}) });
});

const server = app.listen(config.port, () => {
  const missing = missingConfig();
  console.log(`3dGarments API listening on :${config.port} (${config.env})`);
  if (missing.length) console.warn(`⚠ missing env: ${missing.join(', ')} — related endpoints return 503`);
  if (supabaseConfigured()) {
    ensureBucket().catch((e) => console.warn('bucket check failed:', e.message));
    recoverStaleJobs().catch((e) => console.warn('stale-job recovery skipped:', e.message));
    recoverStaleGroups().catch((e) => console.warn('stale-group recovery skipped:', e.message));
  }
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
