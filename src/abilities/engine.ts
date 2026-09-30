import type { AuraSystem } from '../auras/index.ts';
import type { StatView } from '../modifiers/index.ts';
import { type CastOptions, OPEN_WORLD, type SpellId, type SpellSystem, type StaticWorld } from '../spells/index.ts';
import { MirrorContext } from '../spells/mirror.ts';
import type { AbilityTypes, PressRefusal } from './ability-types.ts';
import { compileButtons, type CompiledButton } from './buttons.ts';
import type { SlotTable } from './slots.ts';

/** The options a button casts with, reused: the cast order reads them before any hook runs. */
class PressOptions<G extends AbilityTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  key = 0;
  rank = 1;
  committed = false;
}

/** What an ability system is built from: the spell and aura systems, the slots, and the caster's stats. */
export interface AbilityParts<G extends AbilityTypes> {
  /** The spell system its abilities cast through. */
  readonly spells: SpellSystem<G>;

  /** The aura system its cooldowns, costs and states live in. */
  readonly auras: AuraSystem<G>;

  /** The game's slots. */
  readonly slots: SlotTable<G['slot']>;

  /** The clock a press counts on: its step is a firing's `MirrorCtx.dt`. */
  readonly clock: {
    /** The fixed step, in seconds. */
    readonly dt: number;
  };

  /**
   * Whether this system runs on a prediction mirror: a press commits its motion half, cooldowns, cost and auras as on
   * the server, but fires only each spell's mirror-safe cast cue (`spells.predictCast`) with the press's key, and casts
   * nothing; a button that commits on its cast commits here only on its `checkCast`. False when absent.
   */
  readonly mirror?: boolean | undefined;

  /** The static world the motion hooks read (`MirrorCtx.world`); an open world, with nothing in it, when absent. */
  readonly world?: StaticWorld | undefined;

  /** The caster's stats for one spell, which the motion hooks' `ctx.stats` read; none when absent. */
  readonly statsOf?: ((caster: G['bearer'], spell: SpellId) => StatView | undefined) | undefined;
}

/** The ability system's state: its parts, every button compiled, and reused scratch. */
export class AbilityEngine<G extends AbilityTypes> {
  readonly spells: SpellSystem<G>;
  readonly auras: AuraSystem<G>;
  readonly slots: SlotTable<G['slot']>;

  /** Every button spell's activation, compiled, by spell id. */
  readonly buttons: readonly (CompiledButton<G> | undefined)[];

  /** The reused cast options. */
  readonly options = new PressOptions<G>();

  /** The clock's step. */
  readonly dt: number;

  /** The input of the press being fired, read at once by each slot's firing. */
  input: G['input'] | undefined = undefined;

  /** The key of the press being fired, which its cast cues carry; 0 outside a press. */
  key = 0;

  /** Why the slot being fired did not fire, or why its committed cast was refused; `undefined` for neither. */
  refusal: PressRefusal<G> | undefined = undefined;

  /** Where the running press writes each pressed slot's refusal, by slot; none when the press asked for none. */
  refusals: (PressRefusal<G> | undefined)[] | undefined = undefined;

  /** Whether it runs on a prediction mirror: a press fires only the spells' cast cues, and casts nothing. */
  readonly isMirror: boolean;

  readonly #statsOf: AbilityParts<G>['statsOf'];
  readonly #world: StaticWorld;
  #mirror: MirrorContext<G> | undefined = undefined;

  constructor(parts: AbilityParts<G>) {
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.slots = parts.slots;
    this.buttons = compileButtons(parts.spells, parts.auras);
    this.#statsOf = parts.statsOf;
    this.dt = parts.clock.dt;
    this.isMirror = parts.mirror === true;
    this.#world = parts.world ?? OPEN_WORLD;
  }

  /** Notes why the slot being fired did not fire; false, for the firing to return. */
  refuse(refusal: PressRefusal<G>): boolean {
    this.refusal = refusal;

    return false;
  }

  /**
   * The reused mirror context for a hook of the spell being pressed, set to the bearer, its stats for the spell, the
   * press's input and rank, and the step. Read it within the hook.
   */
  mirrorFor(bearer: G['bearer'], spell: SpellId): MirrorContext<G> {
    const mirror = (this.#mirror ??= new MirrorContext<G>(this.#world, bearer));

    mirror.bearer = bearer;
    mirror.stats = this.#statsOf?.(bearer, spell);
    mirror.input = this.input;
    mirror.rank = this.options.rank;
    mirror.dt = this.dt;

    return mirror;
  }
}
