import { PROC_LANDED, PROC_REFUSED, PROC_SKIPPED, type ProcKindDef } from '../procs/index.ts';
import { rescaleClocks } from './auto.ts';
import type { CastOptions, CastReport } from './cast-request.ts';
import type { SpellEngine } from './engine.ts';
import { missing } from './missing.ts';
import type { AfterProc, CastSpellProc, RescaleClocksProc, SpellProcKinds } from './procs.ts';
import type { SpellId, SpellTagId, SpellTypes } from './spell-types.ts';

/** The options a `castSpell` proc casts with, reused: the cast order reads them before any hook runs. */
class ProcCastOptions<G extends SpellTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  rank = 1;
  variant = 0;
  source: number | undefined = undefined;
}

/** What the kinds reach: the engine, and the system's cast. */
interface KindParts<G extends SpellTypes> {
  /** The engine. */
  readonly engine: SpellEngine<G>;

  /** Starts a cast. */
  readonly cast: (caster: G['bearer'], spell: SpellId, options: CastOptions<G>) => CastReport;
}

/** A spell's id from its name or id: checked live at load (`isChecked`), looked up by name when it applies. */
const spellIdOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  spell: G['spellName'] | SpellId,
  isChecked: boolean,
): SpellId => {
  const { registry } = engine;

  if (typeof spell !== 'string') {
    if (isChecked && (!Number.isInteger(spell) || spell < 0 || spell >= registry.size || registry.isRetired(spell))) {
      throw new RangeError(`${spell} is not a live spell id.`);
    }

    return spell;
  }

  const ids: Readonly<Record<string, SpellId | undefined>> = registry.id;
  const id = ids[spell];

  if (id === undefined) {
    throw new RangeError(`unknown spell ${spell}.`);
  }

  return id;
};

/** The `castSpell` kind: the full cast order for the unit it lands on, at the running cast's rank by default. */
const castSpellKind = <G extends SpellTypes>(parts: KindParts<G>): ProcKindDef<CastSpellProc<G>, G> => {
  const { engine } = parts;
  const options = new ProcCastOptions<G>();

  return {
    targetOf: (proc) => proc.by ?? 'self',

    apply: (proc, ctx, caster) => {
      if (caster === undefined) {
        return PROC_SKIPPED;
      }

      const parent = engine.current;

      options.input = proc.inputOf === undefined ? proc.input : proc.inputOf(ctx);
      options.rank = proc.rank ?? parent?.rank ?? 1;
      options.variant = parent?.variant ?? 0;
      options.source = ctx.source;

      const { status } = parts.cast(caster, spellIdOf(engine, proc.spell, false), options);

      options.input = undefined;

      return status === 'refused' ? PROC_REFUSED : PROC_LANDED;
    },

    prepare: (proc) => ({ ...proc, spell: spellIdOf(engine, proc.spell, true) }),

    explain: (proc) => ({
      values: {
        spell: spellIdOf(engine, proc.spell, false),
        ...(proc.rank === undefined ? {} : { rank: proc.rank }),
      },
    }),
  };
};

/** Throws unless an `after` proc's seconds and slot are sound. */
const checkAfter = <G extends SpellTypes>(engine: SpellEngine<G>, proc: AfterProc<G>): void => {
  if (!(proc.seconds >= 0) || !Number.isFinite(proc.seconds)) {
    throw new RangeError(`an after proc waits a finite number of seconds from 0; got ${proc.seconds}.`);
  }

  if (proc.slot !== undefined && !(proc.slot >= 0 && proc.slot < engine.delayed.slots)) {
    throw new RangeError(`an after proc's slot ${proc.slot} is not one of the system's ${engine.delayed.slots}.`);
  }
};

/** The `after` kind: schedules its procs on the timing wheel of its slot. */
const afterKind = <G extends SpellTypes>(engine: SpellEngine<G>): ProcKindDef<AfterProc<G>, G> => ({
  apply: (proc, ctx) => {
    checkAfter(engine, proc);
    engine.delayed.schedule(ctx, proc);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => {
    checkAfter(engine, proc);

    return { ...proc, procs: resolve.procs(proc.procs) };
  },

  explain: (proc) => ({ values: { seconds: proc.seconds }, procs: proc.procs }),
});

/** A spell tag's id from its name or id; `undefined` for none. Throws for an unknown name. */
const tagIdOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  tag: G['spellTag'] | SpellTagId | undefined,
): SpellTagId | undefined => {
  if (tag === undefined || typeof tag !== 'string') {
    return tag;
  }

  const ids: Readonly<Record<string, SpellTagId | undefined>> = engine.registry.tags.id;

  return ids[tag] ?? missing(`spell tag ${tag}`);
};

/** Throws unless a rescale's factor is a finite number from 0. */
const checkRescale = <G extends SpellTypes>(proc: RescaleClocksProc<G>): void => {
  if (!(proc.factor >= 0) || !Number.isFinite(proc.factor)) {
    throw new RangeError(`a rescaleClocks proc takes a finite factor from 0; got ${proc.factor}.`);
  }
};

/** The `rescaleClocks` kind: rescales the clocks of the unit it lands on; `skipped` when none were running. */
const rescaleKind = <G extends SpellTypes>(engine: SpellEngine<G>): ProcKindDef<RescaleClocksProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, _ctx, unit) => {
    if (unit === undefined) {
      return PROC_SKIPPED;
    }

    const scope = tagIdOf(engine, proc.tag) ?? -1;
    const rescaled = rescaleClocks(engine, unit, { factor: proc.factor, scope, isPendingOnly: proc.clocks !== 'all' });

    return rescaled === 0 ? PROC_SKIPPED : PROC_LANDED;
  },

  prepare: (proc) => {
    checkRescale(proc);

    const tag = tagIdOf(engine, proc.tag);

    return tag === undefined ? proc : { ...proc, tag };
  },

  explain: (proc) => ({
    values: { factor: proc.factor, ...(proc.tag === undefined ? {} : { tag: tagIdOf(engine, proc.tag) ?? -1 }) },
  }),
});

/** Builds the spell system's proc kinds over its engine. */
export const createSpellProcKinds = <G extends SpellTypes>(parts: KindParts<G>): SpellProcKinds<G> =>
  Object.freeze({
    castSpell: castSpellKind(parts),
    after: afterKind(parts.engine),
    rescaleClocks: rescaleKind(parts.engine),
  });
