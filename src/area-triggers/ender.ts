import type { EndReason } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import { unlinkKind, unlinkTick } from './order.ts';

/** Runs one end hook of an area trigger, with the reusable proc list. */
const runEndHook = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  reason: EndReason,
): void => {
  const { hooks } = engine.registry;
  const onExpire = hooks.onExpire[area.kind];
  const onEnd = hooks.onEnd[area.kind];
  const list = engine.takeList();

  try {
    if (reason === 'expired' && onExpire !== undefined) {
      engine.run(area, onExpire(area, list), list);
      list.clear();
    }

    engine.fire(area, area.isSilent ? undefined : engine.registry.get(area.kind).cues?.end?.(area, reason));

    if (onEnd !== undefined) {
      engine.run(area, onEnd(area, reason, list), list);
    }
  } finally {
    engine.giveList(list);
  }
};

/**
 * Ends an area trigger (§II.6 W1): `onExpire` for an expiry, its end cue unless the end is silent, `onEnd` with the
 * reason, then it leaves the tick order and its kind's list, its owner aura comes off when it was the last of its kind,
 * the end event is raised, its cast is let go and its record goes back to the pool. Ending one that is already ending
 * does nothing.
 */
export const endArea = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  end: { readonly reason: EndReason; readonly isSilent?: boolean },
): void => {
  if (area.isEnding) {
    return;
  }

  area.isEnding = true;
  area.isSilent = end.isSilent === true;
  runEndHook(engine, area, end.reason);
  unlinkTick(engine, area);
  unlinkKind(engine, area);
  engine.count(area.owner, [area.kind, -1]);
  engine.holdOwnerAura(area, false);
  engine.raise('ended', area, end.reason);
  engine.spells.release(area.castHandle);
  engine.free(area);
};
