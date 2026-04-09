jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));

const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');
const adminServerLogRoutes = require('../routes/adminServerLogRoutes');
const { resolveAllowedLogPath, tailFile, logBaseDir } = adminServerLogRoutes;

describe('adminServerLogRoutes', () => {
  let tmpDir;
  let logFile;
  let prevOut;
  let prevDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plog-logs-'));
    logFile = path.join(tmpDir, 'test-out.log');
    fs.writeFileSync(logFile, 'line1\nline2\nline3\n', 'utf8');
    prevOut = process.env.SERVER_LOG_OUT;
    prevDir = process.env.SERVER_LOG_DIR;
    process.env.SERVER_LOG_DIR = tmpDir;
    process.env.SERVER_LOG_OUT = logFile;
    delete process.env.SERVER_LOG_ERR;
  });

  afterEach(() => {
    process.env.SERVER_LOG_OUT = prevOut;
    process.env.SERVER_LOG_DIR = prevDir;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('tailFile returns last lines within cap', () => {
    const big = Array.from({ length: 50 }, (_, i) => `n${i}`).join('\n') + '\n';
    fs.writeFileSync(logFile, big, 'utf8');
    const t = tailFile(logFile, 4096, 5);
    const lines = t.trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[lines.length - 1]).toBe('n49');
  });

  it('resolveAllowedLogPath rejects paths outside base', () => {
    process.env.SERVER_LOG_OUT = '/etc/passwd';
    expect(resolveAllowedLogPath('out')).toBeNull();
  });

  it('GET /server-logs returns plain text tail', async () => {
    const app = express();
    app.use((req, res, next) => {
      req.id = 'test-req-id';
      next();
    });
    app.use('/admin', adminServerLogRoutes);

    const res = await request(app).get('/admin/server-logs').expect(200);
    expect(res.text).toContain('line3');
    expect(res.headers['x-log-file']).toBe('test-out.log');
  });

  it('GET /server-logs returns 503 when not configured', async () => {
    delete process.env.SERVER_LOG_OUT;
    const app = express();
    app.use((req, res, next) => {
      req.id = 'r1';
      next();
    });
    app.use('/admin', adminServerLogRoutes);

    const res = await request(app).get('/admin/server-logs').expect(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

describe('logBaseDir', () => {
  it('defaults under home .pm2/logs when SERVER_LOG_DIR unset', () => {
    const prev = process.env.SERVER_LOG_DIR;
    delete process.env.SERVER_LOG_DIR;
    const d = logBaseDir();
    expect(d).toMatch(/\.pm2[/\\]logs$/);
    process.env.SERVER_LOG_DIR = prev;
  });
});
