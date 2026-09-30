import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** The id of a value kind the game registered: its position in the game's value table. */
export type ValueId = Id<'values'>;

/**
 * A game-supplied value read: a number from the read's host and a numeric argument, such as
 * `byMissingHealth(max)` giving `1 + max × (1 − hp / maxHp)`. It must be deterministic.
 */
export type ValueRead<Host> = (host: Host, arg: number) => number;

/** A value kind with its flags: what `defineValues` takes in place of a bare read. */
export interface ValueSpec<Host> {
  /** The number it reads. */
  readonly read: ValueRead<Host>;

  /** Whether a prediction mirror may read it; false when absent. */
  readonly mirrorSafe?: boolean;
}

/** A registered value kind: its read and flags. */
export interface ValueDef<Host> {
  /** The number a modifier of this kind lands with before stacking, or a comparison reads. */
  readonly read: ValueRead<Host>;

  /** Whether a prediction mirror may read it. */
  readonly isMirrorSafe: boolean;
}

/** The game's value table: a registry of value reads with dense ids. */
export type ValueTable<Name extends string = string, Host = never> = Registry<
  'values',
  Extract<Name, string>,
  ValueDef<Host>,
  never
>;

/** A value kind's definition from a bare read or a spec with flags. */
const defOf = <Host>(spec: ValueRead<Host> | ValueSpec<Host>): ValueDef<Host> =>
  typeof spec === 'function'
    ? { read: spec, isMirrorSafe: false }
    : { read: spec.read, isMirrorSafe: spec.mirrorSafe === true };

/**
 * Registers the game's value kinds, which a modifier's value can name (`hostValue('missingHealth', 0.5)`) and a
 * comparison can test (`{ value: 'healthShare', op: '<', than: 0.5 }`), so that both stay data the client can
 * explain, while the number comes from the bearer's state at each read.
 */
export const defineValues = <Host, const Name extends string>(
  reads: Readonly<Record<Name, ValueRead<Host> | ValueSpec<Host>>>
): ValueTable<Name, Host> => {
  const names = Object.keys(reads).filter((key): key is Name => Object.hasOwn(reads, key));

  return createRegistry<Readonly<Record<Name, ValueDef<Host>>>, 'values'>(
    recordOf(names, (name) => defOf(reads[name])),
    { kind: 'values' }
  );
};
