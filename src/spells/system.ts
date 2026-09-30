import type { AuraId } from '../auras/index.ts';
import type { TickSlotId } from '../core/index.ts';
import type { StatId } from '../modifiers/index.ts';
import { armAuto, autoClockOf, type ClockScale, rescaleClocks, setAutoClock, stepAutoClocks } from './auto.ts';
import { engineOf, gameActivationsOf } from './build-engine.ts';
import { fireCastCue } from './cast-cue.ts';
import {
  type CastOptions,
  type CastRefusal,
  type CastReport,
  type CastRequest,
  MutableRequest,
  NO_OPTIONS,
  Report
} from './cast-request.ts';
import { CasterRecord, type CasterState, recordOf } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { SpellEngine } from './engine.ts';
import { hitCast } from './hit.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import { createSpellProcKinds } from './proc-kinds.ts';
import type { SpellProcKinds } from './procs.ts';
import { checkCast, startCast, startCooldowns } from './runner.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellSystem } from './spell-system.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import {
  cancelCast,
  cancelCaster,
  delayCast,
  finishCast,
  holdCast,
  interruptCaster,
  isCasting,
  MANUAL_PAUSE,
  setPause,
  stepCaster,
  unholdCast
} from './stepper.ts';
import type { SpellSystemOptions } from './system-options.ts';
import { type CastView, viewCast } from './view.ts';

/** A spell system: a class for fast properties, its functions arrow fields so they work detached. */
class Spells<G extends SpellTypes> implements SpellSystem<G> {
  readonly registry: SpellRegistry<G>;
  readonly pool: SpellSystem<G>['pool'];
  readonly delayed: SpellSystem<G>['delayed'];
  readonly procKinds: SpellProcKinds<G>;
  readonly gameActivations: readonly string[];
  readonly #engine: SpellEngine<G>;
  readonly #report = new Report<G>();
  readonly #cooldownAuras: readonly (readonly AuraId[])[];
  #request: MutableRequest<G> | undefined = undefined;

  constructor(engine: SpellEngine<G>) {
    this.#engine = engine;
    this.registry = engine.registry;
    this.#cooldownAuras = engine.registry.ids.map((id) =>
      Object.freeze(engine.cooldowns.of(id).map((cooldown) => cooldown.aura))
    );

