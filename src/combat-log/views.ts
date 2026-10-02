import type { EventKind } from '../core/index.ts';

/**
 * What the log reads of a blow (a damage system's `Blow` is one): its units, credit, spell, kind and amounts. The log
 * reads every system through such narrow views, so it depends on the shapes of their events, not on the systems.
 */
export interface BlowView<Unit, Spell> {
  /** Who it struck. */
  readonly target: Unit;

  /** Who struck. */
  readonly attacker: Unit | undefined;

  /** Who it is credited to. */
  readonly source: number;

  /** The spell behind it. */
  readonly spell: Spell | undefined;

  /** The aura it came from, if any. */
  readonly aura?: number | undefined;

  /** Its damage kind. */
  readonly kind: number;

  /** What it was asked for. */
  readonly base: number;

  /** What it carried to the health stage. */
  readonly amount: number;

  /** What reached health. */
  readonly dealt: number;

  /** What absorbs took. */
  readonly absorbed: number;

  /** What mitigation took. */
  readonly mitigated: number;

  /** How it ended. */
  readonly status: string;

  /** Whether it was critical. */
  readonly isCrit: boolean;

  /** Whether it killed. */
  readonly hasKilled: boolean;

  /** Whether a death it would have dealt was prevented. */
  readonly isDeathPrevented: boolean;

  /** The damage a prevented death did not deal (0 unless `isDeathPrevented`); 0 when absent. */
  readonly prevented?: number | undefined;

  /** The outcome row it rolled (`dodge`, `crit`), if any. */
  readonly outcome: string | undefined;
}

/** What the log reads of a heal (a damage system's `Heal` is one). */
export interface HealView<Unit, Spell> {
  /** Who it healed. */
  readonly target: Unit;

  /** Who healed. */
  readonly healer: Unit | undefined;

  /** Who it is credited to. */
  readonly source: number;

  /** The spell behind it. */
  readonly spell: Spell | undefined;

  /** The aura it came from, if any. */
  readonly aura?: number | undefined;

  /** What it was asked for. */
  readonly base: number;

  /** What it gave back. */
  readonly amount: number;

  /** What the target was too full to take. */
  readonly overheal: number;

  /** What a heal absorb took out of it (a wound's `onIncomingHeal`). */
  readonly absorbed: number;

  /** How it ended. */
  readonly status: string;
}

/** What the log reads of a death (a damage system's `Death` is one). */
export interface DeathView<Unit, Spell> {
  /** Who died. */
  readonly unit: Unit;

  /** Who killed. */
  readonly killer: Unit | undefined;

  /** Who it is credited to. */
  readonly source: number;

  /** The spell behind it. */
  readonly spell: Spell | undefined;
}

/** What the log reads of a force (a damage system's `Force` is one): its units, credit, kind, strength and status. */
export interface ForceView<Unit, Spell> {
  /** Who it moved. */
  readonly target: Unit;

  /** Who caused it. */
  readonly attacker: Unit | undefined;

  /** Who it is credited to. */
  readonly source: number;

  /** What it is: `knock`, `push`, `pull` or the game's own. */
  readonly kind: string;

  /** The strength it was asked for. */
  readonly base: number;

  /** The strength applied (0 when ignored). */
  readonly amount: number;

  /** The blow whose knockback it is, if a blow caused it. */
  readonly blow:
    | {
        /** The blow's spell. */
        readonly spell: Spell | undefined;

        /** The aura the blow came from, if any. */
        readonly aura?: number | undefined;
      }
    | undefined;

  /** How it ended. */
  readonly status: string;
}

/** What the log reads of an aura lifecycle event (an aura system's `AuraEvent` is one). */
export interface AuraEventView<Unit> {
  /** The change: `applied`, `refreshed`, `expired`, `removed` or `stateEntered`. */
  readonly change: string;

  /** Who removed it (a dispel's caster), or −1. */
  readonly remover?: number;

  /** The bearer. */
  readonly bearer: Unit | undefined;

  /** The aura instance. */
  readonly aura:
    | {
        /** Its registry id. */
        readonly id: number;

        /** Its stacks. */
        readonly stacks: number;

        /** Who applied it. */
        readonly source: number;
      }
    | undefined;
}

