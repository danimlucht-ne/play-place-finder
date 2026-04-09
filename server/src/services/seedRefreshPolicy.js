const DEFAULT_REFRESH_DAYS = 30;
const DEFAULT_STALE_LOCK_MINUTES = 120;

function envInt(name, fallback, min, max) {
  const value = parseInt(process.env[name] || '', 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function lightRefreshCadenceMs() {
  return envInt('SEED_LIGHT_REFRESH_DAYS', DEFAULT_REFRESH_DAYS, 1, 365) * 86400000;
}

function staleLockMs() {
  return envInt('SEED_JOB_STALE_LOCK_MINUTES', DEFAULT_STALE_LOCK_MINUTES, 5, 1440) * 60000;
}

function nextLightRefreshAfter(from = new Date()) {
  return new Date(from.getTime() + lightRefreshCadenceMs());
}

function isRefreshLockStale(region, now = new Date()) {
  if (!region?.refreshInFlight) return true;
  const started = region.refreshStartedAt ? new Date(region.refreshStartedAt).getTime() : 0;
  return !started || now.getTime() - started > staleLockMs();
}

function isRegionDueForLightRefresh(region, now = new Date()) {
  if (!region) return false;
  if (region.seedStatus === 'running') return false;
  if (region.refreshInFlight && !isRefreshLockStale(region, now)) return false;
  if (!region.lastLightRefreshAt && !region.nextLightRefreshAfter) return true;
  const next = region.nextLightRefreshAfter
    ? new Date(region.nextLightRefreshAfter).getTime()
    : new Date(region.lastLightRefreshAt).getTime() + lightRefreshCadenceMs();
  return !Number.isFinite(next) || next <= now.getTime();
}

module.exports = {
  DEFAULT_REFRESH_DAYS,
  DEFAULT_STALE_LOCK_MINUTES,
  lightRefreshCadenceMs,
  staleLockMs,
  nextLightRefreshAfter,
  isRefreshLockStale,
  isRegionDueForLightRefresh,
};
