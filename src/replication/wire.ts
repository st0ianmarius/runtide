/** What a wire table is read from: any registry (its kind and its names in id order, tombstones included). */
export interface WireSource {
  /** The registry's kind (`auras`, `spells`, `cues`). */
  readonly kind: string;

  /** Its names by id, a retired name keeping its slot. */
  readonly names: readonly string[];
}

/**
 * A registry's wire table (§I.6 Replication): the append-only mapping between the ids the wire carries and the names
 * they stand for, with a checksum a client and a server compare at the handshake, so both sides agree on every id.
 */
export interface WireTable {
  /** The registry's kind. */
  readonly kind: string;

  /** The names by id. */
  readonly names: readonly string[];

  /** A 32-bit FNV-1a hash of the kind and the names in order, as eight hex digits. */
  readonly checksum: string;
}

/** The FNV-1a offset basis. */
const FNV_OFFSET = 0x81_1c_9d_c5;

/** The FNV-1a prime. */
const FNV_PRIME = 0x01_00_01_93;

/** A 32-bit FNV-1a hash of a string's UTF-16 code units, as eight hex digits. */
const fnv1a = (text: string): string => {
  let hash = FNV_OFFSET;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
};

/** A registry's wire table: its kind, its names in id order, and their checksum. */
export const wireTableOf = (registry: WireSource): WireTable => {
  const names = Object.freeze([...registry.names]);

  return Object.freeze({ kind: registry.kind, names, checksum: fnv1a(`${registry.kind}\n${names.join('\n')}`) });
};

/**
 * Checks that a registry only appended to a pinned wire table (a test helper, §I.5.2): every pinned name must keep its
 * id, and new names may only follow them. Throws a `RangeError` naming the first name that moved or went; a table
 * with more names than the pin passes, so pinning the current list in a test catches any reordering.
 */
export const checkWireTable = (pinned: readonly string[], table: WireTable): void => {
  for (const [id, name] of pinned.entries()) {
    const now = table.names[id];

    if (now !== name) {
      const moved = table.names.indexOf(name);
      const where = moved < 0 ? 'is gone' : `moved to id ${moved}`;

      throw new RangeError(`The ${table.kind} wire table is not append-only: ${name} (id ${id}) ${where}.`);
    }
  }
};
