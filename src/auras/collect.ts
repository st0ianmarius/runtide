// Hot path (§I.4.2, §I.5.4): a pipeline collects auras on every blow, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { ActiveAura } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraHookName } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { setOf } from './state.ts';

/** The damage and force hooks, which a pipeline collects auras for. */
export type AuraPipelineHook = Extract<
  AuraHookName,
  'onIgnore' | 'onIncomingDamage' | 'onLethal' | 'onDealt' | 'onIncomingForce'
>;

/** Writes the auras that have a pipeline hook into `out` by index, clears what an earlier call left, and counts. */
export const collectIn = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly hook: AuraPipelineHook; readonly out: (ActiveAura<G> | undefined)[] },
): number => {
  const { items } = setOf<G>(bearer);
  const has = engine.registry.has[at.hook];
  const { out } = at;
  let count = 0;

  for (let i = 0; i < items.length; i++) {
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
