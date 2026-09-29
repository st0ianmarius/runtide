# spellweave

A deterministic, engine-agnostic gameplay framework for MMO-like games: spells, auras, procs, triggers, modifiers and cues, woven together, in pure TypeScript with no rendering or networking dependencies.

Built so far: the scaffold (phase F0), the deterministic core and math (phase F1: `spellweave/core`, `spellweave/math`), modifiers with stat scaling and curves (phase F2: `spellweave/modifiers`), auras on any bearer (phase F3: `spellweave/auras`), procs and triggers (phase F4: `spellweave/procs`, `spellweave/triggers`), the damage, heal, force and death pipelines (phase F5: `spellweave/damage`), cues with their wire encoding (phase F6: `spellweave/cues`), spells with their activations, timeline, runner, delayed procs and auto clocks (phase F7: `spellweave/spells`), area triggers with the world they ask (phase F8: `spellweave/area-triggers`, `spellweave/world`), abilities: button activations, slots and loadouts (phase F9: `spellweave/abilities`), the prediction and replication contracts (phase F10: `spellweave/prediction`, `spellweave/replication`), the combat log with its damage meter (phase F11: `spellweave/combat-log`), conditions, one predicate language modifiers and triggers read (phase F12: `spellweave/conditions`), the unit model with its lifecycle and derived states (phase F13: `spellweave/units`), the combat roll table of outcome rows in the damage pipeline (phase F14), cooldowns as auras with time-left changes and clock rescales (phase F15), cast rules: reach gates, states interrupting casts, death cancelling them and owned telegraphs withdrawn or paused (phase F16), the AI toolkit: named timers, the weighted spell picker, a focus and movement intents (phase F17: `spellweave/ai`), summons: ownership, credit, bound despawns and the summon procs (phase F18), creature scripts: behaviours with spawn, tick, timer and bound-event hooks (phase F19: `spellweave/creature-scripts`), the caster's own rank and variant from the host, in place of a spellbook (phase F20), and world scripts as creature scripts on bodiless units, with shared state and instance counts (phase F21). [`PLAN.md`](PLAN.md) is the single source of truth: the ground rules, the layout, the systems and the phases.

## The model

- A **spell** is the container: an activation (an auto-attack clock, a button, a passive, a trigger, an AI brain, a world event), a timeline of stages the host steps per caster, and the procs it runs at each moment, now or later (`after`).
- An **ability** is a spell whose activation is a button: its cooldown is an aura on the slot it sits in, its cost is aura stacks, and a unit's loadout says which ability each slot holds.
- An **aura** is a stateful effect on any unit: stacks, clocks, periodic beats, modifiers, damage hooks, and the triggers it owns.
- A **proc** is one outcome (damage, apply an aura, spawn an area trigger, …); games add their own kinds.
- An **area trigger** is what persists in the world: a shape with a lifetime, a frame the host steps per tick slot, pulses, swept contacts, hit ledgers and the auras it keeps on the units inside; it asks the world through a narrow `WorldQuery` (a memory world with a grid is built in).
- A **cue** is a numeric id with numeric params, fired in order into a per-tick buffer and encoded with only the params that differ from their defaults. The simulation emits ids and numbers only; the client owns every name, text, icon, sound and effect.

A game plugs in by defining its resources as plain objects and functions, registering them (each gets a dense numeric id), and implementing narrow host interfaces: the world query, the clock, the random streams, the damage sink and cue output. Everything runs on a fixed-step clock and seeded randomness, so two runs agree to the bit, on the server, in the browser and in a worker.

spellweave is built for MMO-like games in general, not around any one game. Every behaviour it ships is a documented contract with a sensible default. Where a game needs a rule of its own (a countdown epsilon, a stacking or merge rule, how a derived stat measures its gain, a curve), it writes that rule in its own code on a declared escape hatch: hooks, pluggable rules and functions, custom curves, host interfaces and typed `ext` slots. The framework grows a hatch when a game needs one, never a mode for one game.

## Not published

spellweave is `"private": true` and is never published to npm or any other registry. Consume it straight from this repository (a git dependency or a local folder); see §I.8 of the plan.

## Development

Requires Node `^22.22.2 || >=24.15.0`: Node's built-in type stripping runs the `.ts` sources and tests directly, and the dev toolchain (`lint-staged`) sets that floor.

```sh
npm ci
npm run check         # typecheck, lint, format check, tests, build
npm run knip          # no unused files, exports or dependencies
npm run bundle:check  # src/ bundles for the browser without any Node built-in
npm run bench         # tinybench benchmarks (bench/BASELINE.md), never part of npm test
npm run format        # oxlint --fix, then prettier --write
```

`npm ci` installs a pre-commit hook (`simple-git-hooks` running `lint-staged`) that lints and formats the staged files.

### Toolchain

- **TypeScript 7.0.2**, the native compiler (`tsc` from the `typescript` package), on ES2024 (the newest year Node 22 fully supports). `tsconfig.json` typechecks `src/`, `tests/` and `bench/` with Node types. `tsconfig.src.json` typechecks `src/` again with no Node or DOM types. `tsconfig.build.json` emits `dist/` from `src/` only.
- **oxlint** lints, with type-aware rules run by `oxlint-tsgolint`, which is built on TypeScript 7's compiler. `.oxlintrc.json` holds the rules, including a set that prefers modern syntax (`Object.hasOwn`, `.at()`, spread, optional chaining, `??=`); `oxlint-plugin.js` adds the project rules oxlint has no native rule for (doc blocks on exports, naming, import order, blank lines); oxlint's JS plugin API is still alpha, which is one more reason every tool is pinned exactly. The linter reads the root `tsconfig.json`, so tests and benchmarks are linted with Node types, and `src/` is kept off Node by the lint bans and `tsconfig.src.json`. Only `src/**/*-adapter.ts` and `src/**/ids.ts` (the branded-id constructors) may use `as` casts.
