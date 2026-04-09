'use strict';

/**
 * Heuristic: creative looks like internal / placeholder / sample content (not a typical paid buy).
 */
function inferDemoCampaign(creative) {
  if (!creative) return false;
  if (creative.internalDemo === true) return true;
  const b = String(creative.businessName || '').toLowerCase();
  const h = String(creative.headline || '').toLowerCase();
  if (b.includes('your business name here')) return true;
  if (b.includes('sample business')) return true;
  if (h.includes('sample ad') || h === 'sample' || h.startsWith('sample ')) return true;
  if (h.includes('placeholder')) return true;
  // Common internal / QA copy (not production creative)
  if (b === 'business' && (h.includes('headline') || h === 'headline')) return true;
  return false;
}

module.exports = { inferDemoCampaign };
