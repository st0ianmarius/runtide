import { PROC_LANDED, PROC_REFUSED, PROC_SKIPPED, type ProcKindDef } from '../procs/index.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';
import type { AbilityEngine } from './engine.ts';
import { triggerButton } from './firing.ts';
import type { AbilityProcKinds, UseAbilityProc } from './procs.ts';

/** A button spell's id from its name or id: checked at load (`isChecked`), looked up by name when it applies. */
const buttonIdOf = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  spell: G['spellName'] | SpellId,
  isChecked: boolean,
): SpellId => {
  const { registry } = engine.spells;
  const ids: Readonly<Record<string, SpellId | undefined>> = registry.id;
  const id = typeof spell === 'string' ? ids[spell] : spell;

  if (id === undefined) {
    throw new RangeError(`unknown spell ${spell}.`);
  }

  if (isChecked && engine.buttons[id] === undefined) {
    throw new RangeError(`${registry.name(id)} is not a live button spell.`);
  }

  return id;
};

/** The `useAbility` kind: the trigger path for the unit it lands on. */
const useAbilityKind = <G extends AbilityTypes>(engine: AbilityEngine<G>): ProcKindDef<UseAbilityProc<G>, G> => ({
  targetOf: (proc) => proc.by ?? 'self',

  apply: (proc, ctx, bearer) => {
    if (bearer === undefined) {
      return PROC_SKIPPED;
    }

    const input = proc.inputOf === undefined ? proc.input : proc.inputOf(ctx);

    return triggerButton(engine, bearer, [buttonIdOf(engine, proc.spell, false), input]) ? PROC_LANDED : PROC_REFUSED;
  },

  prepare: (proc) => ({ ...proc, spell: buttonIdOf(engine, proc.spell, true) }),

  explain: (proc) => ({ values: { spell: buttonIdOf(engine, proc.spell, false) } }),
});

/** Builds the ability system's proc kinds over its engine. */
export const createAbilityProcKinds = <G extends AbilityTypes>(engine: AbilityEngine<G>): AbilityProcKinds<G> =>
  Object.freeze({ useAbility: useAbilityKind(engine) });
