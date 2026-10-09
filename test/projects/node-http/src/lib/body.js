import { HttpError } from './respond.js';

const MAX_BODY = 1024 * 1024; // 1 MB

export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const data = JSON.parse(raw);
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          return reject(new HttpError(400, 'Body must be a JSON object'));
        }
        resolve(data);
      } catch {
        reject(new HttpError(400, 'Malformed JSON body'));
      }
    });

    req.on('error', reject);
  });
}
