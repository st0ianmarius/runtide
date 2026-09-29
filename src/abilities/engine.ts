import type { AuraSystem } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { StatId, StatView } from '../modifiers/index.ts';
import type { CastOptions, MirrorCtx, SpellId, SpellSystem, StaticWorld } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';
import { compileButtons, type CompiledButton } from './buttons.ts';
import type { SlotTable } from './slots.ts';

/** The options a button casts with, reused: the cast order reads them before any hook runs. */
class PressOptions<G extends AbilityTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  rank = 1;
}

/** A stat view of a stat table's bases: what a cooldown reads with no stats host, and in a preview. */
class BaseView implements StatView {
  readonly #bases: ArrayLike<number>;

  constructor(bases: ArrayLike<number>) {
    this.#bases = bases;
  }

  total(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }

  base(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }
}

/** A static world with no geometry and no bounds: every line is clear and every move is made in full. */
const OPEN_WORLD: StaticWorld = Object.freeze({
  bounds: Object.freeze({
    minX: Number.NEGATIVE_INFINITY,
    minZ: Number.NEGATIVE_INFINITY,
    maxX: Number.POSITIVE_INFINITY,
    maxZ: Number.POSITIVE_INFINITY,
  }),

  lineClear: () => true,
  isPositionClear: () => true,
  clamp: (p: Vec2) => p,
  moveBody: ([, to]: readonly [Vec2, Vec2]) => ({ position: to, hit: false, share: 1 }),
});

/** The one mirror context of an engine, reused for every motion hook (they never nest). */
export class MirrorContext<G extends AbilityTypes> implements MirrorCtx<G> {
  bearer: G['bearer'];
  input: G['input'] | undefined = undefined;
  stats: StatView | undefined = undefined;
  readonly world: StaticWorld;
  dt = 0;

  constructor(world: StaticWorld, bearer: G['bearer']) {
    this.world = world;
    this.bearer = bearer;
  }
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

  /** The static world the motion hooks read (`MirrorCtx.world`); an open world, with nothing in it, when absent. */
  readonly world?: StaticWorld | undefined;

  /**
   * The caster's stats for one spell, which a scaled cooldown, a scaled `applies` and the motion hooks' `ctx.stats`
   * read; the bases when absent.
   */
  readonly statsOf?: ((caster: G['bearer'], spell: SpellId) => StatView | undefined) | undefined;
}

/** The ability system's state: its parts, every button compiled, each slot's cooldown aura, and reused scratch. */
export class AbilityEngine<G extends AbilityTypes> {
  readonly spells: SpellSystem<G>;
  readonly auras: AuraSystem<G>;
  readonly slots: SlotTable<G['slot']>;

  /** Every button spell's activation, compiled, by spell id. */
  readonly buttons: readonly (CompiledButton<G> | undefined)[];

  /** Each slot's cooldown aura, −1 for none. */
  readonly cooldowns: Int32Array;

  /** The view of the stat table's bases. */
  readonly baseView: StatView;

  /** The reused cast options. */
  readonly options = new PressOptions<G>();

  /** The clock's step. */
  readonly dt: number;

  /** The input of the press being fired, read at once by each slot's firing. */
  input: G['input'] | undefined = undefined;

  readonly #statsOf: AbilityParts<G>['statsOf'];
  readonly #world: StaticWorld;
  #mirror: MirrorContext<G> | undefined = undefined;

  constructor(parts: AbilityParts<G>) {
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.slots = parts.slots;
    this.buttons = compileButtons(parts.spells.registry, parts.auras);
    this.cooldowns = Int32Array.from(parts.slots.ids, (slot) => parts.slots.get(slot).cooldown ?? -1);
    this.baseView = new BaseView(parts.spells.registry.stats?.columns.base ?? []);
    this.#statsOf = parts.statsOf;
    this.dt = parts.clock.dt;
    this.#world = parts.world ?? OPEN_WORLD;

    for (const slot of parts.slots.ids) {
      const aura = parts.slots.get(slot).cooldown;
      const { registry } = parts.auras;

      if (aura !== undefined && (!(aura >= 0 && aura < registry.size) || registry.isRetired(aura))) {
        throw new RangeError(`Slot ${parts.slots.name(slot)}: its cooldown ${aura} is not a live aura.`);
      }
    }
  }

  /**
   * The reused mirror context for a motion hook of one spell, set to the bearer and its stats for the spell; the
   * caller sets its input and step. Read it within the hook.
   */
  mirrorFor(bearer: G['bearer'], spell: SpellId): MirrorContext<G> {
    const mirror = (this.#mirror ??= new MirrorContext<G>(this.#world, bearer));

    mirror.bearer = bearer;
    mirror.stats = this.#statsOf?.(bearer, spell);

    return mirror;
  }

  /** A caster's stats for one spell; the bases for no caster (a preview) or no stats host. */
  viewOf(caster: G['bearer'] | undefined, spell: SpellId): StatView {
    return (caster === undefined ? undefined : this.#statsOf?.(caster, spell)) ?? this.baseView;
  }
}
