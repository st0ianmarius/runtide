// Hot path (§I.4.2, §I.5.4): what the fold asks of each entry, on every read.
import { type Entry, FROM_HOST, type Sheet } from './sheet.ts';

/** The stacks of a gated entry: the read's what-if override, else the host's report, else none. */
const gateStacks = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): number => {
  const read = sheet.view.read;
  const whatIf = read?.whatIf;

  if (whatIf?.gate === entry.gate) {
    return whatIf.stacks;
  }

  const host = read?.host;
  const { stacks } = sheet.tables;

  return host === undefined || stacks === undefined ? 0 : stacks(host, entry.gate);
};

/** Whether an entry's source is folded and its scope reached by the current read. */
const isReached = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): boolean => {
  const read = sheet.view.read;
  const sources = read?.sources;

  if (sources !== undefined && ((sources >>> entry.source) & 1) === 0) {
    return false;
  }

  return entry.scope < 0 || read?.scope?.has(entry.scope) === true;
};

/**
 * How many stacks an entry counts with for the current read, or 0 when it does not count. Tested in this order, each
 * test only when the ones before it passed: the source is folded, the scope reached, the gate stacked, then the
 * condition met (a host value also needs a host). So a condition is asked only for an entry that would otherwise
 * count. An ungated entry counts with 1.
 */
export const liveStacks = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): number => {
  if (!isReached(sheet, entry)) {
    return 0;
  }

  const stacks = entry.gate >= 0 ? gateStacks(sheet, entry) : 1;
  const host = sheet.view.read?.host;

  if (stacks <= 0) {
    return 0;
  }

  if (host === undefined) {
    return entry.test === undefined && entry.valueKind !== FROM_HOST ? stacks : 0;
  }

  return entry.test === undefined || entry.test(host, entry.testArg) ? stacks : 0;
};
