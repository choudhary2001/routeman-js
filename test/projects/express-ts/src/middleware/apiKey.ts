import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config.js';

const expected = Buffer.from(config.adminApiKey);

/** Machine-to-machine auth for the internal admin endpoints (x-api-key header). */
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  const provided = req.get('x-api-key');
  if (!provided) {
    res.status(401).json({ error: 'Missing x-api-key header' });
    return;
  }

  const candidate = Buffer.from(provided);
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
};
