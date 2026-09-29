import {
  type AbilityBearer,
  type AbilityProcs,
  type AbilitySystem,
  type AbilityTypes,
  createAbilitySystem,
  defineSlots,
  type SlotTable,
} from '../../src/abilities/index.ts';
import {
  type AuraId,
  type AuraState,
  type AuraSystem,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import { createClock, type SimClock } from '../../src/core/index.ts';
import type { Vec2 } from '../../src/math/index.ts';
import { defineStats, type StatView } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, type Proc, type ProcSystem } from '../../src/procs/index.ts';
import {
  type AnySpellDef,
  type CasterState,
  createSpellSystem,
  defineSpell,
  defineSpells,
  type SpellId,
  type SpellProcs,
  type SpellSystem,
} from '../../src/spells/index.ts';

/** A test hero: an entity id, a place, a stat column per stat, its auras, casts and loadout. */
export interface Hero extends AbilityBearer {
  /** Its entity id. */
  readonly id: number;

  /** Where it stands. */
  at: Vec2;

  /** Where its dodge carries it, per second. */
  heading: Vec2;

  /** Its stat totals, by stat id (the tests write them directly). */
  readonly stats: Float64Array;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** The test host's own services. */
interface GameHost {
  /** What happened, as lines. */
  readonly log: string[];
}

/** The ability test game's types. */
export interface AbilityGame extends AbilityTypes {
  /** A test hero. */
  readonly bearer: Hero;

  /** The game's procs. */
  readonly proc: Proc<AbilityGame>;

  /** No triggers. */
  readonly trigger: never;

  /** The test stats. */
  readonly stat: 'power' | 'abilityHaste' | 'duration';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** The slots' cooldown tags, a stance and a root. */
  readonly tag: 'cooldown.dodge' | 'cooldown.skill' | 'cooldown.ultimate' | 'stance' | 'rooted';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** No blows. */
  readonly blow: never;

  /** No forces. */
  readonly force: never;

  /** No game data on auras. */
  readonly data: undefined;

  /** No game fields on auras. */
  readonly ext: undefined;

  /** No aura payloads. */
  readonly payload: undefined;

  /** Aura names are open strings. */
  readonly auraName: string;

  /** Cue names are open strings. */
  readonly cueName: string;

  /** No resources. */
  readonly resource: never;

  /** No named streams. */
  readonly stream: never;

  /** The test host's own services. */
  readonly host: GameHost;

  /** The spell and ability systems' kinds. */
  readonly gameProc: SpellProcs<AbilityGame> | AbilityProcs<AbilityGame>;

  /** Spell names are open strings. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

  /** What a press hands its cast: an aim point. */
  readonly input: Vec2;

  /** No interrupts. */
  readonly interrupt: never;

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No game fields on a cast. */
  readonly castExt: undefined;

  /** No game data on spells. */
  readonly spellData: undefined;

