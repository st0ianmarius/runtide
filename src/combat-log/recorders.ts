import { BLOW_STATUSES } from '../damage/index.ts';
import { type CombatEntryKind, ENTRY_CRIT, ENTRY_DEATH_PREVENTED, ENTRY_KILLED, type EntryRecord } from './entry.ts';
import type { AreaEventView, AuraEventView, BlowView, DeathView, HealView, SpellEventView } from './views.ts';

/** A blow's statuses by code (`BLOW_STATUSES`). */
const BLOW_CODES: readonly string[] = BLOW_STATUSES;

/** A heal's statuses by code: `skipped`, `blocked`, `landed`. */
const HEAL_CODES: readonly string[] = ['skipped', 'blocked', 'landed'];

/** The entry kind of each aura change; `stateEntered` is not logged (the death or despawn is). */
const AURA_KINDS: Readonly<Record<string, CombatEntryKind | undefined>> = {
  applied: 'auraApplied',
  refreshed: 'auraRefreshed',
  expired: 'auraExpired',
  removed: 'auraRemoved'
};

/** What the recorders write through: the entry being built, and the log's id reads. */
export interface Recording<Unit, Spell> {
  /** Begins an entry of a kind on the current tick. */
  readonly begin: (kind: CombatEntryKind) => EntryRecord;

  /** Records the entry `begin` handed out and hands it to the subscribers. */
  readonly commit: () => void;

  /** A unit's entity id; −1 for none. */
  readonly idOf: (unit: Unit | undefined) => number;

  /** A spell's id; −1 for none. */
  readonly spellOf: (spell: Spell | undefined) => number;

  /** An outcome row's code; −1 for none or one the log was not told of. */
  readonly outcomeOf: (outcome: string | undefined) => number;
}

/** Records a blow: `damage`, or `immune` for one its target's ignore stage ignored. */
export const recordBlow = <Unit, Spell>(
  recording: Recording<Unit, Spell>,
  blow: BlowView<Unit, Spell> | undefined
): void => {
  if (blow === undefined) {
    return;
  }

  const entry = recording.begin(blow.status === 'ignored' ? 'immune' : 'damage');

  entry.source = blow.source;
  entry.actor = recording.idOf(blow.attacker);
  entry.target = recording.idOf(blow.target);
  entry.spell = recording.spellOf(blow.spell);
  entry.aura = blow.aura ?? -1;
  entry.damageKind = blow.kind;
  entry.amount = blow.dealt;
  entry.base = blow.base;
  entry.absorbed = blow.absorbed;
  entry.mitigated = blow.mitigated;
  entry.overflow = Math.max(0, blow.amount - blow.dealt);
  entry.flags =
    (blow.isCrit ? ENTRY_CRIT : 0) |
    (blow.hasKilled ? ENTRY_KILLED : 0) |
    (blow.isDeathPrevented ? ENTRY_DEATH_PREVENTED : 0);
  entry.reason = BLOW_CODES.indexOf(blow.status);
  entry.outcome = recording.outcomeOf(blow.outcome);
  recording.commit();
};

/** Records a heal. */
export const recordHeal = <Unit, Spell>(
  recording: Recording<Unit, Spell>,
  heal: HealView<Unit, Spell> | undefined
): void => {
  if (heal === undefined) {
    return;
  }

  const entry = recording.begin('heal');

  entry.source = heal.source;
  entry.actor = recording.idOf(heal.healer);
  entry.target = recording.idOf(heal.target);
  entry.spell = recording.spellOf(heal.spell);
  entry.aura = heal.aura ?? -1;
  entry.amount = heal.amount;
  entry.base = heal.base;
  entry.overflow = heal.overheal;
  entry.reason = HEAL_CODES.indexOf(heal.status);
  recording.commit();
};

/** Records a death. */
export const recordDeath = <Unit, Spell>(
  recording: Recording<Unit, Spell>,
  death: DeathView<Unit, Spell> | undefined
): void => {
  if (death === undefined) {
    return;
  }

  const entry = recording.begin('death');

  entry.source = death.source;
  entry.actor = recording.idOf(death.killer);
  entry.target = recording.idOf(death.unit);
  entry.spell = recording.spellOf(death.spell);
  recording.commit();
};

/** Records an aura's lifecycle change; nothing for a bearer's death, which the death entry records. */
export const recordAura = <Unit, Spell>(recording: Recording<Unit, Spell>, event: AuraEventView<Unit>): void => {
  const kind = AURA_KINDS[event.change];
  const { aura } = event;

  if (kind === undefined || aura === undefined) {
    return;
  }

  const entry = recording.begin(kind);

  entry.source = aura.source;
  entry.actor = event.remover ?? -1;
  entry.target = recording.idOf(event.bearer);
  entry.aura = aura.id;
  entry.amount = aura.stacks;
  recording.commit();
};

/**
 * A recorder of one of a cast's moments, made once per kind: a hit's amount is how many units it caught, an end's
 * reason its outcome.
 */
export const castRecorder =
  <Unit, Spell>(recording: Recording<Unit, Spell>, kind: CombatEntryKind, outcomes: readonly string[]) =>
  (event: SpellEventView<Unit>): void => {
    const { cast } = event;

    if (cast === undefined) {
      return;
    }

    const entry = recording.begin(kind);
    const caster = recording.idOf(cast.caster);

    entry.source = cast.source;
    entry.actor = caster;
    entry.target = caster;
    entry.spell = cast.spell;
    entry.amount = event.hit?.targets.length ?? 0;
    entry.reason = event.outcome === undefined ? -1 : outcomes.indexOf(event.outcome);
    recording.commit();
  };

/** A recorder of area triggers spawning or ending, made once per kind; the target is the area trigger's entity id. */
export const areaRecorder =
  <Unit, Spell>(recording: Recording<Unit, Spell>, kind: CombatEntryKind, reasons: readonly string[]) =>
  (event: AreaEventView<Unit>): void => {
    const area = event.areaTrigger;

    if (area === undefined) {
      return;
    }

    const entry = recording.begin(kind);

    entry.source = area.source;
    entry.actor = recording.idOf(area.owner);
    entry.target = area.id;
    entry.areaKind = area.kind;
    entry.reason = event.reason === undefined ? -1 : reasons.indexOf(event.reason);
    recording.commit();
  };
