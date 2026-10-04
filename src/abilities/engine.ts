import type { AuraSystem } from '../auras/index.ts';
import type { StatView } from '../modifiers/index.ts';
import {
  type CastOptions,
  type GateAnswer,
  OPEN_WORLD,
  type SpellContext,
  type SpellId,
  type SpellSystem,
  type StaticWorld
} from '../spells/index.ts';
import { MirrorContext } from '../spells/mirror.ts';
import type { AbilityTypes, ButtonRefusal, PressRefusal } from './ability-types.ts';
import { compileButtons, type CompiledButton } from './buttons.ts';
import type { SlotTable } from './slots.ts';

/** What a cast's `onAdmit` is: a last gate, asked with the admitted cast. */
type AdmitHook<G extends AbilityTypes> = (cast: SpellContext<G>) => GateAnswer<G>;

/** The options a button casts with, reused: the cast order reads them before any hook runs. */
class PressOptions<G extends AbilityTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  key: number | undefined = undefined;
  rank: number | undefined = undefined;
  committed = false;
  onAdmit: AdmitHook<G> | undefined = undefined;
}

/** What a nested press saves of the press it interrupts, and gives back as it leaves: one record per level. */
class SavedPress<G extends AbilityTypes> {
  input: G['input'] | undefined = undefined;
  key: number | undefined = undefined;
  refusal: PressRefusal<G> | undefined = undefined;
  refusals: (PressRefusal<G> | undefined)[] | undefined = undefined;
  optionsInput: G['input'] | undefined = undefined;
  optionsKey: number | undefined = undefined;
  rank: number | undefined = undefined;
  committed = false;
  onAdmit: AdmitHook<G> | undefined = undefined;
  committing: CompiledButton<G> | undefined = undefined;
  admitRefusal: ButtonRefusal | undefined = undefined;
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

  /**
   * The caster's own rank of a spell, which the motion hooks' `ctx.rank` read for a button equipped with no rank: the
   * spell host's `rankOf`, which that button's cast reads. `undefined` (and an absent hook) gives rank 1.
   */
  readonly rankOf?: ((caster: G['bearer'], spell: SpellId) => number | undefined) | undefined;
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

  /** The key of the press being fired, which its cast cues carry; `undefined` for none, and outside a press. */
  key: number | undefined = undefined;

  /** Why the slot being fired did not fire, or why its committed cast was refused; `undefined` for neither. */
  refusal: PressRefusal<G> | undefined = undefined;

  /** Where the running press writes each pressed slot's refusal, by slot; none when the press asked for none. */
  refusals: (PressRefusal<G> | undefined)[] | undefined = undefined;

  /** Whether it runs on a prediction mirror: a press fires only the spells' cast cues, and casts nothing. */
  readonly isMirror: boolean;

  /** How many presses run, nested (a pet's button pressed from a hero's hook): each level has its own scratch. */
  depth = 0;

  /**
   * The button that commits on its cast whose cast is running on the server: its `onAdmit` commits it, then clears
   * this; `undefined` for none, or once it committed.
   */
  committing: CompiledButton<G> | undefined = undefined;

  /** Why the commit at a cast's `onAdmit` refused (its cost, a cooldown), which the cast reports as `gate`. */
  admitRefusal: ButtonRefusal | undefined = undefined;

  /** The `onAdmit` a cast of a button that commits on its cast is handed, made once (`firing.ts`). */
  admitHook: AdmitHook<G> | undefined = undefined;

  readonly #statsOf: AbilityParts<G>['statsOf'];
  readonly #rankOf: AbilityParts<G>['rankOf'];
  readonly #world: StaticWorld;

  /** The reused mirror contexts, one per press level, so a nested press leaves the outer hook's context alone. */
  readonly #mirrors: MirrorContext<G>[] = [];

  /** The spell each slot of the running press was decided against, one list per press level; -1 for none. */
  readonly #decided: number[][] = [];

  /** What each press level saved of the one it interrupted. */
  readonly #saved: SavedPress<G>[] = [];

  /** The state of the engine when no press is running on it, never written. */
  readonly #idle = new SavedPress<G>();

  constructor(parts: AbilityParts<G>) {
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.slots = parts.slots;
    this.buttons = compileButtons(parts.spells, parts.auras);
    this.#statsOf = parts.statsOf;
    this.#rankOf = parts.rankOf;
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
   * press's input and rank (the slot's, else the caster's own, else 1), and the step. Read it within the hook.
   */
  mirrorFor(bearer: G['bearer'], spell: SpellId): MirrorContext<G> {
    const mirror = (this.#mirrors[this.depth] ??= new MirrorContext<G>(this.#world, bearer));

    mirror.bearer = bearer;
    mirror.stats = this.#statsOf?.(bearer, spell);
    mirror.input = this.input;
    mirror.rank = this.options.rank ?? this.#rankOf?.(bearer, spell) ?? 1;
    mirror.dt = this.dt;

    return mirror;
  }

  /** Starts a press level, saving a nested press's outer state (the press it interrupted) to give back on `leave`. */
  enter(): void {
    if (this.depth > 0) {
      const saved = (this.#saved[this.depth] ??= new SavedPress<G>());
      const { options } = this;

      saved.input = this.input;
      saved.key = this.key;
      saved.refusal = this.refusal;
      saved.refusals = this.refusals;
      saved.optionsInput = options.input;
      saved.optionsKey = options.key;
      saved.rank = options.rank;
      saved.committed = options.committed;
      saved.onAdmit = options.onAdmit;
      saved.committing = this.committing;
      saved.admitRefusal = this.admitRefusal;
    }

    this.depth += 1;
  }

  /** Ends a press level: a nested press gives back the state `enter` saved, the outermost leaves the engine idle. */
  leave(): void {
    this.depth -= 1;

    const saved = (this.depth > 0 ? this.#saved[this.depth] : undefined) ?? this.#idle;
    const { options } = this;

    this.input = saved.input;
    this.key = saved.key;
    this.refusal = saved.refusal;
    this.refusals = saved.refusals;
    options.input = saved.optionsInput;
    options.key = saved.optionsKey;
    options.rank = saved.rank;
    options.committed = saved.committed;
    options.onAdmit = saved.onAdmit;
    this.committing = saved.committing;
    this.admitRefusal = saved.admitRefusal;
  }

  /** The spells the running press decided its slots against, by slot. */
  decided(): number[] {
    return (this.#decided[this.depth] ??= []);
  }
}