  /** The three test slots. */
  readonly slot: 'dodge' | 'skill' | 'ultimate';
}

/** The test stats: a flat power, ability haste on the haste curve, and a Duration multiplier. */
export const STATS = defineStats({
  power: { base: 10, kind: 'flat' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
  duration: { base: 1, kind: 'multiplier' },
});

/** `defineSpell` fixed to the test types. */
export const spell = defineSpell<AbilityGame>();

/** `defineAura` fixed to the test types. */
const aura = defineAura<AbilityGame>;

/** The test aura tags. */
const TAGS = defineAuraTags(['cooldown.dodge', 'cooldown.skill', 'cooldown.ultimate', 'stance', 'rooted']);

/**
 * The test auras: a cooldown per slot, a charge (stacks that add up), a two-second sprint, an endless stance and an
 * endless root.
 */
const AURAS = defineAuras<AbilityGame, string>({
  dodgeCooldown: aura({ duration: 1, tags: ['cooldown.dodge'] }),
  skillCooldown: aura({ duration: 1, tags: ['cooldown.skill'] }),
  ultimateCooldown: aura({ duration: 1, tags: ['cooldown.ultimate'] }),
  charge: aura({ duration: 'infinite', stacking: 'stack', maxStacks: 9 }),
  sprint: aura({ duration: 2 }),
  stance: aura({ duration: 'infinite', tags: ['stance'] }),
  root: aura({ duration: 'infinite', tags: ['rooted'] }),
});

/** The id of every test aura, by name. */
const AURA: Readonly<Record<string, AuraId>> = AURAS.id;

/** The id of a test aura by name, or a clear error. */
export const auraNamed = (name: string): AuraId => {
  const id = AURA[name];

  if (id === undefined) {
    throw new RangeError(`no test aura ${name}`);
  }

  return id;
};

/** The test slots, in press order: a dodge, a skill and an ultimate, each with its cooldown aura. */
const SLOTS = defineSlots({
  dodge: { cooldown: auraNamed('dodgeCooldown') },
  skill: { cooldown: auraNamed('skillCooldown') },
  ultimate: { cooldown: auraNamed('ultimateCooldown') },
});

/** The test clock's step: a quarter second, so a second is four steps. */
const STEP = 0.25;

/** A small ability test game. */
export interface AbilityTestGame<Spell extends string> {
  /** The clock. */
  readonly clock: SimClock;

  /** The aura system. */
  readonly auras: AuraSystem<AbilityGame>;

  /** The spell system. */
  readonly spells: SpellSystem<AbilityGame>;

  /** The proc system. */
  readonly procs: ProcSystem<AbilityGame>;

  /** The ability system. */
  readonly abilities: AbilitySystem<AbilityGame>;

  /** The id of every spell, by name. */
  readonly id: Readonly<Record<Spell, SpellId>>;

  /** What happened, as lines, for a test's hooks to write. */
  readonly log: string[];

  /** Makes a hero standing at `(id, 0)`, facing +x, with the table's base stats and an empty loadout. */
  readonly hero: (id: number) => Hero;

  /** Steps the clock `count` times (once by default), ticking every hero's auras. */
  readonly step: (count?: number) => void;
}

/** A hero's stats as a view: its columns, with the table's bases. */
const viewOf = (hero: Hero): StatView => ({
  total: (stat) => hero.stats[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0,
});

/**
 * A small ability test game over `defs`: a clock of 0.25 s steps, the test auras, a spell system, a proc system with
 * the core, spell and ability kinds, and an ability system over the three slots (the test slots when absent) whose
 * stats are each hero's.
 */
export const makeAbilityGame = <const Spell extends string>(
  defs: Readonly<Record<Spell, AnySpellDef<AbilityGame>>>,
  slots: SlotTable<AbilityGame['slot']> = SLOTS,
): AbilityTestGame<Spell> => {
  const log: string[] = [];
  const clock = createClock({ dt: STEP });
  const late: { procs?: ProcSystem<AbilityGame> } = {};
  const heroes: Hero[] = [];
  const host = { log, idOf: (hero: Hero) => hero.id, positionOf: (hero: Hero): Vec2 => hero.at, statsOf: viewOf };
  const registry = defineSpells<AbilityGame, Spell>(defs, { stats: STATS });

  /** Throws: the proc system is wired right after the systems that name it. */
  const missing = (): never => {
    throw new Error('The test proc system is not wired.');
  };

  const auras = createAuraSystem<AbilityGame>({
    registry: AURAS,
    tags: TAGS,
    clocks: { world: clock },
    host: { run: (list, ctx) => late.procs?.runAura(list, ctx) },
  });

  const spells = createSpellSystem<AbilityGame>({
    registry,
    auras,
    procs: () => late.procs ?? missing(),
    clock,
    host,
  });

  const abilities = createAbilitySystem<AbilityGame>({ spells, auras, slots, statsOf: viewOf });

  const procs = createProcSystem<AbilityGame>({
    kinds: createProcRegistry<AbilityGame>({ ...CORE_PROCS, ...spells.procKinds, ...abilities.procKinds }),
    auras,
    host,
  });

  late.procs = procs;

  return {
    clock,
    auras,
    spells,
    procs,
    abilities,
    id: registry.id,
    log,

    hero: (id) => {
      const made: Hero = {
        id,
        at: { x: id, z: 0 },
        heading: { x: 1, z: 0 },
        stats: Float64Array.from(STATS.columns.base),
        auras: auras.createState(),
        casts: spells.createCasterState(),
        loadout: abilities.createLoadout(),
      };

      heroes.push(made);

      return made;
    },

    step: (count = 1) => {
      for (let i = 0; i < count; i++) {
        clock.step();

        for (const hero of heroes) {
          auras.tick(hero, 'world');
          spells.step(hero);
        }
      }
    },
  };
};
