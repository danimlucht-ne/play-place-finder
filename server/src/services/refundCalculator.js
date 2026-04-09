/**
 * Calculates pro-rated refund amount based on remaining campaign time.
 * @param {Date} startDate — campaign start date
 * @param {Date} endDate — campaign end date
 * @param {number} amountInCents — original payment amount
 * @returns {{ refundAmountInCents: number, remainingDays: number, totalDays: number }}
 */
function calculateProRatedRefund(startDate, endDate, amountInCents, now = new Date()) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / msPerDay);
  const remainingDays = Math.max(0, Math.round((endDate.getTime() - todayStart.getTime()) / msPerDay));

  if (totalDays <= 0 || remainingDays <= 0) {
    return { refundAmountInCents: 0, remainingDays: 0, totalDays: Math.max(0, totalDays) };
  }

  if (remainingDays >= totalDays) {
    return { refundAmountInCents: amountInCents, remainingDays, totalDays };
  }

  const refundAmountInCents = Math.floor((remainingDays / totalDays) * amountInCents);
  return { refundAmountInCents, remainingDays, totalDays };
}

module.exports = { calculateProRatedRefund };
