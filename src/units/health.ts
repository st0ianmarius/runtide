/** A health held to a unit's range: from 0 up to its maximum. */
export const clampHealth = (health: number, maxHealth: number): number => Math.max(0, Math.min(health, maxHealth));
