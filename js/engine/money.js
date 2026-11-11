// Money rules shared by the data builder and the game. All figures in $ millions.
export const MIN_SALARY = 0.8;
export const CBT = { base: 244, step: 4, tiers: [0, 20, 40, 60], rates: [0.20, 0.32, 0.625, 0.80], repeat: [0.30, 0.42, 0.95, 1.10] };

// What a player of this ability earns per year on the open market.
export function marketValue(ovr, isReliever = false) {
  if (ovr <= 64) return MIN_SALARY;
  const d = ovr - 64;
  const v = MIN_SALARY + 0.95 * d + 0.012 * d * d;
  return Math.round((isReliever ? v * 0.55 : v) * 10) / 10;
}

export const fmtMoney = m => m >= 1 ? `$${m.toFixed(m >= 10 ? 1 : 2)}M` : `$${Math.round(m * 1000)}K`;
