import { createRegistry, type Registry } from '../core/index.ts';
import type { RollEffect } from './rolls.ts';

/**
 * One damage kind: which blow and heal stages its blows skip, and which outcome rows they never
 * roll. True damage is a kind that is never avoided or blocked and skips mitigation and absorbs (`TRUE_DAMAGE`), but still passes the ignore gates and `onLethal`; a kind
 * that only its own immunity stops (fire walls that kill the invulnerable) is read by the ignore hooks, which see the
 * blow's kind.
 */
export interface DamageKindDef {
  /**
   * The stages a blow of this kind skips, by name: built-in stages (`roll`, `mitigation`, `absorb`, …) or the game's
   * own. The after-stages (`dealt`, `outcome`, `death`) and `health` cannot be skipped. Checked when the
   * damage system is built.
   */
  readonly bypass?: readonly string[];

  /** The outcome rows a blow of this kind never rolls, by effect: `avoid`, `block`, `scale`. */
  readonly unrolled?: readonly RollEffect[];
}

/**
 * True damage: it cannot be missed, dodged, parried or blocked, and skips the mitigation rows and absorbs;
 * it can still crit, and still passes the ignore gates and `onLethal`.
 */
export const TRUE_DAMAGE: DamageKindDef = Object.freeze({
  bypass: Object.freeze(['mitigation', 'absorb']),
  unrolled: Object.freeze(['avoid', 'block'] as const),
});

/** The game's damage kinds: dense ids by key order (the first is a blow's default), append-only like any registry. */
export type DamageKindTable<Name extends string = string> = Registry<
  'damageKinds',
  Extract<Name, string>,
  DamageKindDef,
  never
>;

/**
 * Declares the game's damage kinds (`defineDamageKinds({ physical: {}, magic: {}, pure: TRUE_DAMAGE })`): what
 * mitigation rows, ignore hooks and trigger filters read, and which stages each kind skips.
 */
export const defineDamageKinds = <const Name extends string>(
  kinds: Readonly<Record<Name, DamageKindDef>>,
): DamageKindTable<Name> => {
  const table: Readonly<Record<string, DamageKindDef>> = kinds;

  if (Object.keys(table).length === 0) {
    throw new RangeError('A game needs at least one damage kind.');
  }

  return createRegistry(kinds, { kind: 'damageKinds' });
};