    this.pool = {
      get created() {
        return engine.pool.created;
      },

      get live() {
        return engine.pool.live;
      }
    };
    this.delayed = {
      get pending() {
        return engine.delayed.size;
      },

      get created() {
        return engine.delayed.created;
      }
    };
    this.procKinds = createSpellProcKinds({ engine, cast: this.cast });
    this.gameActivations = gameActivationsOf(engine.registry.activations);
  }

  readonly createCasterState = (): CasterState => new CasterRecord();

  readonly cast = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastReport<G> =>
    startCast(this.#engine, this.#requestOf(caster, spell, options), this.#report);

  /** An auto clock's cast: the system's report, with the interval the clock reads. */
  readonly #castAuto = (caster: G['bearer'], spell: SpellId): Report<G> =>
    startCast(this.#engine, this.#requestOf(caster, spell, undefined), this.#report);

  /** The system's one request, rewritten: the cast order reads it before any hook runs, so a nested cast may reuse it. */
  #requestOf(caster: G['bearer'], spell: SpellId, options: CastOptions<G> | undefined): CastRequest<G> {
    const request = (this.#request ??= new MutableRequest<G>(caster, spell));

    request.caster = caster;
    request.spell = spell;
    request.options = options ?? NO_OPTIONS;

    return request;
  }

  readonly check = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastRefusal<G> | undefined =>
    checkCast(this.#engine, this.#requestOf(caster, spell, options));

  readonly cooldownsOf = (spell: SpellId): readonly AuraId[] => {
    this.registry.get(spell);

    return this.#cooldownAuras[spell] ?? [];
  };

  readonly isCooling = (caster: G['bearer'], spell: SpellId): boolean =>
    this.#engine.cooldowns.isCooling(caster, spell);

  readonly cooldownLeft = (caster: G['bearer'], spell: SpellId): number => this.#engine.cooldowns.left(caster, spell);

  readonly startCooldowns = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): void => {
    startCooldowns(this.#engine, this.#requestOf(caster, spell, options));
  };

  readonly predictCooldowns = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): void => {
    startCooldowns(this.#engine, this.#requestOf(caster, spell, options), true);
  };

  readonly hit = (cast: CastHandle, hit: SpellHit<G>): number => hitCast(this.#engine, cast, hit);

  readonly get = (cast: CastHandle): SpellContext<G> | undefined => this.#engine.castOf(cast);

  readonly isRunning = (cast: CastHandle): boolean => {
    const stage = this.#engine.castOf(cast)?.stage;

    return stage !== undefined && stage !== 'ended';
  };

  readonly isCasting = (caster: G['bearer'], spell?: SpellId): boolean => isCasting(this.#engine, caster, spell);

  readonly castsOf = (caster: G['bearer'], out: CastHandle[]): number => recordOf(caster).copyInto(out);

  readonly stepAuto = (caster: G['bearer']): void => {
    stepAutoClocks(this.#engine, caster, this.#castAuto);
  };

  readonly arm = (caster: G['bearer'], spell: SpellId, seconds = 0): boolean =>
    armAuto(this.#engine, caster, { spell, seconds });

  readonly disarm = (caster: G['bearer'], spell: SpellId): boolean => recordOf(caster).disarm(spell);

  readonly autoClock = (caster: G['bearer'], spell: SpellId): number =>
    autoClockOf(caster, [spell, this.#engine.clock.dt]);

  readonly setClock = (caster: G['bearer'], spell: SpellId, seconds: number): boolean =>
    setAutoClock(caster, [spell, seconds, this.#engine.clock.dt]);

  readonly stepDelayed = (slot?: TickSlotId): number => this.#engine.delayed.land(slot ?? 0);

  readonly step = (caster: G['bearer']): void => {
    stepCaster(this.#engine, caster);
  };

  readonly withdrawDelayed = (owner: G['bearer']): number => this.#engine.delayed.withdraw(owner);

  readonly pause = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: true });
  readonly resume = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: false });
  readonly cancel = (cast: CastHandle): boolean => cancelCast(this.#engine, cast);

  readonly finish = (cast: CastHandle, outcome: Exclude<CastOutcome<G>, 'cancelled'>): boolean =>
    finishCast(this.#engine, cast, outcome);

  readonly delay = (cast: CastHandle, seconds: number): boolean => delayCast(this.#engine, cast, seconds);

  readonly interrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: true });

  readonly endInterrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: false });

  readonly isInterrupted = (caster: G['bearer'], reason: G['interrupt']): boolean =>
    (recordOf(caster).interrupts & (this.#engine.interruptBits.get(reason) ?? 0)) !== 0;

  readonly cancelAll = (caster: G['bearer']): number => cancelCaster(this.#engine, caster);

  get current(): CastHandle {
    return this.#engine.current?.cast ?? NO_CAST;
  }

  readonly retain = (cast: CastHandle): boolean => holdCast(this.#engine, cast);

  readonly unretain = (cast: CastHandle): void => {
    unholdCast(this.#engine, cast);
  };

  readonly enter = (cast: CastHandle): CastHandle => {
    const engine = this.#engine;
    const previous = engine.current?.cast ?? NO_CAST;

    engine.current = engine.castOf(cast);

    return previous;
  };

  readonly leave = (previous: CastHandle): void => {
    this.#engine.current = this.#engine.castOf(previous);
  };

  readonly viewOf = (cast: CastHandle, out: CastView): boolean => viewCast(this.#engine, cast, out);

  readonly rescaleClocks = (caster: G['bearer'], rescale: ClockScale): number =>
    rescaleClocks(this.#engine, caster, rescale);

  readonly predictCast = (caster: G['bearer'], spell: SpellId, options: CastOptions<G> = NO_OPTIONS): boolean => {
    this.registry.get(spell);

    const rank = options.rank ?? this.#engine.host.rankOf?.(caster, spell) ?? 1;

    return fireCastCue(this.#engine, caster, [spell, options.input, options.key ?? 0, rank]);
  };

  readonly shareOf = (spell: SpellId, stat: StatId): number | undefined => {
    const share = this.registry.shares[spell]?.[stat];

    return share === undefined || Number.isNaN(share) ? undefined : share;
  };
}

/**
 * Creates the spell system over a game's spells: `createSpellSystem({ registry: SPELLS, auras, procs: () =>
 * procs, clock, host })`. Every plan is built at load; nothing is looked up by name
 * afterwards.
 */
export const createSpellSystem = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellSystem<G> =>
  Object.freeze(new Spells(engineOf(options)));
