import type { AuraState } from '../../src/auras/index.ts';
import type { Blow, DamageProcs, DamageTypes, Force } from '../../src/damage/index.ts';
import type { Vec2 } from '../../src/math/index.ts';
import { defineStats } from '../../src/modifiers/index.ts';
import type { Proc } from '../../src/procs/index.ts';
import {
  type CasterState,
  defineSpell,
  defineSpellTags,
  type SpellCaster,
  type SpellId,
  type SpellTypes,
} from '../../src/spells/index.ts';
import type { TriggerDef, TriggerTypes } from '../../src/triggers/index.ts';

/** A test unit: an entity id, a place, health, a stat column per stat, its auras and its casts. */
export interface Unit extends SpellCaster {
  /** Its entity id. */
  readonly id: number;

  /** Where it stands. */
  readonly at: Vec2;

  /** Its health. */
  hp: number;

  /** Its stat totals, by stat id (the tests write them directly). */
  readonly stats: Float64Array;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** A cast's game fields (§I.5.6 hatch 4). */
export interface CastFields {
  /** A counter the tests write. */
  hits: number;
}

/** The test game's types. */
export interface Game extends SpellTypes, DamageTypes, TriggerTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** The game's procs. */
  readonly proc: Proc<Game>;

  /** The game's triggers. */
  readonly trigger: TriggerDef<Game>;

  /** The spell events, as trigger events. */
  readonly event: 'spellStart' | 'spellRelease' | 'spellHit' | 'spellEnd';

  /** The spell trigger events' filters. */
  readonly filter: 'spell' | 'tag' | 'outcome';

  /** The test stats. */
  readonly stat: StatName;

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** One tag. */
  readonly tag: 'busy';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** The framework's blow. */
  readonly blow: Blow<Game>;

  /** The framework's force. */
  readonly force: Force<Game>;

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

  /** Two named streams: a sequential one and a keyed one. */
  readonly stream: 'main' | 'crit';

  /** No game services. */
  readonly host: object;

  /** The damage system's kinds. */
  readonly gameProc: DamageProcs<Game>;

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No game fields on a blow. */
  readonly blowExt: undefined;

  /** Spell names are open strings. */
  readonly spellName: string;

  /** The test spell tags. */
  readonly spellTag: 'fire' | 'area' | 'melee';

  /** What a cast is handed: a unit to aim at, or nothing. */
  readonly input: Unit;

  /** Two interrupts. */
  readonly interrupt: 'stun' | 'death';

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** A cast's game fields: a counter the tests write. */
  readonly castExt: CastFields;

  /** No game data on spells. */
  readonly spellData: undefined;
}

/** The test stats: a flat power, a multiplier damage bonus, haste, and the target's maximum health. */
export const STATS = defineStats({
  power: { base: 10, kind: 'flat' },
  damage: { base: 1, kind: 'multiplier' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
  maxHealth: { base: 100, kind: 'flat' },
});

/** The name of a test stat. */
type StatName = keyof typeof STATS.id;

/** The test spell tags. */
export const SPELL_TAGS = defineSpellTags(['fire', 'area', 'melee']);

/** `defineSpell` fixed to the test types. */
export const spell = defineSpell<Game>();
