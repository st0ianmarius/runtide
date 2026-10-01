import { type AuraBearer, type AuraState, createAuraSystem, defineAuras, defineAuraTags } from '../src/auras/index.ts';
import { createBus, createClock, stream } from '../src/core/index.ts';
import {
  type Blow,
  type BlowSpec,
  createDamageEvent,
  createDamageSystem,
  type DamageEvent,
  type DamageProcs,
  type DamageTypes,
  defineDamageKinds,
  defineMitigation,
  defineRollTable,
  type Force,
  TRUE_DAMAGE
} from '../src/damage/index.ts';
import { defineStats, hyperbolic, type StatView } from '../src/modifiers/index.ts';
import type { Proc } from '../src/procs/index.ts';

/** A bench unit: health, a stat column per stat, and its auras. */
interface Unit extends AuraBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its health. */
  hp: number;

  /** Its stats as a view. */
  readonly view: StatView;

  /** Its auras. */
  readonly auras: AuraState;
}

/** The bench game's types. */
interface BenchGame extends DamageTypes {
  /** A bench unit. */
  readonly bearer: Unit;

  /** Procs. */
  readonly proc: Proc<BenchGame>;

  /** No triggers. */
  readonly trigger: never;

  /** The bench stats. */
  readonly stat: 'power' | 'critChance' | 'critDamage' | 'blockChance' | 'armor' | 'taken';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** One tag. */
  readonly tag: 'ward';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** The framework's blow. */
  readonly blow: Blow<BenchGame>;

  /** The framework's force. */
  readonly force: Force<BenchGame>;

  /** No game data. */
  readonly data: undefined;

  /** No game fields. */
  readonly ext: undefined;

  /** A payload is a number. */
  readonly payload: number;

  /** Open aura names. */
  readonly auraName: string;

  /** No resources. */
  readonly resource: never;

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** The damage kinds. */
  readonly gameProc: DamageProcs<BenchGame>;

  /** Two damage kinds. */
  readonly damageKind: 'physical' | 'pure';

  /** A spell is a number. */
  readonly spell: number;

  /** No game fields on a blow. */
  readonly blowExt: undefined;
}

const STATS = defineStats({
  power: { base: 1.2, kind: 'multiplier' },
  critChance: { base: 0.25, kind: 'flat' },
  critDamage: { base: 1.75, kind: 'multiplier' },
  blockChance: { base: 0.1, kind: 'flat' },
  armor: { base: 80, kind: 'flat' },
  taken: { base: 1.05, kind: 'multiplier' }
});

/** A stat view over the table's bases: what every bench unit reads. */
const BASE_VIEW: StatView = {
  total: (stat) => STATS.columns.base[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0
};

/** A damage-taken change, made once as a game would: a hook that returns a constant allocates nothing. */
const GUARDED = Object.freeze({ scale: 0.9 });

/** Three auras hooking the target's pipeline: an ignore gate that passes, a large absorb, a damage-taken scale. */
const AURAS = defineAuras<BenchGame, string>({
  gate: { duration: 'infinite', onIgnore: () => false },
  shell: {
    duration: 'infinite',
    value: 1e12,
    keepWhenDepleted: true,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount * 0.25) })
  },
  guard: { duration: 'infinite', onIncomingDamage: () => GUARDED }
});

const MAIN = stream(12_345, 0xda);
const bus = createBus({ taken: (): DamageEvent<BenchGame> => createDamageEvent<BenchGame>() });

/** Everything the benchmarks count, so no work is optimised away. */
export const damageCounter = { taken: 0, amount: 0 };

bus.on(bus.kind.taken, (event) => {
  damageCounter.taken += event.blow === undefined ? 0 : 1;
});

const auras = createAuraSystem<BenchGame>({
  registry: AURAS,
  tags: defineAuraTags(['ward']),
  clocks: { world: createClock({ dt: 1 / 60 }) }
});

const damage = createDamageSystem<BenchGame>({
  auras,
  kinds: defineDamageKinds({ physical: {}, pure: TRUE_DAMAGE }),
  stats: STATS,
  outgoing: ['power'],
  rolls: defineRollTable(STATS, {
    mode: 'independent',
    rows: {
      block: { effect: 'block', chance: { stat: 'blockChance', of: 'defender' } },
      crit: { effect: 'scale', chance: 'critChance', multiplier: 'critDamage', isCrit: true }
    }
  }),
  mitigation: defineMitigation({
    armor: {
      kinds: ['physical'],
      rating: 'armor',
      curve: hyperbolic({ k: 100, negative: 'amplify' })
    },
    taken: { kinds: ['physical'], multiplier: 'taken' }
  }),
  events: { bus, taken: bus.kind.taken },

  host: {
    health: (unit) => unit.hp,

    setHealth: (unit, hp) => {
      unit.hp = hp;
    },

    statsOf: (unit) => unit.view,
    idOf: (unit) => unit.id,
    roll: () => MAIN()
  }
});

/** Makes a unit with health that no bench blow empties, holding the three hooking auras when `isHooked`. */
const makeUnit = (id: number, isHooked: boolean): Unit => {
  const unit: Unit = { id, hp: 1e15, view: BASE_VIEW, auras: auras.createState() };

  if (isHooked) {
    for (const aura of AURAS.ids) {
      auras.apply(unit, aura);
    }
  }

  return unit;
};

const ATTACKER = makeUnit(1, false);
const TARGET = makeUnit(2, true);
const CROWD = Array.from({ length: 100 }, (_unused, index) => makeUnit(10 + index, true));

/** A reused blow spec: the attacker hits `target` for 40. */
const SPEC: { -readonly [Key in keyof BlowSpec<BenchGame>]: BlowSpec<BenchGame>[Key] } = {
  target: TARGET,
  amount: 40,
  attacker: ATTACKER,
  spell: 3
};

/** One blow through the full pipeline onto a target whose three auras hook it. */
const oneBlow = (): void => {
  SPEC.target = TARGET;
  damageCounter.amount += damage.hit(SPEC).amount;
};

/** A burst: one blow on each of 100 hooked targets. */
const burst = (): void => {
  for (const target of CROWD) {
    SPEC.target = target;
    damageCounter.amount += damage.hit(SPEC).amount;
  }
};

/** The F5 benchmark tasks, and how many operations each call of its function is. */
export const DAMAGE_TASKS: readonly (readonly [string, () => void])[] = [
  ['blow, full pipeline, 3 hooking auras', oneBlow],
  ['burst of 100 blows on 100 hooked targets', burst]
];
