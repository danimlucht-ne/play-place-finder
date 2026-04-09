const ACTIVE_PLAYGROUND_FILTER = {
  archivedAt: { $exists: false },
  status: { $nin: ['closed', 'archived'] },
};

module.exports = { ACTIVE_PLAYGROUND_FILTER };
