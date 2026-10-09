import { createApp } from './app.js';
import { config } from './config.js';
import { seedDatabase } from './services/db.js';

await seedDatabase();

const app = createApp();

app.listen(config.port, () => {
  console.log(`[taskboard] listening on http://localhost:${config.port} (${config.nodeEnv})`);
});
