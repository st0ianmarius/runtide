/**
 * Where a game stage goes (§I.5.6 hatch 5): right before or right after a named stage, built-in or the game's own
 * declared earlier. Several stages at one position keep their declaration order.
 */
export interface StagePosition {
  /** The stage it runs right before. */
  readonly before?: string;

  /** The stage it runs right after. */
  readonly after?: string;
}

/** A game's own pipeline stage: its position and what it runs. */
export interface StageDef<Run> extends StagePosition {
  /** The stage itself. */
  readonly run: Run;
}

/** One pipeline's stage order, compiled at load. */
export interface StageOrder<Run> {
  /** Every stage's developer name, in run order. */
  readonly names: readonly string[];

  /** The game's stage function at each position; `undefined` for a built-in stage. */
  readonly runs: readonly (Run | undefined)[];

  /** Where the after-stages start: every stage from here on runs for every blow, however it ended. */
  readonly afterFrom: number;

  /** The names of the game's stages, in declaration order (for the escape report). */
  readonly game: readonly string[];
}

/** Throws a load-time error about one game stage. */
const refuse = (what: string, name: string, problem: string): never => {
  throw new RangeError(`${what} stage ${name}: ${problem}`);
};

/** The index a stage goes to, from its anchor. */
const slotFor = (order: { names: string[]; afterCounts: Map<string, number> }, at: StagePosition): number => {
  if (at.before !== undefined) {
    return order.names.indexOf(at.before);
  }

  const anchor = at.after ?? '';
  const count = order.afterCounts.get(anchor) ?? 0;

  order.afterCounts.set(anchor, count + 1);

  return order.names.indexOf(anchor) + 1 + count;
};

/** Checks one game stage's definition against the order built so far. */
const checkStage = <Run>(names: readonly string[], parts: { what: string; name: string; def: StageDef<Run> }) => {
  const { what, name, def } = parts;

  if (names.includes(name)) {
    refuse(what, name, 'its name is taken.');
  }

  if ((def.before === undefined) === (def.after === undefined)) {
    refuse(what, name, 'give exactly one of before and after.');
  }

  if (typeof def.run !== 'function') {
    refuse(what, name, 'run must be a function.');
  }

  const anchor = def.before ?? def.after ?? '';

  if (!names.includes(anchor)) {
    refuse(what, name, `there is no stage ${anchor} before it.`);
  }
};

/**
 * Compiles a pipeline's stage order (§II.6 D1): the built-in stages in their documented order, with the game's stages
 * inserted at their declared positions, in declaration order. `boundary` is the last stage that can end a blow; any
 * stage placed after it is an after-stage.
 */
export const compileStageOrder = <Run>(spec: {
  /** The pipeline's name, for messages. */
  readonly what: string;

  /** The built-in stages, in order. */
  readonly builtIn: readonly string[];

  /** The last stage that can end a blow. */
  readonly boundary: string;

  /** The game's stages, by name, in declaration order. */
  readonly game: Readonly<Record<string, StageDef<Run>>> | undefined;
}): StageOrder<Run> => {
  const order = { names: [...spec.builtIn], afterCounts: new Map<string, number>() };
  const runs: (Run | undefined)[] = spec.builtIn.map(() => undefined);
  const game = Object.entries(spec.game ?? {});

  for (const [name, def] of game) {
    checkStage(order.names, { what: spec.what, name, def });

    const at = slotFor(order, def);

    order.names.splice(at, 0, name);
    runs.splice(at, 0, def.run);
  }

  return Object.freeze({
    names: Object.freeze(order.names),
    runs: Object.freeze(runs),
    afterFrom: order.names.indexOf(spec.boundary) + 1,
    game: Object.freeze(game.map(([name]) => name)),
  });
};
