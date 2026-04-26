const { ObjectId } = require('mongodb');
const { resolvePlaygroundIdFilter } = require('../utils/playgroundIdFilter');

const AUDIT_COLLECTION = 'playground_change_audit';

function cloneForSnapshot(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneForSnapshot);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = cloneForSnapshot(v);
        return out;
    }
    return value;
}

function changedTopLevelKeys(beforeDoc, afterDoc) {
    const b = beforeDoc || {};
    const a = afterDoc || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const out = [];
    for (const key of keys) {
        const bv = JSON.stringify(b[key] ?? null);
        const av = JSON.stringify(a[key] ?? null);
        if (bv !== av) out.push(key);
    }
    return out.sort();
}

async function recordPlaygroundAudit(
    db,
    {
        playgroundId,
        operationType,
        actorUserId,
        sourceType,
        sourceId = null,
        reason = null,
        beforeSnapshot = null,
        afterSnapshot = null,
        metadata = null,
    },
) {
    const playgroundIdStr = String(playgroundId);
    const before = beforeSnapshot ? cloneForSnapshot(beforeSnapshot) : null;
    const after = afterSnapshot ? cloneForSnapshot(afterSnapshot) : null;
    const changedFields = changedTopLevelKeys(before, after);
    await db.collection(AUDIT_COLLECTION).insertOne({
        playgroundId: playgroundIdStr,
        operationType: String(operationType || 'update'),
        actorUserId: actorUserId ? String(actorUserId) : null,
        sourceType: sourceType ? String(sourceType) : null,
        sourceId: sourceId ? String(sourceId) : null,
        reason: reason ? String(reason).slice(0, 500) : null,
        changedFields,
        beforeSnapshot: before,
        afterSnapshot: after,
        metadata: metadata ? cloneForSnapshot(metadata) : null,
        createdAt: new Date(),
        rollback: {
            rolledBackAt: null,
            rolledBackBy: null,
            rollbackSourceAuditId: null,
        },
    });
}

async function listPlaygroundAudits(db, playgroundId, limit = 30) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    return db.collection(AUDIT_COLLECTION)
        .find({ playgroundId: String(playgroundId) })
        .sort({ createdAt: -1 })
        .limit(n)
        .toArray();
}

async function rollbackAuditChange(db, auditId, adminUserId) {
    const _id = new ObjectId(auditId);
    const audit = await db.collection(AUDIT_COLLECTION).findOne({ _id });
    if (!audit) {
        const err = new Error('Audit entry not found.');
        err.statusCode = 404;
        throw err;
    }
    if (audit.rollback?.rolledBackAt) {
        const err = new Error('This audit entry was already rolled back.');
        err.statusCode = 409;
        throw err;
    }

    const playgroundId = String(audit.playgroundId || '');
    if (!playgroundId) {
        const err = new Error('Audit entry is missing playgroundId.');
        err.statusCode = 400;
        throw err;
    }

    if (audit.operationType === 'create') {
        const filter = resolvePlaygroundIdFilter(playgroundId);
        await db.collection('playgrounds').updateOne(
            filter,
            {
                $set: {
                    archivedAt: new Date(),
                    archivedByAdminId: adminUserId,
                    archivedReason: `Rollback of creation from audit ${auditId}`,
                },
            },
        );
    } else {
        const before = audit.beforeSnapshot;
        if (!before || typeof before !== 'object') {
            const err = new Error('Rollback snapshot is missing.');
            err.statusCode = 400;
            throw err;
        }
        const filter = resolvePlaygroundIdFilter(playgroundId);
        const existing = await db.collection('playgrounds').findOne(filter);
        if (!existing) {
            const err = new Error('Playground not found for rollback.');
            err.statusCode = 404;
            throw err;
        }
        const replacement = {
            ...before,
            _id: existing._id,
            updatedAt: new Date(),
        };
        await db.collection('playgrounds').replaceOne({ _id: existing._id }, replacement);
    }

    await db.collection(AUDIT_COLLECTION).updateOne(
        { _id },
        {
            $set: {
                'rollback.rolledBackAt': new Date(),
                'rollback.rolledBackBy': String(adminUserId),
            },
        },
    );

    return { auditId: String(audit._id), playgroundId };
}

function parseDateMaybe(value) {
    if (value == null || value === '') return null;
    const d = new Date(String(value));
    return Number.isFinite(d.getTime()) ? d : null;
}

async function rollbackChangesByUser(
    db,
    {
        actorUserId,
        adminUserId,
        startAt = null,
        endAt = null,
        limit = 200,
        dryRun = false,
    },
) {
    const actor = String(actorUserId || '').trim();
    if (!actor) {
        const err = new Error('actorUserId is required.');
        err.statusCode = 400;
        throw err;
    }
    const startDate = parseDateMaybe(startAt);
    const endDate = parseDateMaybe(endAt);
    if (startAt != null && !startDate) {
        const err = new Error('startAt must be a valid date/time.');
        err.statusCode = 400;
        throw err;
    }
    if (endAt != null && !endDate) {
        const err = new Error('endAt must be a valid date/time.');
        err.statusCode = 400;
        throw err;
    }
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
        const err = new Error('startAt must be <= endAt.');
        err.statusCode = 400;
        throw err;
    }
    const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
    const createdAt = {};
    if (startDate) createdAt.$gte = startDate;
    if (endDate) createdAt.$lte = endDate;
    const query = {
        actorUserId: actor,
        'rollback.rolledBackAt': null,
    };
    if (Object.keys(createdAt).length > 0) query.createdAt = createdAt;

    const rows = await db.collection(AUDIT_COLLECTION)
        .find(query)
        .sort({ createdAt: -1 }) // newest first
        .limit(n)
        .toArray();

    if (dryRun) {
        return {
            dryRun: true,
            matchedCount: rows.length,
            sample: rows.slice(0, 25).map((r) => ({
                auditId: r._id.toHexString(),
                playgroundId: r.playgroundId,
                operationType: r.operationType,
                sourceType: r.sourceType,
                createdAt: r.createdAt,
            })),
        };
    }

    const rolledBack = [];
    const errors = [];
    for (const row of rows) {
        try {
            const out = await rollbackAuditChange(db, row._id.toHexString(), adminUserId);
            rolledBack.push(out);
        } catch (e) {
            errors.push({
                auditId: row._id.toHexString(),
                error: e.message || 'Rollback failed.',
            });
        }
    }

    return {
        dryRun: false,
        matchedCount: rows.length,
        rolledBackCount: rolledBack.length,
        errorCount: errors.length,
        rolledBack,
        errors,
    };
}

module.exports = {
    AUDIT_COLLECTION,
    recordPlaygroundAudit,
    listPlaygroundAudits,
    rollbackAuditChange,
    rollbackChangesByUser,
};
