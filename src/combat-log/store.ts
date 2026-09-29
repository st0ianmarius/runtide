import { COMBAT_ENTRY_KINDS, ENTRY_FIELDS, type EntryRecord } from './entry.ts';

/** How many numbers one entry takes. */
const WIDTH = ENTRY_FIELDS.length;

/** The FNV-1a offset basis. */
const FNV_OFFSET = 0x81_1c_9d_c5;

/** The FNV-1a prime. */
const FNV_PRIME = 0x01_00_01_93;

/**
 * The log's storage (§I.5.4): a ring of the latest `capacity` entries, one row of numbers each in one `Float64Array`,
 * so recording allocates nothing and an old entry is overwritten, never collected.
 */
export class EntryStore {
  readonly capacity: number;

  /** How many entries were ever recorded: the next entry's running number. */
  total = 0;

  readonly #rows: Float64Array;
  readonly #scratch = new DataView(new ArrayBuffer(8));

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A combat log holds a whole number of entries from 1; got ${capacity}.`);
    }

    this.capacity = capacity;
    this.#rows = new Float64Array(capacity * WIDTH);
  }

  /** How many entries it holds. */
  get size(): number {
    return Math.min(this.total, this.capacity);
  }

  /** The running number of the oldest entry it holds. */
  get first(): number {
    return this.total - this.size;
  }

  /** Records an entry, numbering it; the oldest is overwritten once the ring is full. */
  push(entry: EntryRecord): void {
    const rows = this.#rows;
    const at = (this.total % this.capacity) * WIDTH;

    entry.seq = this.total;
    rows[at] = entry.tick;
    rows[at + 1] = COMBAT_ENTRY_KINDS.indexOf(entry.kind);
    rows[at + 2] = entry.source;
    rows[at + 3] = entry.actor;
    rows[at + 4] = entry.target;
    rows[at + 5] = entry.spell;
    rows[at + 6] = entry.aura;
    rows[at + 7] = entry.areaKind;
    rows[at + 8] = entry.damageKind;
    rows[at + 9] = entry.amount;
    rows[at + 10] = entry.base;
    rows[at + 11] = entry.absorbed;
    rows[at + 12] = entry.mitigated;
    rows[at + 13] = entry.overflow;
    rows[at + 14] = entry.flags;
    rows[at + 15] = entry.reason;
    this.total += 1;
  }

  /** Fills `out` with the entry of a running number; false when it is not held (not yet, or overwritten). */
  read(seq: number, out: EntryRecord): boolean {
    if (!Number.isInteger(seq) || seq < this.first || seq >= this.total) {
      return false;
    }

    const at = (seq % this.capacity) * WIDTH;

    out.seq = seq;
    out.tick = this.#number(at);
    out.kind = COMBAT_ENTRY_KINDS[this.#number(at + 1)] ?? 'damage';
    out.source = this.#number(at + 2);
    out.actor = this.#number(at + 3);
    out.target = this.#number(at + 4);
    out.spell = this.#number(at + 5);
    out.aura = this.#number(at + 6);
    out.areaKind = this.#number(at + 7);
    out.damageKind = this.#number(at + 8);
    out.amount = this.#number(at + 9);
    out.base = this.#number(at + 10);
    out.absorbed = this.#number(at + 11);
    out.mitigated = this.#number(at + 12);
    out.overflow = this.#number(at + 13);
    out.flags = this.#number(at + 14);
    out.reason = this.#number(at + 15);

    return true;
  }

  /**
   * A 32-bit FNV-1a hash of every held entry's numbers, oldest first, over their exact float bits read little-endian
   * (the same on every platform), as eight hex digits: what a golden test compares, so two runs that differ in any
   * number of any entry differ here.
   */
  checksum(): string {
    const rows = this.#rows;
    const scratch = this.#scratch;
    let hash = FNV_OFFSET;

    for (let seq = this.first; seq < this.total; seq++) {
      const from = (seq % this.capacity) * WIDTH;

      for (let i = from; i < from + WIDTH; i++) {
        scratch.setFloat64(0, rows[i] ?? 0, true);
        hash = Math.imul(hash ^ scratch.getUint32(0, true), FNV_PRIME) >>> 0;
        hash = Math.imul(hash ^ scratch.getUint32(4, true), FNV_PRIME) >>> 0;
      }
    }

    return hash.toString(16).padStart(8, '0');
  }

  /** One stored number (every slot of a written row holds one). */
  #number(index: number): number {
    return this.#rows[index] ?? 0;
  }

  /** Forgets every entry; the next is numbered 0 again. */
  clear(): void {
    this.total = 0;
  }
}
