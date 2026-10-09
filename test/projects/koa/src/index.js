const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`Library API listening on http://localhost:${config.port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
