import {
  type AuraBearer,
  type AuraContext,
  type AuraDef,
  type AuraId,
  type AuraState,
  type AuraSystem,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags
} from '../../src/auras/index.ts';
import { createBus } from '../../src/core/index.ts';
import {
  type Blow,
  createDamageEvent,
  createDamageSystem,
  createDeathEvent,
  createHealEvent,
  type DamageEvent,
  type DamageHost,
  type DamageProcs,
  type DamageSystem,
  type DamageSystemOptions,
  type DamageTypes,
  type DeathEvent,
  defineDamageKinds,
  defineMitigation,
  defineRollTable,
  type Force,
  type Heal,
  type HealEvent,
  TRUE_DAMAGE
} from '../../src/damage/index.ts';
import { defineStats, hyperbolic, type StatId, type StatView } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, type Proc, type ProcSystem } from '../../src/procs/index.ts';
import type { TriggerDef, TriggerTypes } from '../../src/triggers/index.ts';

/** A test unit: an entity id, health, a stat column per stat, and its auras. */
interface Unit extends AuraBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its health. */
  hp: number;

  /** Its maximum health. */
  maxHp: number;

  /** Its stat totals, by stat id (the tests write them directly). */
  readonly stats: Float64Array;

  /** Its auras. */
  readonly auras: AuraState;
}

/** A test blow's own fields. */
interface BlowFields {
  /** A share of the target's maximum health a game stage adds. */
  readonly crushing: number;
}

/** The test game's types. */
export interface Game extends DamageTypes, TriggerTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** The game's procs. */
  readonly proc: Proc<Game>;

  /** The game's triggers. */
  readonly trigger: TriggerDef<Game>;

  /** The damage system's five events. */
  readonly event: 'dealt' | 'taken' | 'healed' | 'death' | 'kill';

  /** The damage trigger events' filters. */
  readonly filter: 'crit' | 'direct' | 'status' | 'damageKind' | 'minAmount' | 'spell';

  /** The test stats. */
  readonly stat: StatName;

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** Two tags. */
  readonly tag: 'wound' | 'ward';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** The framework's blow. */
  readonly blow: Blow<Game>;

  /** The framework's heal. */
  readonly heal: Heal<Game>;

  /** The game's own aura hooks: a threat hook, answering the threat its aura adds. */
  readonly auraHooks: {
    /** The threat an aura adds. */
    readonly onThreat: (ctx: AuraContext<Game>) => number;
  };

  /** The framework's force. */
  readonly force: Force<Game>;

  /** No game data. */
  readonly data: undefined;

  /** No game fields. */
  readonly ext: undefined;

  /** A payload is a number. */
  readonly payload: number;

  /** Aura names are open strings. */
  readonly auraName: string;

  /** No resources. */
  readonly resource: never;

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** The damage system's kinds. */
  readonly gameProc: DamageProcs<Game>;

  /** Three damage kinds. */
  readonly damageKind: 'physical' | 'fire' | 'pure';

  /** A spell is its number. */
  readonly spell: number;

  /** A blow's game fields: a crushing share, which a game stage adds. */
  readonly blowExt: BlowFields | undefined;
}

/** The test stats. */
export const STATS = defineStats({
  power: { base: 1, kind: 'multiplier' },
  critChance: { base: 0, kind: 'flat' },
  critDamage: { base: 2, kind: 'multiplier' },
  blockChance: { base: 0, kind: 'flat' },
  armor: { base: 0, kind: 'flat' },
  armorPen: { base: 0, kind: 'multiplier', neutral: 0 },
  lethality: { base: 0, kind: 'flat' },
  taken: { base: 1, kind: 'multiplier' },
  healing: { base: 1, kind: 'multiplier' },
  healingDone: { base: 1, kind: 'multiplier' },
  regen: { base: 0, kind: 'flat' },
  maxHealth: { base: 100, kind: 'flat' }
});

/** The name of a test stat. */
type StatName = keyof typeof STATS.id;

/** The test damage kinds: two that mitigation covers, and true damage. */
export const KINDS = defineDamageKinds({ physical: {}, fire: {}, pure: TRUE_DAMAGE });

/** The defender's block row: a flat chance of the target's, which ends the blow blocked. */
const BLOCK_ROW = { effect: 'block', chance: { stat: 'blockChance', of: 'defender' } } as const;

/** The attacker's crit row: its chance and its crit damage. */
const CRIT_ROW = {
  effect: 'scale',
  chance: 'critChance',
  multiplier: 'critDamage',
  isCrit: true
} as const;

/** Independent rolls: the defender's block only. */
export const BLOCK = defineRollTable(STATS, { mode: 'independent', rows: { block: BLOCK_ROW } });

/** Independent rolls: the attacker's crit only. */
export const CRIT = defineRollTable(STATS, { mode: 'independent', rows: { crit: CRIT_ROW } });

/** Independent rolls in swarm's order: the defender's block, then the attacker's crit. */
export const BLOCK_THEN_CRIT = defineRollTable(STATS, {
  mode: 'independent',
  rows: { block: BLOCK_ROW, crit: CRIT_ROW }
});

/** The test mitigation rows: armor on physical (LoL's curve), then damage taken on both mitigated kinds. */
const MITIGATION = defineMitigation({
  armor: {
    kinds: ['physical'],
    rating: 'armor',
    curve: hyperbolic({ k: 100, negative: 'amplify' })
  },
  taken: { kinds: ['physical', 'fire'], multiplier: 'taken' }
});

/** The test tags. */
const TAGS = defineAuraTags(['wound', 'ward']);

