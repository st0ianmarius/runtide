// Hot path: the queries walk the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type ActiveAura, type AuraContext, MutableContext } from './active-aura.ts';
import type { AuraApplication } from './application.ts';
import { applyAura } from './apply.ts';
import type { AuraId, AuraTagId, AuraTypes } from './aura-types.ts';
import { type CollectedHook, collectIn, hasOf } from './collect.ts';
import { PREDICTED } from './define-auras.ts';
import { dispel, type Dispel } from './dispel.ts';
import type { AuraEngine } from './engine.ts';
import {
  enterState,
  refreshAura,
  releaseAll,
  removeAura,
  removeByTag,
  sourceGone,
  spendStacks,
  spendValue
} from './remove.ts';
import { type AuraSeed, matchesSeed, seedAuras } from './seed.ts';
import { setOf } from './state.ts';
import type { AuraSystem } from './system.ts';
import { changeTimeLeft } from './time-left.ts';
import { type AuraView, viewAuras, type ViewOptions } from './view.ts';

/** The operations of an aura system. */
type Operations<G extends AuraTypes> = Pick<
  AuraSystem<G>,
  | 'apply'
  | 'remove'
  | 'removeByTag'
  | 'dispel'
  | 'refresh'
  | 'spendStacks'
  | 'spendValue'
  | 'enterState'
  | 'hasState'
  | 'sourceGone'
  | 'release'
>;

/** The queries and reads of an aura system. */
type Queries<G extends AuraTypes> = Pick<
  AuraSystem<G>,
  | 'has'
  | 'list'
  | 'find'
  | 'stacks'
  | 'remaining'
  | 'remainingOf'
  | 'hasTag'
  | 'lengthOf'
  | 'collect'
  | 'hold'
  | 'unhold'
  | 'context'
  | 'takeContext'
  | 'giveContext'
  | 'view'
  | 'isPredicted'
  | 'scaleTimeLeft'
  | 'clampTimeLeft'
  | 'seed'
  | 'matchesSeed'
>;

/** The operations that change a bearer's auras. */
export const operationsOf = <G extends AuraTypes>(engine: AuraEngine<G>): Operations<G> => ({
  apply: (bearer: G['bearer'], aura: AuraId | AuraApplication<G>) => applyAura(engine, bearer, aura),

  remove: (bearer: G['bearer'], aura: AuraId) => removeAura(engine, bearer, aura),
  removeByTag: (bearer: G['bearer'], tag: AuraTagId) => removeByTag(engine, bearer, tag),
  dispel: (bearer: G['bearer'], spec: Dispel<G>) => dispel(engine, bearer, spec),

  refresh: (bearer: G['bearer'], id: AuraId, seconds?: number) => refreshAura(engine, bearer, { id, seconds }),

  spendStacks: (bearer: G['bearer'], id: AuraId, count: number) => spendStacks(engine, bearer, { id, count }),

  spendValue: (bearer: G['bearer'], aura: AuraId | ActiveAura, amount: number) => {
    const spend = engine.spending;

    spend.id = typeof aura === 'number' ? aura : aura.id;
    spend.only = typeof aura === 'number' ? undefined : aura;
    spend.amount = amount;

    const spent = spendValue(engine, bearer, spend);

    spend.only = undefined;

    return spent;
  },

  enterState: (bearer: G['bearer'], state: G['state']) => enterState(engine, bearer, state),
  hasState: (state: string): state is G['state'] => engine.tables.stateNames.includes(state),
  sourceGone: (bearer: G['bearer'], source: number) => sourceGone(engine, bearer, source),
  release: (bearer: G['bearer']) => releaseAll(engine, bearer)
});

/** The first instance of an aura on a bearer. */
const findIn = <G extends AuraTypes>(bearer: G['bearer'], id: AuraId): ActiveAura<G> | undefined =>
  setOf<G>(bearer).find(id);

/** The longest time left on an aura's instances. */
const remainingIn = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): number => {
  const set = setOf<G>(bearer);
  let left = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item?.id === id) {
      left = Math.max(left, engine.remainingOf(set, item));
    }
  }

  return left;
};

/** The read-only queries over a bearer's auras. */
export const queriesOf = <G extends AuraTypes>(engine: AuraEngine<G>): Queries<G> => ({
  has: (bearer: G['bearer'], id: AuraId) => findIn(bearer, id) !== undefined,
  list: (bearer: G['bearer']): readonly ActiveAura<G>[] => setOf<G>(bearer).items,
  find: (bearer: G['bearer'], id: AuraId) => findIn(bearer, id),

  stacks: (bearer: G['bearer'], id: AuraId) =>
    setOf<G>(bearer).items.reduce((sum, item) => (item.id === id ? sum + item.stacks : sum), 0),

  remaining: (bearer: G['bearer'], id: AuraId) => remainingIn(engine, bearer, id),

  remainingOf: (bearer: G['bearer'], aura: ActiveAura) => engine.remainingOf(setOf<G>(bearer), aura),

  hasTag: (bearer: G['bearer'], tag: AuraTagId) => setOf<G>(bearer).tags.has(tag),
  lengthOf: (id: AuraId, bearer: G['bearer']) => engine.lengthOf(id, bearer),

  collect: (bearer: G['bearer'], hook: CollectedHook<G>, out: (ActiveAura<G> | undefined)[]) =>
    collectIn(bearer, hasOf(engine, hook), out),

  hold: () => {
    engine.events.hold();
  },

  unhold: () => {
    engine.events.unhold();
  },

  context: (bearer: G['bearer'], aura: ActiveAura<G>): AuraContext<G> => {
    const context = new MutableContext<G>(bearer, aura);

    context.stats = engine.host.statsOf?.(bearer);

    return context;
  },

  takeContext: (bearer: G['bearer'], aura: ActiveAura<G>, other?: G['bearer']): AuraContext<G> =>
    engine.events.take(bearer, aura, other),

  giveContext: () => {
    engine.events.give();
  },

  view: (bearer: G['bearer'], out: AuraView[], options?: ViewOptions) => viewAuras(engine, [bearer, out], options),

  isPredicted: (aura: AuraId) => ((engine.flags[aura] ?? 0) & PREDICTED) !== 0,

  scaleTimeLeft: (bearer: G['bearer'], tag: AuraTagId, factor: number) =>
    changeTimeLeft(engine, [bearer, tag], { factor, cap: Infinity }),

  clampTimeLeft: (bearer: G['bearer'], tag: AuraTagId, seconds: number) =>
    changeTimeLeft(engine, [bearer, tag], { factor: 1, cap: seconds }),

  seed: (bearer: G['bearer'], seed: AuraSeed<G>) => seedAuras(engine, bearer, seed),
  matchesSeed: (bearer: G['bearer'], seed: AuraSeed<G>) => matchesSeed(engine, bearer, seed)
});
