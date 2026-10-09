import http from 'node:http';
import { route } from './src/router.js';
import { sendJson } from './src/lib/respond.js';

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });

  try {
    await route(req, res);
  } catch (err) {
    if (err.statusCode) {
      return sendJson(res, err.statusCode, { error: err.message, ...(err.details && { details: err.details }) });
    }
    console.error(err);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`todo api listening on http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
