# spellweave

A deterministic, engine-agnostic gameplay framework for MMO-like games: spells, auras, procs, triggers, modifiers and cues, woven together, in pure TypeScript with no rendering or networking dependencies.

Nothing is built yet beyond the scaffold (phase F0). [`PLAN.md`](PLAN.md) is the single source of truth: the ground rules, the layout, the systems and the phases.

## The model

- A **spell** is the container: an activation (an auto-attack clock, a button, a passive, a trigger, an AI brain, a world event), a timeline of stages, and the procs it runs when it lands.
- An **aura** is a stateful effect on any unit: stacks, clocks, periodic beats, modifiers, damage hooks, and the triggers it owns.
- A **proc** is one outcome (damage, apply an aura, spawn an area trigger, …); games add their own kinds.
- An **area trigger** is what persists in the world: a shape with a lifetime, pulses and hit policies.
- A **cue** is a numeric id with numeric params. The simulation emits ids and numbers only; the client owns every name, text, icon, sound and effect.

A game plugs in by defining its resources as plain objects and functions, registering them (each gets a dense numeric id), and implementing narrow host interfaces: the world query, the clock, the random streams, the damage sink and cue output. Everything runs on a fixed-step clock and seeded randomness, so two runs agree to the bit, on the server, in the browser and in a worker.

## Not published

spellweave is `"private": true` and is never published to npm or any other registry. Consume it straight from this repository (a git dependency or a local folder); see §I.8 of the plan.

## Development

Requires Node `^22.22.2 || >=24.15.0`: Node's built-in type stripping runs the `.ts` sources and tests directly, and the dev toolchain (`lint-staged`) sets that floor.

```sh
npm ci
npm run check         # typecheck, lint, format check, tests, build
npm run knip          # no unused files, exports or dependencies
npm run bundle:check  # src/ bundles for the browser without any Node built-in
npm run format        # oxlint --fix, then prettier --write
```

`npm ci` installs a pre-commit hook (`simple-git-hooks` running `lint-staged`) that lints and formats the staged files.

### Toolchain

- **TypeScript 7.0.2**, the native compiler (`tsc` from the `typescript` package). `tsconfig.json` typechecks `src/` with no Node or DOM types, `tsconfig.test.json` adds Node types for tests, and `tsconfig.build.json` emits `dist/`.
- **oxlint** lints, with type-aware rules run by `oxlint-tsgolint`, which is built on TypeScript 7's compiler. `.oxlintrc.json` holds the rules; `oxlint-plugin.js` adds the project rules oxlint has no native rule for (no classes, `new` only for built-ins, doc blocks on exports, naming, import order, blank lines); oxlint's JS plugin API is still alpha, which is one more reason every tool is pinned exactly. `tests/tsconfig.json` only points the linter at `tsconfig.test.json`, so tests are linted with Node types.
