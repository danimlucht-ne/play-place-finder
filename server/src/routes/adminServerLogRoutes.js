const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const rateLimit = require('express-rate-limit');
const { verifyAdminToken } = require('../services/authService');

const router = express.Router();

const MAX_BYTES = 512 * 1024;
const MAX_LINES_CAP = 2000;
const DEFAULT_LINES = 400;

const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

function logBaseDir() {
  if (process.env.SERVER_LOG_DIR && String(process.env.SERVER_LOG_DIR).trim()) {
    return path.resolve(String(process.env.SERVER_LOG_DIR).trim());
  }
  return path.resolve(path.join(os.homedir(), '.pm2', 'logs'));
}

/**
 * Resolve a log file path from env. Must be absolute and stay under logBaseDir() after realpath.
 * @param {'out'|'err'} which
 * @returns {string|null}
 */
function resolveAllowedLogPath(which) {
  const envName = which === 'err' ? 'SERVER_LOG_ERR' : 'SERVER_LOG_OUT';
  const configured = process.env[envName];
  if (!configured || typeof configured !== 'string') return null;
  const trimmed = configured.trim();
  if (!path.isAbsolute(trimmed)) return null;

  let resolved = path.resolve(trimmed);
  const base = logBaseDir();
  const basePrefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (resolved !== base && !resolved.startsWith(basePrefix)) return null;

  try {
    resolved = fs.realpathSync(resolved);
  } catch (_) {
    return null;
  }
  if (resolved !== base && !resolved.startsWith(basePrefix)) return null;

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (_) {
    return null;
  }
  if (!stat.isFile()) return null;
  return resolved;
}

/**
 * Read last portion of file, return at most maxLines lines (from end).
 */
function tailFile(filePath, maxBytes, maxLines) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  if (size === 0) return '';
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const byteLen = size - start;
    const buf = Buffer.alloc(byteLen);
    fs.readSync(fd, buf, 0, byteLen, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const firstNl = text.indexOf('\n');
      if (firstNl >= 0) text = text.slice(firstNl + 1);
    }
    const lines = text.split(/\r?\n/);
    if (lines.length > maxLines) {
      return lines.slice(-maxLines).join('\n');
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

router.use(verifyAdminToken);

/**
 * GET /admin/server-logs?which=out|err&lines=400
 * Requires SERVER_LOG_OUT and/or SERVER_LOG_ERR (absolute paths under SERVER_LOG_DIR or ~/.pm2/logs).
 */
router.get('/server-logs', listLimiter, (req, res) => {
  const which = String(req.query.which || 'out').toLowerCase() === 'err' ? 'err' : 'out';
  const filePath = resolveAllowedLogPath(which);
  if (!filePath) {
    return res.status(503).json({
      error:
        'Log file not configured. Set SERVER_LOG_OUT (and optionally SERVER_LOG_ERR) to absolute paths under SERVER_LOG_DIR (default: ~/.pm2/logs). See server/ecosystem.config.cjs.',
      which,
    });
  }

  let lines = parseInt(String(req.query.lines || DEFAULT_LINES), 10);
  if (!Number.isFinite(lines) || lines < 1) lines = DEFAULT_LINES;
  lines = Math.min(lines, MAX_LINES_CAP);

  try {
    const text = tailFile(filePath, MAX_BYTES, lines);
    res.setHeader('X-Log-File', path.basename(filePath));
    res.type('text/plain; charset=utf-8');
    return res.send(text || '(empty log)\n');
  } catch (err) {
    console.error('[admin/server-logs]', req.id, err.message);
    return res.status(500).json({ error: err.message, requestId: req.id });
  }
});

module.exports = router;
module.exports.resolveAllowedLogPath = resolveAllowedLogPath;
module.exports.logBaseDir = logBaseDir;
module.exports.tailFile = tailFile;
