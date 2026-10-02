/**
 * The kinds of combat log entry, by code: a blow (`damage`), a blow the target's ignore stage ignored
 * (`immune`), a heal, a death, an aura's lifecycle, a cast's four moments, an area trigger's two, and a force (a
 * knock, push or pull). A new kind is appended, so the codes of the others stay.
 */
export const COMBAT_ENTRY_KINDS = [
  'damage',
  'immune',
  'heal',
  'death',
  'auraApplied',
  'auraRefreshed',
  'auraExpired',
  'auraRemoved',
  'castStart',
  'castRelease',
  'castHit',
  'castEnd',
  'areaSpawned',
  'areaEnded',
  'force'
] as const;

/** A kind of combat log entry. */
export type CombatEntryKind = (typeof COMBAT_ENTRY_KINDS)[number];

/** Flag bit: the blow was critical. */
export const ENTRY_CRIT = 1;

/** Flag bit: the blow killed its target. */
export const ENTRY_KILLED = 2;

/** Flag bit: an `onLethal` hook prevented the death the blow would have dealt. */
export const ENTRY_DEATH_PREVENTED = 4;

/**
 * One combat log entry: ids and numbers only, so it digests, crosses a wire and feeds a meter as it is. A
 * field that does not apply to its kind is −1 (an id) or 0 (an amount). Entries handed to subscribers and filled by
 * `read` are reused: read them at once.
 */
export interface CombatEntry {
  /** Its running number in the log, from 0. */
  readonly seq: number;

  /** The tick it was recorded on. */
  readonly tick: number;

  /** What it records. */
  readonly kind: CombatEntryKind;

  /** The entity it is credited to (a blow's, heal's or death's source, an aura's source, a cast's credit, an owner). */
  readonly source: number;

  /**
   * The entity that acted (the attacker, the healer, the killer, the caster, an aura's dispeller, a force's attacker);
   * −1 for none.
   */
  readonly actor: number;

  /** The entity it happened to (the target, the one who died, the aura's bearer, the unit a force moved); −1 for none. */
  readonly target: number;

  /**
   * The spell behind it (the host's `spellIdOf` of a blow's, heal's or death's spell, or of the spell of the blow whose
   * knockback a force is; a cast's spell); −1 for none.
   */
  readonly spell: number;

  /**
   * The aura of an aura entry, or the aura a blow or heal came from (a damage over time's beat), or that a force's blow
   * came from; −1 for none.
   */
  readonly aura: number;

  /** The kind of an area trigger entry; −1 for any other. */
  readonly areaKind: number;

  /** The damage kind of a damage or immune entry; −1 for any other. */
  readonly damageKind: number;

  /** What reached health (a blow's `dealt`), what a heal gave back, an aura's stacks, or a force's applied strength. */
  readonly amount: number;

  /** What it was asked for (a blow's or heal's `base`, a force's strength before its stages). */
  readonly base: number;

  /** What absorbs took out of a blow. */
  readonly absorbed: number;

  /** What mitigation took off a blow (negative when it amplified it). */
  readonly mitigated: number;

  /**
   * What went past health: a blow's overkill, a heal's overheal. For a blow flagged `ENTRY_DEATH_PREVENTED` it is
   * instead the damage the prevented death did not deal (the blow's `prevented`): such a blow never has overkill, so
   * the column is free, and the flag says which it holds.
   */
  readonly overflow: number;

  /** Its flag bits (`ENTRY_CRIT`, `ENTRY_KILLED`, `ENTRY_DEATH_PREVENTED`). */
  readonly flags: number;

  /** A blow's outcome row, as its index in the log's `outcomes` (the roll table's names); −1 for none. */
  readonly outcome: number;

  /**
   * A code for how it ended: a blow's status (`BLOW_STATUSES`), a heal's (`skipped`, `blocked`, `landed`), a force's
   * (`skipped`, `ignored`, `landed`), a cast end's outcome (the log's cast outcomes), an area trigger end's reason (its
   * end reasons); −1 for none.
   */
  readonly reason: number;

  /** A force entry's kind, as its index in the log's force kinds (`knock`, `push`, `pull`, the game's own); −1 for none. */
  readonly forceKind: number;
}

/**
 * The numeric fields of an entry, in the order the log stores, digests and would send them. A new column is appended,
 * so the others keep their places: `forceKind` is the latest.
 */
export const ENTRY_FIELDS = [
  'tick',
  'kind',
  'source',
  'actor',
  'target',
  'spell',
  'aura',
  'areaKind',
  'damageKind',
  'amount',
  'base',
  'absorbed',
  'mitigated',
  'overflow',
  'flags',
  'reason',
  'outcome',
  'forceKind'
] as const;

/** An entry being written or read: a class for fast properties, reused. */
export class EntryRecord implements CombatEntry {
  seq = 0;
  tick = 0;
  kind: CombatEntryKind = 'damage';
  source = -1;
  actor = -1;
  target = -1;
  spell = -1;
  aura = -1;
  areaKind = -1;
  damageKind = -1;
  amount = 0;
  base = 0;
  absorbed = 0;
  mitigated = 0;
  overflow = 0;
  flags = 0;
  reason = -1;
  outcome = -1;
  forceKind = -1;

  /** Clears it for a new entry of a kind on a tick. */
  begin(kind: CombatEntryKind, tick: number): this {
    this.kind = kind;
    this.tick = tick;
    this.source = -1;
    this.actor = -1;
    this.target = -1;
    this.spell = -1;
    this.aura = -1;
    this.areaKind = -1;
    this.damageKind = -1;
    this.amount = 0;
    this.base = 0;
    this.absorbed = 0;
    this.mitigated = 0;
    this.overflow = 0;
    this.flags = 0;
    this.reason = -1;
    this.outcome = -1;
    this.forceKind = -1;

    return this;
  }
}
