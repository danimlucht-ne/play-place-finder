const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const { verifyAdminToken } = require('../services/authService');
const campaignLifecycleService = require('../services/campaignLifecycleService');
const stripeService = require('../services/stripeService');
const cityPhaseService = require('../services/cityPhaseService');
const { notifyAdvertiser, resolveAdDisplayName } = require('../services/advertiserEmailService');
const seedOrchestratorService = require('../services/seedOrchestratorService');

// Apply admin auth to all routes in this router
router.use(verifyAdminToken);

// GET /submissions — list flagged submissions (status=manual_review) with review flags
router.get('/submissions', async (req, res) => {
  try {
    const db = getDb();
    const status = req.query.status || 'manual_review';

    const submissions = await db.collection('adSubmissions')
      .find({ status })
      .sort({ createdAt: -1 })
      .toArray();

    // Join review flags for each submission
    const submissionIds = submissions.map(s => s._id);
    const flags = await db.collection('reviewFlags')
      .find({ submissionId: { $in: submissionIds } })
      .toArray();

    const flagsBySubmission = {};
    for (const flag of flags) {
      const key = flag.submissionId.toString();
      if (!flagsBySubmission[key]) flagsBySubmission[key] = [];
      flagsBySubmission[key].push(flag);
    }

    const creativeIds = submissions.map((s) => s.creativeId).filter(Boolean);
    const creatives = creativeIds.length
      ? await db.collection('adCreatives').find({ _id: { $in: creativeIds } }).toArray()
      : [];
    const creativeById = new Map(creatives.map((c) => [c._id.toString(), c]));

    const data = submissions.map((s) => {
      const cr = s.creativeId ? creativeById.get(s.creativeId.toString()) : null;
      const headline = (cr && cr.headline) ? String(cr.headline).trim() : '';
      const businessName = (cr && cr.businessName) ? String(cr.businessName).trim() : '';
      const reviewDisplayName = headline || businessName || '';
      return {
        ...s,
        reviewDisplayName,
        reviewFlags: flagsBySubmission[s._id.toString()] || [],
      };
    });

    res.json({ message: 'success', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /submissions/:id — full detail with advertiser, creative, flags
router.get('/submissions/:id', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    const creative = submission.creativeId
      ? await db.collection('adCreatives').findOne({ _id: submission.creativeId })
      : null;
    const rawFlags = await db.collection('reviewFlags')
      .find({ submissionId: submission._id })
      .toArray();
    const seen = new Set();
    const flags = [];
    for (const f of rawFlags) {
      const key = `${f.flagType}|${f.description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push(f);
    }

    res.json({
      message: 'success',
      data: { ...submission, advertiser, creative, reviewFlags: flags },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /submissions/:id/review — approve or reject { decision, reason? }
router.post('/submissions/:id/review', async (req, res) => {
  try {
    const db = getDb();
    const { decision, reason } = req.body;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }

    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const now = new Date();

    if (decision === 'approve') {
      const paidTx = await db.collection('paymentTransactions').findOne({
        submissionId: submission._id,
        status: 'succeeded',
      });
      const nextStatus = paidTx ? 'approved' : 'approved_pending_charge';
      // Update submission status
      await db.collection('adSubmissions').updateOne(
        { _id: submission._id },
        { $set: { status: nextStatus, approvedAt: now, updatedAt: now } }
      );

      // Trigger campaign activation only once payment is captured.
      let campaignId = null;
      if (paidTx) {
        const activated = await campaignLifecycleService.activateCampaign(submission._id);
        campaignId = activated?.campaignId || null;
      }

      // Resolve review flags
      await db.collection('reviewFlags').updateMany(
        { submissionId: submission._id, resolvedAt: null },
        { $set: { resolvedAt: now, resolvedBy: req.user.uid, resolution: 'approved' } }
      );

      // Paid path: activateCampaign sends scheduled vs live. Pending charge: explain capture at start.
      if (!paidTx) {
        const adDisplayName = await resolveAdDisplayName(db, submission.creativeId);
        notifyAdvertiser(submission.advertiserId, 'campaign_approved_pending_charge', {
          startDate: submission.startDate,
          startDateCalendar: submission.startDateCalendar,
          adDisplayName,
        });
      }

      res.json({ message: 'success', data: { decision: 'approve', campaignId } });
    } else {
      // Reject
      await db.collection('adSubmissions').updateOne(
        { _id: submission._id },
        { $set: { status: 'rejected', rejectedAt: now, rejectionReason: reason || null, updatedAt: now } }
      );

      let stripeWarning = null;
      try {
        if (submission.paymentMode === 'manual_capture' && submission.paymentIntentId) {
          await stripeService.releaseAuthorization(submission.paymentIntentId, reason || 'Admin rejected');
        } else if (submission.paymentIntentId) {
          await stripeService.refund(submission.paymentIntentId, reason || 'Admin rejected');
        }
      } catch (e) {
        stripeWarning = e.message || String(e);
        console.warn('[ad review reject] Stripe release/refund failed (submission already marked rejected):', stripeWarning);
      }

      // Resolve review flags
      await db.collection('reviewFlags').updateMany(
        { submissionId: submission._id, resolvedAt: null },
        { $set: { resolvedAt: now, resolvedBy: req.user.uid, resolution: 'rejected' } }
      );

      // Notify advertiser of rejection
      const adDisplayName = await resolveAdDisplayName(db, submission.creativeId);
      notifyAdvertiser(submission.advertiserId, 'campaign_rejected', { reason: reason || '', adDisplayName });

      res.json({
        message: 'success',
        data: { decision: 'reject', stripeWarning },
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /submissions/:id/request-revision — return to advertiser for edits; cancel uncaptured payment
router.post('/submissions/:id/request-revision', async (req, res) => {
  try {
    const db = getDb();
    const message = String(req.body?.message || '').trim();
    if (!message || message.length < 5) {
      return res.status(400).json({ error: 'message is required (at least 5 characters)' });
    }

    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    if (submission.status !== 'manual_review') {
      return res.status(400).json({ error: 'Revision can only be requested for submissions in manual review.' });
    }

    const now = new Date();

    if (submission.paymentIntentId) {
      if (submission.paymentMode === 'manual_capture') {
        await stripeService.releaseAuthorization(submission.paymentIntentId, 'Admin requested creative revision');
      } else {
        try {
          await stripeService.refund(submission.paymentIntentId, 'Admin requested revision before publish');
        } catch (e) {
          console.warn('[request-revision] refund failed, trying cancel:', e.message);
          try {
            await stripeService.releaseAuthorization(submission.paymentIntentId, 'Admin requested revision');
          } catch (_) { /* ignore */ }
        }
      }
    }

    await db.collection('adSubmissions').updateOne(
      { _id: submission._id },
      {
        $set: {
          status: 'revision_requested',
          revisionRequestMessage: message,
          revisionRequestedAt: now,
          updatedAt: now,
          paymentIntentId: null,
        },
      },
    );

    await db.collection('reviewFlags').updateMany(
      { submissionId: submission._id, resolvedAt: null },
      { $set: { resolvedAt: now, resolvedBy: req.user.uid, resolution: 'revision_requested' } },
    );

    const adDisplayName = await resolveAdDisplayName(db, submission.creativeId);
    notifyAdvertiser(submission.advertiserId, 'campaign_revision_requested', { message, adDisplayName });

    res.json({ message: 'success', data: { status: 'revision_requested' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /submissions/:id/admin-set-status — correct stuck queue / DB state (does not call Stripe)
const ADMIN_SETTABLE_SUBMISSION_STATUSES = [
  'manual_review',
  'rejected',
  'revision_requested',
  'cancelled',
  'approved',
  'approved_pending_charge',
];

router.post('/submissions/:id/admin-set-status', async (req, res) => {
  try {
    const db = getDb();
    const { status, note } = req.body || {};
    if (!status || !ADMIN_SETTABLE_SUBMISSION_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${ADMIN_SETTABLE_SUBMISSION_STATUSES.join(', ')}`,
      });
    }

    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const now = new Date();
    const $set = {
      status,
      updatedAt: now,
      adminStatusOverrideAt: now,
      adminStatusOverrideBy: req.user.uid,
    };
    const trimmedNote = note != null ? String(note).trim().slice(0, 2000) : '';
    if (trimmedNote) $set.adminStatusOverrideNote = trimmedNote;
    if (status === 'rejected' && !submission.rejectedAt) {
      $set.rejectedAt = now;
    }

    await db.collection('adSubmissions').updateOne({ _id: submission._id }, { $set });

    res.json({ message: 'success', data: { status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /cities — list all cities with phase info (no slot inventory)
router.get('/cities', async (req, res) => {
  try {
    const db = getDb();
    const cities = await db.collection('cityAdSettings').find({}).toArray();

    const data = cities.map((c) => {
      const raw = c.phase === 'beta' || c.phase === 'growth' ? 'growing' : c.phase;
      return {
        cityId: c.cityId,
        phase: raw || 'seeding',
        phaseOverride: c.phaseOverride || false,
        phaseChangedAt: c.phaseChangedAt || null,
      };
    });

    res.json({ message: 'success', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /cities/:cityId/phase — manually set city phase
router.put('/cities/:cityId/phase', async (req, res) => {
  try {
    const { cityId } = req.params;
    const { phase } = req.body;

    if (!phase || !['growing', 'mature'].includes(phase)) {
      return res.status(400).json({ error: 'phase must be one of: growing, mature' });
    }

    await cityPhaseService.setPhaseOverride(cityId, phase);

    res.json({ message: 'success', data: { cityId, phase } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /cities/:cityId/open-advertising — create/update settings: growing | mature from user count + default pricing
router.post('/cities/:cityId/open-advertising', async (req, res) => {
  try {
    const { cityId } = req.params;
    const db = getDb();
    const existing = await db.collection('cityAdSettings').findOne({ cityId });
    const p = existing?.phase;
    if (p === 'growing' || p === 'mature' || p === 'growth') {
      return res.status(400).json({ error: `City is already in ${p === 'growth' ? 'growing' : p} phase` });
    }

    await cityPhaseService.openAdvertisingForRegion(cityId);
    const info = await cityPhaseService.getCityPhase(cityId);

    res.json({ message: 'success', data: { cityId, phase: info.phase } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Region Management ───────────────────────────────────────────────────────

// DELETE /regions/:regionKey — delete a region and all its playgrounds
router.delete('/regions/:regionKey', async (req, res) => {
  try {
    const db = getDb();
    const { regionKey } = req.params;

    // Collect advertiser IDs for this region before deleting them
    const advertisers = await db.collection('advertisers').find({ regionKey }).project({ _id: 1 }).toArray();
    const advertiserIds = advertisers.map(a => a._id);

    // Delete ad submissions associated with those advertisers
    if (advertiserIds.length > 0) {
      await db.collection('adSubmissions').deleteMany({ advertiserId: { $in: advertiserIds.map(id => id.toString()) } });
    }

    // Delete advertisers for this region
    await db.collection('advertisers').deleteMany({ regionKey });

    // Delete campaigns, targeting, and city settings for this region
    await db.collection('adCampaigns').deleteMany({ cityId: regionKey });
    await db.collection('adTargeting').deleteMany({ cityId: regionKey });
    await db.collection('cityAdSettings').deleteMany({ cityId: regionKey });

    // Existing deletes
    await db.collection('playgrounds').deleteMany({ regionKey });
    await db.collection('seeded_regions').deleteOne({ regionKey });

    res.json({ message: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /regions/:regionKey/reseed — wipe region data + fresh hybrid seed from stored center (status → running/partial/complete)
router.post('/regions/:regionKey/reseed', async (req, res) => {
  try {
    const { regionKey } = req.params;
    await seedOrchestratorService.startFullRegionReseed(regionKey, req.user?.uid ?? null);
    res.json({
      message: 'success',
      data: {
        regionKey,
        note:
          'Full re-seed started: playgrounds and seed artifacts for this region were cleared; hybrid seed runs in the background. seedStatus moves running → partial → complete (or failed). cityAdSettings / advertisers are unchanged.',
      },
    });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'BAD_CENTER') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /regions/:regionKey/expand — +10 mi coverage metadata + additive Places grid; seedStatus running → complete/failed
router.post('/regions/:regionKey/expand', async (req, res) => {
  try {
    const db = getDb();
    const { regionKey } = req.params;
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region) return res.status(404).json({ error: 'Region not found' });
    const center = seedOrchestratorService.seededRegionCenterToLatLng(region.center);
    if (!center) {
      return res.status(400).json({ error: `Region ${regionKey} has no usable center coordinates` });
    }

    await db.collection('seeded_regions').updateOne(
      { regionKey },
      { $inc: { coverageRadiusMiles: 10 }, $set: { seedStatus: 'running' } },
    );
    const updated = await db.collection('seeded_regions').findOne({ regionKey });
    const userId = req.user?.uid ?? null;
    setImmediate(() => {
      seedOrchestratorService.completeAdminExpandRegion(regionKey, userId).catch((e) =>
        console.error(`[admin-ads-expand] ${regionKey}:`, e.message),
      );
    });
    res.json({
      message: 'success',
      data: {
        regionKey,
        coverageRadiusMiles: updated?.coverageRadiusMiles,
        note:
          'Coverage radius increased and additive Places expansion is running in the background. seedStatus will become complete when the grid crawl finishes (or failed if the job errors).',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /regions/:regionKey/lightweight-reseed — Google Places grid re-crawl + upserts only (no wipe; no full scrub/merge)
router.post('/regions/:regionKey/lightweight-reseed', async (req, res) => {
  try {
    const { regionKey } = req.params;
    await seedOrchestratorService.scheduleLightweightAlgorithmRecrawlForRegion(regionKey);
    res.json({
      message: 'success',
      data: {
        regionKey,
        note:
          'Lightweight re-seed scheduled: 3×3 Places grid with pagination, upserts by place_id only. Does not delete data or run venue merge / photo scrub.',
      },
    });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'BAD_CENTER') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /regions/:regionKey/seed-viewport — Places crawl for the visible map bounds (admin map “Seed this view”)
router.post('/regions/:regionKey/seed-viewport', async (req, res) => {
  try {
    const { regionKey } = req.params;
    const b = req.body || {};
    const data = await seedOrchestratorService.scheduleViewportPlacesRecrawlForRegion(
      regionKey,
      {
        southWestLat: b.southWestLat,
        southWestLng: b.southWestLng,
        northEastLat: b.northEastLat,
        northEastLng: b.northEastLng,
        mode: b.mode,
      },
      req.user?.uid ?? null,
      { mode: b.mode },
    );
    res.json({
      message: 'success',
      data: {
        ...data,
        note:
          'Places crawl scheduled for this map rectangle (upserts + campus discovery + venue merge). New pins may take a few minutes; pull to refresh on Home.',
      },
    });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'BAD_BOUNDS') return res.status(400).json({ error: err.message });
    if (err.code === 'VIEWPORT_TOO_LARGE') return res.status(400).json({ error: err.message });
    if (err.code === 'FORBIDDEN_MODE') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /regions/:regionKey/viewport-seed-preview — last "Seed this map view" run + candidate list (for review; re-seed to refresh)
router.get('/regions/:regionKey/viewport-seed-preview', async (req, res) => {
  try {
    const { regionKey } = req.params;
    const region = await getDb().collection('seeded_regions').findOne(
      { regionKey },
      { projection: { lastViewportSeedAt: 1, lastViewportSeed: 1 } },
    );
    if (!region) return res.status(404).json({ error: 'Region not found' });
    const s = region.lastViewportSeed || {};
    res.json({
      message: 'success',
      data: {
        lastViewportSeedAt: region.lastViewportSeedAt || null,
        gridPointCount: s.gridPointCount,
        inserted: s.inserted,
        kidFilteredCandidates: s.kidFilteredCandidates,
        afterArchiveFilterCount: s.afterArchiveFilterCount,
        candidatesPreview: s.candidatesPreview || [],
        candidatesPreviewTruncated: Boolean(s.candidatesPreviewTruncated),
        bounds: s.southWestLat != null ? {
          southWestLat: s.southWestLat,
          southWestLng: s.southWestLng,
          northEastLat: s.northEastLat,
          northEastLng: s.northEastLng,
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /advertisers — list all advertisers with submission and campaign counts
router.get('/advertisers', async (req, res) => {
  try {
    const db = getDb();
    const data = await db.collection('advertisers').aggregate([
      {
        $addFields: {
          advertiserIdStr: { $toString: '$_id' }
        }
      },
      {
        $lookup: {
          from: 'adSubmissions',
          localField: 'advertiserIdStr',
          foreignField: 'advertiserId',
          as: 'submissions'
        }
      },
      {
        $lookup: {
          from: 'adCampaigns',
          localField: 'advertiserIdStr',
          foreignField: 'advertiserId',
          as: 'campaigns'
        }
      },
      {
        $project: {
          _id: 1,
          businessName: 1,
          regionKey: 1,
          submissionCount: { $size: '$submissions' },
          campaignCount: { $size: '$campaigns' },
        }
      }
    ]).toArray();
    res.json({ message: 'success', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /lifecycle/run — manually trigger campaign lifecycle transitions
router.post('/lifecycle/run', async (req, res) => {
  try {
    const transitions = await campaignLifecycleService.processLifecycleTransitions();
    const expirations = await campaignLifecycleService.processIntroExpirations();
    res.json({
      message: 'success',
      data: {
        activated: transitions.activated || 0,
        completed: transitions.completed || 0,
        eventExpired: transitions.eventExpired || 0,
        expired: expirations.expired || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
