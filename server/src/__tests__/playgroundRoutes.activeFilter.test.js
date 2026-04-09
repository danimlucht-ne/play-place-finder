const { ACTIVE_FILTER } = require('../routes/playgroundRoutes');

describe('ACTIVE_FILTER', () => {
    test('excludes archived and closed playground documents', () => {
        expect(ACTIVE_FILTER).toEqual({
            archivedAt: { $exists: false },
            status: { $nin: ['closed', 'archived'] },
        });
    });
});
