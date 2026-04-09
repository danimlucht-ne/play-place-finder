/**
 * HTTP + MongoDB integration tests. Requires a running MongoDB (MONGODB_URI).
 * CI provides Mongo via the workflow services block. Locally: Docker or `test:unit` to skip these.
 *
 * @jest-environment node
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';

const { app, runStartupTasks } = require('../../index');
const { getDb } = require('../../database');

describe('API integration', () => {
  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is required for integration tests');
    }
    await runStartupTasks();
  });

  test('GET /api/health returns JSON with status field', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });

  test('POST /api/reports/crowd creates report with mock auth', async () => {
    const placeId = `test-place-${Date.now()}`;
    const res = await request(app)
      .post('/api/reports/crowd')
      .set('Authorization', 'Bearer mock_jwt_token_for_integration-crowd-user')
      .send({ placeId, crowdLevel: 'Busy' })
      .expect(201);

    expect(res.body.message).toBe('success');

    const db = getDb();
    const doc = await db.collection('crowd_reports').findOne({ placeId, crowdLevel: 'Busy' });
    expect(doc).toBeTruthy();
    expect(doc.userId).toBe('integration-crowd-user');
  });

  test('GET /api/reports/:placeId returns latest crowd', async () => {
    const placeId = `agg-${Date.now()}`;
    await request(app)
      .post('/api/reports/crowd')
      .set('Authorization', 'Bearer mock_jwt_token_for_integration-crowd-user')
      .send({ placeId, crowdLevel: 'Quiet' })
      .expect(201);

    const res = await request(app).get(`/api/reports/${encodeURIComponent(placeId)}`).expect(200);

    expect(res.body.message).toBe('success');
    expect(res.body.data.latestCrowd).toBeTruthy();
    expect(res.body.data.latestCrowd.crowdLevel).toBe('Quiet');
  });

  test('POST /admin/ads/submissions/:id/admin-set-status updates submission', async () => {
    const db = getDb();
    const id = new ObjectId();
    await db.collection('adSubmissions').insertOne({
      _id: id,
      advertiserId: 'test-advertiser',
      status: 'manual_review',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/ads/submissions/${id.toString()}/admin-set-status`)
      .set('Authorization', 'Bearer mock_jwt_token_for_admin-user')
      .send({ status: 'rejected', note: 'integration test' })
      .expect(200);

    expect(res.body.data.status).toBe('rejected');

    const updated = await db.collection('adSubmissions').findOne({ _id: id });
    expect(updated.status).toBe('rejected');
    expect(updated.adminStatusOverrideNote).toBe('integration test');

    await db.collection('adSubmissions').deleteOne({ _id: id });
  });
});
