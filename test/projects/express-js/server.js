const app = require('./app');
const config = require('./config');
const { seed } = require('./data/store');

const start = async () => {
  await seed();

  const server = app.listen(config.port, () => {
    console.log(`Server running in ${config.env} mode on port ${config.port}`);
  });

  process.on('unhandledRejection', (err) => {
    console.error(`Unhandled rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
