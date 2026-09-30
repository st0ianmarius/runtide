import { createRegistry, type Registry, type Tombstone } from '../core/index.ts';
import type { CueAnchor, CueAudience, CueDef } from './cue-def.ts';
import { type CueId, type CueIdOf, type CueParam, namedCueIds, toCueParam } from './ids.ts';
import { compileSchema, type CueSchema } from './schema.ts';

/** The anchors, by column code. */
const ANCHORS: readonly CueAnchor[] = ['self', 'entity', 'target', 'world'];

/** The audiences, by column code. */
const AUDIENCES: readonly CueAudience[] = ['owner', 'party', 'all'];

/** The anchor column code of `self`. */
export const SELF = 0;

/** The anchor column code of `entity`. */
export const ON_ENTITY = 1;

/** The anchor column code of `world`. */
export const WORLD = 3;

/** The position scale of a registry that declares none: centimetres. */
const DEFAULT_POSITION_SCALE = 100;

/** A game's cue table: every cue by name, retired ones as tombstones. */
export type CueTable = Readonly<Record<string, CueDef | Tombstone>>;

/** The params of one entry of a cue table, by name (none for a tombstone). */
type ParamsOf<Entry> = Entry extends { readonly params: infer Params } ? Params : Readonly<Record<never, never>>;

/** The live names of a cue table. */
export type CueName<Table extends CueTable> = {
  [Name in keyof Table & string]: Table[Name] extends Tombstone ? never : Name;
}[keyof Table & string];

/** The typed hot-field columns of a cue registry. */
export type CueColumn = 'anchor' | 'audience' | 'isPredicted';

/** What a cue registry is built with, beyond its cues. */
export interface CueRegistryOptions {
  /** Steps per unit of every event's position and of points whose param declares none; 100 (centimetres) when absent. */
  readonly positionScale?: number;

  /** The pinned order of the names, when it is not the key order (§I.5). */
  readonly order?: readonly string[];
}

/**
 * The game's cue registry (`defineCues`): dense ids by key order (the wire's cue ids, append-only), typed columns
 * (`anchor`, `audience`, `isPredicted`), each cue's compiled param schema, and every param's slot resolved at load.
 */
export interface CueRegistry<Table extends CueTable = CueTable> extends Registry<
  'cues',
  Extract<keyof Table, string>,
  CueDef,
  CueColumn
> {
  /** The id of every cue, by name, carrying the name in its type so a spec's params are checked. */
  readonly id: { readonly [Name in Extract<keyof Table, string>]: CueIdOf<Name> };

  /** Every param's slot, by cue name and param name, resolved at load. */
  readonly params: {
    readonly [Name in CueName<Table>]: Readonly<Record<keyof ParamsOf<Table[Name]> & string, CueParam>>;
  };

  /** Each cue's compiled schema, by id; `undefined` for a tombstone. */
  readonly schemas: readonly (CueSchema | undefined)[];

  /** The most slots any cue's params take: the length of every event's `values`. */
  readonly slots: number;

  /** Steps per unit of event positions. */
  readonly positionScale: number;

  /** A param's slot by name, for load-time lookups from data; `undefined` for a name the cue does not declare. */
  readonly paramOf: (cue: CueId, name: string) => CueParam | undefined;

  /** A live cue's anchor. Throws for an id outside the registry or retired. */
  readonly anchorOf: (cue: CueId) => CueAnchor;
}

/** The slots of one schema's params, by name. */
const slotsOf = (schema: CueSchema | undefined): Readonly<Record<string, CueParam>> =>
  Object.freeze(
    Object.fromEntries((schema?.names ?? []).map((name, i) => [name, toCueParam(schema?.fields[i]?.slot ?? 0)])),
  );

/** Whether a record built from a registry's names holds one entry per live name, which types it. */
const isParamTable = <Table extends CueTable>(
  record: Readonly<Record<string, unknown>>,
  names: readonly string[],
): record is CueRegistry<Table>['params'] => names.every((name) => Object.hasOwn(record, name));

/**
 * Declares the game's cues (§I.6, §II.6 R1): `defineCues({ hurt: { anchor: 'self', audience: 'owner', params: { amount:
 * { kind: 'int' } } }, … })`. Each cue gets a dense id by key order, which is what crosses the wire, so the table only
 * grows (retire a cue with `TOMBSTONE`). Every anchor, audience, param kind, scale and default is checked here.
 */
export const defineCues = <const Table extends CueTable>(
  table: Table,
  options: CueRegistryOptions = {},
): CueRegistry<Table> => {
  const positionScale = options.positionScale ?? DEFAULT_POSITION_SCALE;

  if (!(Number.isFinite(positionScale) && positionScale > 0)) {
    throw new RangeError(`Cue registry: positionScale must be above 0; got ${positionScale}.`);
  }

  const base = createRegistry(table, {
    kind: 'cues',
    ...(options.order === undefined ? {} : { order: options.order }),
    columns: {
      anchor: { type: 'u8', of: (def: CueDef) => ANCHORS.indexOf(def.anchor) },
      audience: { type: 'u8', of: (def: CueDef) => AUDIENCES.indexOf(def.audience ?? 'all') },
      isPredicted: { type: 'u8', of: (def: CueDef) => (def.isPredicted === true ? 1 : 0) },
    },
  });

  const schemas = Object.freeze(
    base.defs.map((def, id) =>
      def === undefined ? undefined : compileSchema(base.names[id] ?? '', def, positionScale),
    ),
  );

  const live = base.ids.map((id) => base.name(id));
  const params = Object.freeze(Object.fromEntries(base.ids.map((id) => [base.name(id), slotsOf(schemas[id])])));

  if (!isParamTable<Table>(params, live)) {
    throw new Error('The cue registry lost a cue while it was built.');
  }

  return Object.freeze({
    ...base,
    id: namedCueIds(base.id),
    params,
    schemas,
    slots: Math.max(0, ...schemas.map((schema) => schema?.size ?? 0)),
    positionScale,

    anchorOf: (cue: CueId): CueAnchor => base.get(cue).anchor,

    paramOf: (cue: CueId, name: string): CueParam | undefined => {
      const schema = schemas[cue];
      const index = schema?.names.indexOf(name) ?? -1;

      return schema === undefined || index < 0 ? undefined : toCueParam(schema.fields[index]?.slot ?? 0);
    },
  });
};