/** What the log reads of a spell event (a spell system's `SpellEvent` is one). */
export interface SpellEventView<Unit> {
  /** The cast. */
  readonly cast:
    | {
        /** The spell. */
        readonly spell: number;

        /** Who casts. */
        readonly caster: Unit;

        /** Who its hits are credited to. */
        readonly source: number;
      }
    | undefined;

  /** What a delivery caught, on a hit. */
  readonly hit:
    | {
        /** The units caught. */
        readonly targets: readonly Unit[];
      }
    | undefined;

  /** How it ended, on an end. */
  readonly outcome: string | undefined;
}

/** What the log reads of an area trigger event (an area trigger system's `AreaTriggerEvent` is one). */
export interface AreaEventView<Unit> {
  /** The area trigger. */
  readonly areaTrigger:
    | {
        /** Its entity id. */
        readonly id: number;

        /** Its kind. */
        readonly kind: number;

        /** Its owner. */
        readonly owner: Unit;

        /** Who it is credited to. */
        readonly source: number;
      }
    | undefined;

  /** Why it ended, on an end. */
  readonly reason: string | undefined;
}

/** A damage event's payload, as the log reads it (`DamageEvent`). */
export interface BlowPayload<Unit, Spell> {
  /** The blow. */
  readonly blow: BlowView<Unit, Spell> | undefined;
}

/** A heal event's payload, as the log reads it (`HealEvent`). */
export interface HealPayload<Unit, Spell> {
  /** The heal. */
  readonly heal: HealView<Unit, Spell> | undefined;
}

/** A death event's payload, as the log reads it (`DeathEvent`). */
export interface DeathPayload<Unit, Spell> {
  /** The death. */
  readonly death: DeathView<Unit, Spell> | undefined;
}

/** A force event's payload, as the log reads it (`ForceEvent`). */
export interface ForcePayload<Unit, Spell> {
  /** The force. */
  readonly force: ForceView<Unit, Spell> | undefined;
}

/** The event kinds of a damage system the log records. */
export interface DamageLogEvents<Unit, Spell> {
  /**
   * Every blow that was not skipped, before anything it set off (`DamageEvents.resolved`): given, the log records blows
   * from it alone, in the order things happened, and `taken` and `ignored` are not needed.
   */
  readonly resolved?: EventKind<BlowPayload<Unit, Spell>>;

  /** Every blow that was not skipped or ignored (`DamageEvents.taken`), after what its `onDealt` hooks set off. */
  readonly taken?: EventKind<BlowPayload<Unit, Spell>>;

  /** Every blow the ignore stage ignored (`DamageEvents.ignored`). */
  readonly ignored?: EventKind<BlowPayload<Unit, Spell>>;

  /** Every heal that was not skipped (`DamageEvents.healed`). */
  readonly healed?: EventKind<HealPayload<Unit, Spell>>;

  /** Every death (`DamageEvents.death`). */
  readonly death?: EventKind<DeathPayload<Unit, Spell>>;

  /** Every force that was not skipped, after the host applied it (`DamageEvents.forced`). */
  readonly forced?: EventKind<ForcePayload<Unit, Spell>>;

  /**
   * The force kinds a force entry is coded by: the framework's (`FORCE_KINDS`) then the game's own; `FORCE_KINDS` when
   * absent.
   */
  readonly forceKinds?: readonly string[];
}

/** The event kinds of a spell system the log records. */
export interface SpellLogEvents<Unit> {
  /** Casts starting. */
  readonly start?: EventKind<SpellEventView<Unit>>;

  /** Payloads going out. */
  readonly release?: EventKind<SpellEventView<Unit>>;

  /** Deliveries catching units. */
  readonly hit?: EventKind<SpellEventView<Unit>>;

  /** Casts ending. */
  readonly end?: EventKind<SpellEventView<Unit>>;

  /** The cast outcomes an end is coded by (`spellRegistry.outcomes`, with the game's own); `CAST_OUTCOMES` when absent. */
  readonly outcomes?: readonly string[];
}

/** The event kinds of an area trigger system the log records. */
export interface AreaLogEvents<Unit> {
  /** Area triggers spawning. */
  readonly spawned?: EventKind<AreaEventView<Unit>>;

  /** Area triggers ending. */
  readonly ended?: EventKind<AreaEventView<Unit>>;

  /** The end reasons an end is coded by (`areaRegistry.endReasons`, with the game's own); `END_REASONS` when absent. */
  readonly reasons?: readonly string[];
}
