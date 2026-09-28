import { createRegistry, type Registry } from '../core/index.ts';

/**
 * One damage kind (§II.3.14, §II.6 D1): which blow and heal stages its blows skip. True damage is a kind that skips
 * the block roll, mitigation and absorbs (`TRUE_DAMAGE`), but still passes the ignore gates and `onLethal`; a kind
 * that only its own immunity stops (fire walls that kill the invulnerable) is read by the ignore hooks, which see the
 * blow's kind.
 */
export interface DamageKindDef {
  /**
   * The stages a blow of this kind skips, by name: built-in stages (`block`, `mitigation`, `absorb`, …) or the game's
   * own. The after-stages (`dealt`, `outcome`, `knock`, `death`) and `health` cannot be skipped. Checked when the
   * damage system is built.
   */
  readonly bypass?: readonly string[];
}

/** The stages true damage skips: the block roll, the mitigation rows and absorbs (§II.3.8). */
export const TRUE_DAMAGE: DamageKindDef = Object.freeze({ bypass: Object.freeze(['block', 'mitigation', 'absorb']) });

/** The game's damage kinds: dense ids by key order (the first is a blow's default), append-only like any registry. */
export type DamageKindTable<Name extends string = string> = Registry<
  'damageKinds',
  Extract<Name, string>,
  DamageKindDef,
  never,
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
