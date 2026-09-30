import {
  type AbilityBearer,
  type AbilityTypes,
  createAbilitySystem,
  defineSlots,
  type LoadoutState,
} from '../src/abilities/index.ts';
import { type AuraState, createAuraSystem, defineAura, defineAuras, defineAuraTags } from '../src/auras/index.ts';
import { createClock } from '../src/core/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, grant, type Proc } from '../src/procs/index.ts';
import { type CasterState, createSpellSystem, defineSpells, type SpellProcs } from '../src/spells/index.ts';

/** A bench hero: an entity id, its auras, casts and loadout, and how far its dodge carried it. */
interface Hero extends AbilityBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;

  /** Its loadout. */
  readonly loadout: LoadoutState;

  /** Metres its dodges carried it. */
  travelled: number;
}

/** The bench game's types. */
interface BenchGame extends AbilityTypes {
  /** A bench hero. */
  readonly bearer: Hero;

  /** Procs. */
  readonly proc: Proc<BenchGame>;

  /** No triggers. */
  readonly trigger: never;

  /** No stats. */
  readonly stat: never;

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** Each slot's cooldown tag, and a sprint. */
  readonly tag: 'cooldown.dodge' | 'cooldown.skill' | 'cooldown.ultimate' | 'sprinting';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** No blows. */
  readonly blow: never;

  /** No forces. */
  readonly force: never;

  /** No game data. */
  readonly data: undefined;

  /** No game fields. */
  readonly ext: undefined;

  /** No payloads. */
  readonly payload: undefined;

  /** Open aura names. */
  readonly auraName: string;

  /** Open cue names. */
  readonly cueName: string;

  /** One resource, which every cast grants. */
  readonly resource: 'focus';

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** The spell and ability systems' kinds. */
  readonly gameProc: SpellProcs<BenchGame>;

  /** Open spell names. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

  /** No input. */
  readonly input: undefined;

  /** No interrupts. */
  readonly interrupt: never;

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No game fields on a cast. */
  readonly castExt: undefined;

  /** No game data on a spell. */
  readonly spellData: undefined;

  /** Three slots. */
  readonly slot: 'dodge' | 'skill' | 'ultimate';
}

/** How many resources the bench granted, so no call is optimised away. */
export const abilityCounter = { granted: 0 };

/** How many heroes press. */
const HEROES = 1000;

/** One grant, prepared once: what every cast releases. */
const GRANT: readonly Proc<BenchGame>[] = Object.freeze([grant<BenchGame>('focus', 1)]);

const aura = defineAura<BenchGame>;

const AURAS = defineAuras<BenchGame, string>({
  dodgeCooldown: aura({ duration: 1, tags: ['cooldown.dodge'] }),
  skillCooldown: aura({ duration: 1, tags: ['cooldown.skill'] }),
  ultimateCooldown: aura({ duration: 1, tags: ['cooldown.ultimate'] }),
  sprint: aura({ duration: 0.5, tags: ['sprinting'] }),
});

/** A bench aura's id by name. */
const auraId = (name: string) => {
  const id = AURAS.id[name];

  if (id === undefined) {
    throw new RangeError(`no bench aura ${name}`);
  }

  return id;
};

const SLOTS = defineSlots({
  dodge: { cooldown: auraId('dodgeCooldown') },
  skill: { cooldown: auraId('skillCooldown') },
  ultimate: { cooldown: auraId('ultimateCooldown') },
});

const SPELLS = defineSpells<BenchGame, 'roll' | 'nova' | 'surge'>({
  roll: {
    activation: {
      kind: 'button',
      cooldown: 1,
      applies: [auraId('sprint')],

      travel: ({ bearer, dt }) => {
        if (AURA_SYSTEM.hasTag(bearer, AURA_TAGS.id.sprinting)) {
          bearer.travelled += 8 * dt;
        }
      },
    },
    release: () => GRANT,
  },

  nova: { activation: { kind: 'button', cooldown: 2, blockedBy: ['sprinting'] }, release: () => GRANT },
  surge: { activation: { kind: 'button', cooldown: 4, resets: ['cooldown.dodge'] }, release: () => GRANT },
});

const CLOCK = createClock({ dt: 1 / 30 });
const AURA_TAGS = defineAuraTags(['cooldown.dodge', 'cooldown.skill', 'cooldown.ultimate', 'sprinting']);
const AURA_SYSTEM = createAuraSystem<BenchGame>({ registry: AURAS, tags: AURA_TAGS, clocks: { world: CLOCK } });

const HOST = {
  idOf: (hero: Hero) => hero.id,

  grant: (_hero: Hero, _resource: number, amount: number) => {
    abilityCounter.granted += amount;
  },
};

const late: { procs?: ReturnType<typeof createProcSystem<BenchGame>> } = {};

/** Throws: the proc system is wired right after the systems that name it. */
const missing = (): never => {
  throw new Error('The bench proc system is not wired.');
};

const SPELL_SYSTEM = createSpellSystem<BenchGame>({
  registry: SPELLS,
  auras: AURA_SYSTEM,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: HOST,
});

const ABILITIES = createAbilitySystem<BenchGame>({
  spells: SPELL_SYSTEM,
  auras: AURA_SYSTEM,
  slots: SLOTS,
  clock: CLOCK,
});

late.procs = createProcSystem<BenchGame>({
  kinds: createProcRegistry<BenchGame>({ ...CORE_PROCS, ...SPELL_SYSTEM.procKinds }),
  auras: AURA_SYSTEM,
  host: HOST,
  resources: ['focus'],
});

/** The heroes, each with the three abilities equipped. */
const HERO_LIST: readonly Hero[] = Array.from({ length: HEROES }, (_unused, i) => {
  const hero: Hero = {
    id: i + 1,
    auras: AURA_SYSTEM.createState(),
    casts: SPELL_SYSTEM.createCasterState(),
    loadout: ABILITIES.createLoadout(),
    travelled: 0,
  };

  ABILITIES.equip(hero, SLOTS.id.dodge, SPELLS.id.roll);
  ABILITIES.equip(hero, SLOTS.id.skill, SPELLS.id.nova);
  ABILITIES.equip(hero, SLOTS.id.ultimate, SPELLS.id.surge);

  return hero;
});

/** Every slot's bit: each hero holds all three buttons down. */
const ALL = ABILITIES.bit(SLOTS.id.dodge) | ABILITIES.bit(SLOTS.id.skill) | ABILITIES.bit(SLOTS.id.ultimate);

/** One motion step: the clock, then each hero's auras, its press and its travel. */
const pressTick = (): void => {
  CLOCK.step();

  for (const hero of HERO_LIST) {
    AURA_SYSTEM.tick(hero, 'world');
    ABILITIES.tryActivate(hero, ALL);
    ABILITIES.travel(hero, CLOCK.dt);
  }
};

for (let i = 0; i < 300; i++) {
  pressTick();
}

/** The F9 ability benchmark tasks, and how many operations each call of its function is. */
export const ABILITY_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['abilities: 1,000 heroes press 3 slots (tick)', pressTick, 1000],
];
