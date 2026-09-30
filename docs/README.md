# Game integration documentation

These guides describe the implemented framework APIs, their contracts, and how a game supplies content and host adapters.
F22 documentation is being written one system at a time. The first completed guide is the detailed
[modifiers integration and API guide](modifiers.md); other system guides remain to be written.

## Guides and examples

| Guide                     | Coverage                                                                                                                                     | Runnable examples                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Modifiers](modifiers.md) | Stats, sources, fold order, conditions, scopes, aura gates, scaling, curves, snapshots, explanations, caching, watches, and game integration | [Basics](examples/modifiers-basic.ts), [host and scoped reads](examples/modifiers-host.ts), [values and snapshots](examples/modifiers-values.ts), [auras](examples/modifiers-auras.ts) |

Examples import public source entry points so they run before a package build. In a consumer game, use the corresponding
`spellweave/*` package subpaths. Their Node assertions are verification code rather than game runtime dependencies.

From the repository root, `npm run typecheck` checks examples with the rest of the project, `npm run lint` lints them,
and `npm run docs:check` executes them. Example execution is included in `npm run check` and CI.

## The model

- A **unit** is a bearer with identity, base stats, lifecycle, and game-owned fields. Heroes, creatures, and summons use the
  same generic mechanisms.
- A **spell** coordinates activation, a timeline, and outcomes. It reads stats and can retain snapshots for delayed hits.
- An **aura** is state held on a bearer, with stacks, clocks, modifiers, hooks, and owned event subscriptions.
- A **proc** is one outcome, such as damage or applying an aura; the game can add outcome kinds.
- An **area trigger** persists in the world, with geometry, lifetime, contacts, pulses, and effects on units inside it.
- A **script** supplies behavior attached to a unit, including bodiless units used for world scripts.
- **Modifiers** compute the numbers those systems read; **cues** carry numeric presentation events to the client.

The game defines content, supplies world and host interfaces, selects policies, and owns its step order, networking, and
presentation. The framework supplies deterministic execution and reusable state machinery.

[`PLAN.md`](../PLAN.md) remains the project design and phase record; system guides document implemented integration
contracts, and linked source doc blocks and tests provide the exact API and behavioral evidence.