/** `defineAura` fixed to the test types. */
export const aura = defineAura<Game>;

/** The test bus: the damage system's five events. */
const makeBus = () =>
  createBus({
    dealt: (): DamageEvent<Game> => createDamageEvent<Game>(),
    taken: (): DamageEvent<Game> => createDamageEvent<Game>(),
    healed: (): HealEvent<Game> => createHealEvent<Game>(),
    death: (): DeathEvent<Game> => createDeathEvent<Game>(),
    kill: (): DeathEvent<Game> => createDeathEvent<Game>()
  });

/** The test game's bus. */
type TestBus = ReturnType<typeof makeBus>;

/** The spell every stats read was scoped to, in order; a test clears it. */
export const STAT_SPELLS: unknown[] = [];

/** Overrides of the damage system's options (the auras, kinds and host are the helper's). */
export type DamageOverrides = Partial<Omit<DamageSystemOptions<Game>, 'auras' | 'kinds'>>;

/** A small damage test game. */
export interface DamageGame<Name extends string> {
  /** Its aura system. */
  readonly auras: AuraSystem<Game>;

  /** Its damage system. */
  readonly damage: DamageSystem<Game>;

  /** Its proc system, with the core kinds and the damage kinds. */
  readonly procs: ProcSystem<Game>;

  /** Its bus. */
  readonly bus: TestBus;

  /** The id of every aura, by name. */
  readonly id: Readonly<Record<Name, AuraId>>;

  /** Everything the host and the listeners saw, as lines. */
  readonly log: string[];

  /** The draws `host.roll` returns in turn (then 0.99); each draw is logged. */
  readonly rolls: number[];

  /** The units made so far, by entity id. */
  readonly units: Map<number, Unit>;

  /** The spells' shares of outgoing stats, by `spell:statId`; a missing one is a share of 1. */
  readonly shares: Map<string, number>;

  /** Makes a unit with 100 health. */
  readonly unit: (id: number) => Unit;

  /** A stat's id. */
  readonly stat: (name: StatName) => StatId;

  /** Sets one of a unit's stats. */
  readonly set: (unit: Unit, name: StatName, value: number) => void;
}

/** A unit's stats as a view: its columns, with the table's bases. */
const viewOf = (unit: Unit): StatView => ({
  total: (stat) => unit.stats[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0
});

/** The per-unit stat views, made once each. */
const VIEWS = new WeakMap<Unit, StatView>();

/**
 * A small damage test game over aura `defs`: an aura system (one world clock), the damage system over the test stats,
 * kinds and mitigation with a host that logs, a proc system with the core and damage kinds (aura hook procs run
 * through it), and a bus with the five damage events, every one logged.
 */
export const makeDamageGame = <const Name extends string>(
  defs: Readonly<Record<Name, AuraDef<Game>>>,
  overrides: DamageOverrides = {},
  hostExtras: Partial<DamageHost<Game>> = {}
): DamageGame<Name> => {
  const log: string[] = [];
  const rolls: number[] = [];
  const units = new Map<number, Unit>();
  const shares = new Map<string, number>();
  const bus = makeBus();
  const registry = defineAuras(defs);
  const late: { procs?: ProcSystem<Game> } = {};

  const auras = createAuraSystem<Game>({
    registry,
    tags: TAGS,
    clocks: { world: { dt: 0.125 } },
    host: { run: (list, ctx) => late.procs?.runAura(list, ctx) }
  });

  const damage = createDamageSystem<Game>({
    auras,
    kinds: KINDS,
    stats: STATS,
    mitigation: MITIGATION,
    events: {
      bus,
      dealt: bus.kind.dealt,
      taken: bus.kind.taken,
      healed: bus.kind.healed,
      death: bus.kind.death,
      kill: bus.kind.kill
    },

    host: {
      health: (unit) => unit.hp,

      setHealth: (unit, hp) => {
        unit.hp = hp;
      },

      maxHealth: (unit) => unit.maxHp,

      statsOf: (unit, spell) => {
        STAT_SPELLS.push(spell);

        return VIEWS.get(unit) ?? viewOf(unit);
      },

      idOf: (unit) => unit.id,
      shareOf: (spell, stat) => shares.get(`${spell}:${stat}`),
      unitOf: (source) => units.get(source),
      run: (list, ctx) => late.procs?.runAura(list, ctx),

      roll: (slot) => {
        const draw = rolls.shift() ?? 0.99;

        log.push(`roll ${slot} ${draw}`);

        return draw;
      },

      applyForce: (force) => {
        log.push(`force ${force.kind} ${force.amount}@${force.target.id}`);
      },

      remove: (unit) => {
        log.push(`remove@${unit.id}`);
      },

      ...hostExtras
    },

    ...overrides
  });

  const procs = createProcSystem<Game>({
    kinds: createProcRegistry<Game>({ ...CORE_PROCS, ...damage.procKinds }),
    auras,
    host: { idOf: (unit) => unit.id }
  });

  late.procs = procs;

  const unit = (id: number): Unit => {
    const made: Unit = {
      id,
      hp: 100,
      maxHp: 100,
      stats: Float64Array.from(STATS.columns.base),
      auras: auras.createState()
    };

    VIEWS.set(made, viewOf(made));
    units.set(id, made);

    return made;
  };

  return {
    auras,
    damage,
    procs,
    bus,
    id: registry.id,
    log,
    rolls,
    units,
    shares,
    unit,
    stat: (name) => STATS.id[name],

    set: (target, name, value) => {
      target.stats[STATS.id[name]] = value;
    }
  };
};
