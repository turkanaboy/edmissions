// Local dev launcher: fills in the two required env vars if absent, then boots.
// ponytail: dev-only defaults — real deployments set env properly (.env / compose)
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { startPolling } from '../server/poller.js';

process.env.EDMISSIONS_USERS ??= 'tyler:ravepass';
process.env.EDMISSIONS_SESSION_SECRET ??= 'local-dev-secret-0123456789';

const config = loadConfig();
const app = createApp(config);
app.listen(config.port, '127.0.0.1', () => {
  console.log(`EDMissions dev console on http://localhost:${config.port} (user: tyler / ravepass)`);
});
startPolling(app.locals.db, config);
