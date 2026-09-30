// A pipeline collects auras on every blow, so the loops are indexed.
import type { Bitset } from '../core/index.ts';
import type { ActiveAura } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraHookName } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { setOf } from './state.ts';

/** The damage, heal and force hooks, which a pipeline collects auras for. */
export type AuraPipelineHook = Extract<
  AuraHookName,
  | 'onIgnore'
  | 'onOutgoingDamage'
  | 'onIncomingDamage'
  | 'onLethal'
  | 'onDealt'
  | 'onIncomingForce'
  | 'onOutgoingHeal'
  | 'onIncomingHeal'
>;

/** A hook a pipeline collects auras for: the framework's, or one of the game's own (`AuraDef.on`), by name. */
export type CollectedHook<G extends AuraTypes> = AuraPipelineHook | Extract<keyof G['auraHooks'], string>;

/** The `has` bitset of a collected hook; `undefined` for a game hook no aura answers. */
const hasOf = <G extends AuraTypes>(engine: AuraEngine<G>, hook: CollectedHook<G>): Bitset | undefined => {
  const has: Readonly<Record<string, Bitset | undefined>> = engine.registry.has;

  return has[hook] ?? engine.registry.hasOn[hook];
};

/**
 * Writes the auras that have a hook (a pipeline's, or one of the game's own) into `out` by index, clears what an
 * earlier call left, and counts.
 */
export const collectIn = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly hook: CollectedHook<G>; readonly out: (ActiveAura<G> | undefined)[] },
): number => {
  const { items } = setOf<G>(bearer);
  const has = hasOf(engine, at.hook);
  const { out } = at;
  let count = 0;

  for (let i = 0; i < items.length && has !== undefined; i++) {
    const item = items[i];

    if (item !== undefined && has.has(item.id)) {
      out[count] = item;
      count += 1;
    }
  }

  for (let i = count; i < out.length && out[i] !== undefined; i++) {
    out[i] = undefined;
  }

  return count;
};
