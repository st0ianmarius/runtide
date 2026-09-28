import {
  type AuraBearer,
  type AuraEvent,
  type AuraState,
  createAuraEvent,
  createAuraSystem,
  defineAuras,
  defineAuraTags,
} from '../src/auras/index.ts';
import { createBus, createClock, stream } from '../src/core/index.ts';
import {
  applyAura,
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  grant,
  group,
  type Proc,
  type ProcSystem,
  removeByTag,
} from '../src/procs/index.ts';
import {
  auraTriggerEvent,
  createTriggerSystem,
  type TriggerDef,
  triggerEvent,
  type TriggerTypes,
  withTriggerCooldowns,
} from '../src/triggers/index.ts';

/** A bench unit. */
interface Unit extends AuraBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its auras. */
  readonly auras: AuraState;
}

/** The bench game's types: core procs only, two trigger events. */
interface BenchGame extends TriggerTypes {
  /** A bench unit. */
  readonly bearer: Unit;

  /** Core procs. */
  readonly proc: Proc<BenchGame>;

  /** Triggers. */
  readonly trigger: TriggerDef<BenchGame>;

  /** No game kinds. */
  readonly gameProc: never;

  /** Two events. */
  readonly event: 'hit' | 'aura';

  /** One filter. */
  readonly filter: 'minAmount';

  /** Tags. */
  readonly tag: 'buff' | 'debuff';

  /** One clock. */
  readonly clock: 'world';

  /** One resource. */
  readonly resource: 'gold';
}

/** A hit, about its attacker. */
interface Hit {
  /** Who struck. */
  attacker: Unit | undefined;

  /** How hard. */
  amount: number;
}

/** Everything the benchmarks count, so no work is optimised away. */
export const counter = { granted: 0 };

/** A trigger that grants gold (the cheapest proc through the host), with a passing filter. */
const granting = (hears: 'self' | 'party'): TriggerDef<BenchGame> => ({
  on: 'hit',
  hears,
  when: [{ filter: 'minAmount', arg: 5 }],
  do: [grant('gold', 1)],
});

const AURAS = defineAuras<BenchGame, string>(
  withTriggerCooldowns<BenchGame, 'zeal' | 'banner' | 'plain' | 'buff' | 'debuff'>({
    zeal: { duration: 'infinite', triggers: [granting('self'), granting('self')] },
    banner: { duration: 'infinite', triggers: [granting('party')] },
    plain: { duration: 'infinite' },
    buff: { duration: 30, tags: ['buff'] },
    debuff: { duration: 30, stacking: 'stack', maxStacks: 5, tags: ['debuff'] },
  }).defs,
);

/** One party of `size` units, each with three auras (two self triggers, one party trigger, one plain). */
const makeParty = (size: number) => {
  const bus = createBus({
    hit: (): Hit => ({ attacker: undefined, amount: 0 }),
    aura: (): AuraEvent<BenchGame> => createAuraEvent<BenchGame>(),
  });

  const holder: { procs?: ProcSystem<BenchGame> } = {};
  const party: Unit[] = [];

  const auras = createAuraSystem<BenchGame>({
    registry: AURAS,
    tags: defineAuraTags(['buff', 'debuff']),
    clocks: { world: createClock({ dt: 1 / 60 }) },
    host: { run: (procs, ctx) => holder.procs?.runAura(procs, ctx) },
  });

  const procs = createProcSystem<BenchGame>({
    kinds: createProcRegistry<BenchGame>(CORE_PROCS),
    auras,
    random: stream(7, 0x9e11),
    resources: ['gold'],

    host: {
      party: () => party,
      idOf: (unit) => unit.id,

      grant: (_unit, _resource, amount) => {
        counter.granted += amount;
      },
    },
  });

  holder.procs = procs;
  createTriggerSystem<BenchGame>({
    auras,
    procs,
    bus,

    events: {
      hit: triggerEvent<Hit, BenchGame>(bus.kind.hit, {
        unit: (hit) => hit.attacker,
        filters: { minAmount: (hit, least) => hit.amount >= least },
      }),
      aura: auraTriggerEvent<BenchGame>(bus.kind.aura),
    },
  });

  for (let id = 1; id <= size; id++) {
    const unit: Unit = { id, auras: auras.createState() };

    for (const name of ['zeal', 'banner', 'plain'] as const) {
      auras.apply(unit, AURAS.id[name] ?? never());
    }

    party.push(unit);
  }

  return { bus, procs, party };
};

/** Throws: the bench registry lost an aura. */
const never = (): never => {
  throw new Error('The bench registry lost an aura.');
};

/** Raises one hit by the party's first unit. */
const hitter = (game: ReturnType<typeof makeParty>) => () => {
  const payload = game.bus.payload(game.bus.kind.hit);

  payload.attacker = game.party[0];
  payload.amount = 10;
  game.bus.raise(game.bus.kind.hit, payload);
};

const SMALL = hitter(makeParty(5));
const LARGE = hitter(makeParty(25));
const LIST_GAME = makeParty(2);
const [SELF, OTHER] = LIST_GAME.party;

/** A prepared list of eight procs: auras landed and refreshed, a cleanse, grants, a group behind one roll. */
const LIST = LIST_GAME.procs.prepare(
  [
    applyAura('buff'),
    applyAura('debuff', { to: 'eventUnit' }),
    grant('gold', 1),
    removeByTag('debuff', { to: 'eventUnit' }),
    grant('gold', 1, { to: 'eventUnit' }),
    group([grant('gold', 1), applyAura('buff')], { chance: 0.5 }),
    grant('gold', 1, { to: 'party' }),
    applyAura('debuff', { to: 'eventUnit', stacks: 2 }),
  ],
  'bench list',
);

const ORIGIN = { self: SELF ?? never(), eventUnit: OTHER ?? never() };

/** The F4 benchmark tasks, each one operation per call of its function. */
export const PROC_TRIGGER_TASKS: readonly (readonly [string, () => void])[] = [
  ['trigger dispatch, owner + 4 party listeners', SMALL],
  ['trigger dispatch, owner + 24 party listeners', LARGE],
  [
    'proc list run, 8 prepared procs',
    () => {
      LIST_GAME.procs.run(LIST, ORIGIN);
    },
  ],
];
