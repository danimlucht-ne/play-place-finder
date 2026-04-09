/**
 * PM2 process file — use from the server directory:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Set on the host (or in server/.env — copy paths into shell env for PM2):
 *   SERVER_LOG_OUT   — absolute path to this app’s stdout log (must stay under SERVER_LOG_DIR or ~/.pm2/logs)
 *   SERVER_LOG_ERR   — absolute path to stderr log (optional; for GET /admin/server-logs?which=err)
 *   SERVER_LOG_DIR   — optional; directory logs must live under (default: ~/.pm2/logs)
 *
 * Admin log viewer: GET /admin/server-logs (Firebase admin token) returns the last lines of SERVER_LOG_OUT.
 * Install rotation: pm2 install pm2-logrotate
 */
const path = require('path');

const serverDir = __dirname;
const appName = process.env.PM2_APP_NAME || 'play-place-finder';

module.exports = {
  apps: [
    {
      name: appName,
      cwd: serverDir,
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        // Set to 0 or remove if Node is exposed directly (no nginx/LB). Behind one reverse proxy, use 1.
        TRUST_PROXY: process.env.TRUST_PROXY || '1',
      },
    },
  ],
};
