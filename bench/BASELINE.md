# Benchmark baseline

`npm run bench` (`bench/run.ts`), never part of `npm test`. Up to the fifth review the suite ran on tinybench, each task a batch of 1,000 operations per call, the numbers the mean time per operation; since then it runs on mitata (the last section), whose numbers are not comparable with the tables above it.

Recorded at F1 on the development container (Node 22.22.2, linux x64, shared and noisy), as the range of three runs. They are a first reference, not a budget: CI on a fixed machine type sets the budgets later (§I.5.4).

| benchmark                                        | ns per op |
| ------------------------------------------------ | --------- |
| registry `get(id)` + typed column read           | 21–29     |
| registry `has` bit + hook dispatch table call    | 11–14     |
| bitset `has`                                     | 9–14      |
| bitset `intersects` (an immunity check)          | 20–30     |
| timing wheel schedule + collect (15% overflow)   | 54–80     |
| keyed roll, 5-part key passed as arguments       | 34–66     |
| keyed roll, 4-part key in a reused scratch array | 30–43     |
| sequential stream draw                           | 11–12     |

Added at F2 (same container, Node 22.22.2, range of three runs). The fold reads a hero-like sheet: six sources, eleven modifiers over the two stats read (two of them in gated lists, one at three stacks, one conditional). "Live folded stats" evaluates a spell's damage (three adds, one amp) through a sheet's view, so it folds each stat it reads; a snapshot finish reads the caster's frozen stats and folds nothing, which is the per-hit cost.

| benchmark                                   | ns per op |
| ------------------------------------------- | --------- |
| modifier fold, two stats (6 sources, gates) | 241–311   |
| scaled value evaluation, live folded stats  | 271–291   |
| scaled value finish from a snapshot         | 67–68     |
| scaled cooldown through the haste curve     | 39–56     |

Added at F3 (same container, Node 22.22.2, range of the runs). "Apply ×3 + fold" re-applies three auras to one bearer (a `stack`, a `refresh` and a `highest` aura, each with modifiers, so each application restacks and queues nothing: no hook, no bus listener) and folds two stats through the aura gates. The horde tick steps the world clock of 2,000 bearers holding three auras each (one beating every 0.5 s, through the host), and is reported per tick, not per operation.

| benchmark                                     | per op     |
| --------------------------------------------- | ---------- |
| aura apply ×3 + fold two stats                | 690–855 ns |
| aura tick, 2,000 bearers × 3 auras (per tick) | 177–291 µs |

Added at F4 (same container, Node 22.22.2, range of three runs; `bench/procs-triggers.ts`). Trigger dispatch raises one `hit` about the first unit of a party whose every unit holds three auras: one with two self triggers, one with a `party` trigger, one with none. Every trigger passes a filter and runs one `grant` through the host, so one event fires 7 triggers in a party of 5 and 27 in a party of 25; the time is per event. The proc list runs 8 prepared procs (two aura landings that refresh or stack, a cleanse, grants to self, the event unit and the party, and a group behind one roll), per list.

| benchmark                                    | per op       |
| -------------------------------------------- | ------------ |
| trigger dispatch, owner + 4 party listeners  | 1.10–1.35 µs |
| trigger dispatch, owner + 24 party listeners | 4.56–5.55 µs |
| proc list run, 8 prepared procs              | 2.19–2.86 µs |

After the buffer fix (F5's first commit: hot reused arrays keep their storage and fill by index up to a count, instead of `length = 0`, which drops V8's backing store; bitset `clear` zeroes in place; aura removals use no closure), same container, range of three runs: timing wheel schedule + collect 41–65 ns, aura apply ×3 + fold 669–817 ns, aura tick 156–232 µs, proc list run 1.67–2.09 µs, trigger dispatch 1.09–1.38 µs and 3.82–4.56 µs. Outside tinybench, 1M aura apply + remove on one bearer went from 762 garbage collections to 43 with a bus listener (383 to 28 without), and from about 1.5–2.2 µs to 0.5–0.8 µs per pair.

Added at F5 (same container, Node 22.22.2, range of three runs; `bench/damage.ts`). "Full pipeline" is one blow by an attacker (an outgoing multiplier, a crit roll on a sequential stream, both at a spell's share) on a target whose three auras hook it (an ignore gate that passes, an absorb that spends its value, a damage-taken scale), through a block roll, two mitigation rows (hyperbolic armor, damage taken), health and one `taken` subscriber, per blow. The burst deals one such blow to each of 100 targets, per burst. A blow allocates only what V8 boxes and what the absorb hook returns: 28 minor GCs over 1M blows.

| benchmark                                | per op     |
| ---------------------------------------- | ---------- |
| blow, full pipeline, 3 hooking auras     | 490–740 ns |
| burst of 100 blows on 100 hooked targets | 54–71 µs   |

Added at F6 (same container, Node 22.22.2, range of three runs; `bench/cues.ts`). One tick fires 200 cues (120 impacts on units with a facing, 60 owner-only numbers, 15 casts with three params, 5 chains of four points), then encodes the batch; the time is per tick. "Specs" is the authoring path (`fireCue` with reused spec objects, params by name); "by slot" is the hot path (`emit`, then the params' slots resolved at load). The decoder reads one tick's bytes into a client buffer. One tick is 2,294 bytes (11.5 per cue). Over 20M cues the slot path and the decoder cause under 200 minor GCs, what V8 boxes; the spec path about 470, from reading the params by name.

| benchmark                                  | per tick |
| ------------------------------------------ | -------- |
| fire 200 specs + encode as bytes           | 54–58 µs |
| emit 200 by slot + encode as numbers       | 31–35 µs |
| decode 200 events from bytes into a buffer | 31–37 µs |

After the fast-properties fix (F7's first commit: `createPool`, `createScratch`, `createClock`, `createTimingWheel`, `createBus`, `createScope`, the proc system and the damage system returned object literals with getters, which V8 keeps in dictionary mode, so every method call was a hash lookup; each is now an internal class whose functions are arrow fields, still callable detached), same container, range of two runs: timing wheel schedule + collect 38–49 ns, trigger dispatch 0.80–0.90 µs and 3.01–3.38 µs, proc list run 1.73–1.99 µs. Outside tinybench, per operation (three runs each, before → after): 16 pool acquire + get + release 0.95–1.29 µs → 0.51–0.63 µs, a nested scratch take + give pair 43–55 ns → 15–19 ns, a clock step + reads + `stampAt` 108–138 ns → 84–100 ns, a bus payload + raise to one subscriber 44–48 ns → 12–19 ns, a scope `withOwner` + reads 49–53 ns → 10–15 ns.

Added at F7 (`bench/spells.ts`), measured on a different machine from the rows above: an Apple Silicon Mac (arm64, Node 25.8.1), range of three runs, so compare these rows with each other and not with the container's. As a yardstick, the F3 aura horde tick measures 96–101 µs per tick on this machine (156–232 µs on the container). The horde is 2,000 casters, each with an `auto` spell every 3 s that winds up 0.5 s, channels 2 s beating every 0.5 s (one prepared `grant` per beat) and recovers 0.25 s, staggered so their casts sit at different points of their course: about 1,820 of them have a spell in flight on any tick. A tick steps the clock, then each caster's auto clock and casts; the time is per tick. The instant cast runs the whole cast order with a stats table (one scaled value, one constant) and a release of one prepared proc. A delayed list is one `after(0)` scheduled through the proc runner and landed on the next tick. Over 3,000 horde ticks (6M caster steps) the horde causes 9 minor GCs, 1M instant casts about 31 and 1M delayed lists 2, which is what V8 boxes; the bench makes about 1,825 cast records while it warms up and none after.

| benchmark                                        | per op     |
| ------------------------------------------------ | ---------- |
| horde tick, 2,000 casters with a spell in flight | 124–125 µs |
| instant cast, table stats + release              | 337–357 ns |
| `after(0)` scheduled + landed, per list          | 328–336 ns |
| 1,000 `after(0)` lists landing on one tick       | 185–193 µs |

Added at F8 (`bench/world.ts`, `bench/area-triggers.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. The whole suite now loads more modules, so the F7 rows read higher in a full run than in F7's (the horde tick 140–141 µs); run alone, the horde tick measures 99–101 µs at F7's commit and at F8's, so F8 changed nothing there. The world holds 2,000 units spread evenly at random over 200 m square (about 4.5 m apart, half on each side, 0.5 m bodies), queried for the foes of one of them; the grid's cells are 4 m. A move tick moves every unit a little and updates the point index: the uniform grid in place, or the k-d tree rebuilt (with one query to force the build), which is why the grid is `createMemoryWorld`'s default (§I.5.4: the benchmarks decide it). The area trigger tick steps the clock, the world and 200 area triggers over 2,000 foes: 150 pools 3 m across beating every 0.5 s on their own clocks, and 50 missiles orbiting at 12 m/s whose contacts sweep a 0.5 m body relative to the units' motion and record in a `rehit` ledger of 1 s; every beat or contact that catches a unit runs one prepared `grant`. Over 3,000 ticks the area trigger tick causes about 9 minor GCs above the bench's own setup, and 3,000 grid move ticks (6M unit moves) about 33, which is what V8 boxes; the queries cause 1–4 per 3,000 calls. No area trigger record is made after warm-up.

| benchmark                                               | per op       |
| ------------------------------------------------------- | ------------ |
| world: `inside` a 6 m circle, 2,000 units (grid)        | 301–360 ns   |
| world: `nearest` foe within 10 m (grid)                 | 756–805 ns   |
| world: `densest` 3 m cluster within 15 m, 16 candidates | 4.4–4.9 µs   |
| world: `sweep` 40 m with a 0.5 m body (grid)            | 412–453 ns   |
| world: 2,000 units move, grid updated, per tick         | 77–80 µs     |
| world: 2,000 units move, k-d tree rebuilt + a query     | 171–179 µs   |
| `pathIntervals` a circle over one tick                  | 84–85 ns     |
| area triggers: 150 pools + 50 missiles over 2,000 units | 55.7–56.1 µs |

Added at F9 (`bench/abilities.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. 1,000 heroes each hold all three buttons down on every motion step: a dodge (1 s cooldown, a 0.5 s sprint aura, and a `travel` hook that moves the hero while it sprints), a skill blocked while sprinting (2 s) and an ultimate that resets the dodge's cooldown (4 s); every cast releases one prepared `grant`, about 58 of them a tick. A tick steps the clock, then each hero's auras, its press and its travel, so most of it is the aura tick (the aura system's own rows above); the press checks, the loadout reads and the travel hooks are about a fifth of the profile. Run alone, outside tinybench, the tick measures 134–135 µs. Over 3,000 ticks it causes about 18 minor GCs: the fires allocate their aura applications and argument tuples, which a press path that fires a few dozen times a tick can afford. In the same full runs the F7 horde tick reads 154–156 µs (140–141 µs in F8's), as the suite loads another module; the area trigger tick is unchanged.

| benchmark                                           | per op     |
| --------------------------------------------------- | ---------- |
| abilities: 1,000 heroes press three slots, per tick | 157–163 µs |

Added at F11 (`bench/combat-log.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. One landed blow raised on a core bus with one damage kind and recorded by a combat log of the default 4,096 entries, then the same with a damage meter subscribed. Over a million entries each, recording causes 0–2 minor GCs.

| benchmark                                     | per op   |
| --------------------------------------------- | -------- |
| combat log: a blow raised and recorded        | 45–46 ns |
| combat log: a blow recorded, meter subscribed | 59–63 ns |

Added at F13 (`bench/units.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. A unit system over an aura system whose modifiers fold through a modifier system, with each unit's own bases at its `base` source. A spawn makes the unit's aura state, caster state, stat sheet and view, and shares its template's compiled base list (a spawn with its own stats compiles one); units are not pooled yet, so a spawn allocates. The derived-state reads intersect the unit's aura tags with the states' bitsets; the folded stat reads a sheet with one aura modifier.

| benchmark                               | per op     |
| --------------------------------------- | ---------- |
| units: spawn + despawn a grunt          | 899–910 ns |
| units: canAct + canMove                 | 13 ns      |
| units: a folded stat (an aura modifier) | 41–42 ns   |

At F14 the block and crit stages became one roll stage over a declared roll table (`bench/damage.ts` rolls swarm's block-then-crit as an `independent` table, both rows reading a stat directly). On the Apple Silicon Mac, range of three full runs, a blow through the full pipeline measures 302–310 ns against 279–282 ns before it, and a burst of 100 blows 30.6–31.6 µs against 28.2–28.8 µs: about 25 ns a blow for the general row loop and the spell-share reads.

At F16, measured against the F15 commit in a worktree on the same Mac and the same day (two full runs each, since today's runs all sit above the F7 rows): the horde tick is 144–146 µs before and 145–146 µs after, the instant cast 408–410 ns before and 411–419 ns after (the reach check is one plan read for a spell with none), a delayed list 307–343 ns before and 327–337 ns after, and 1,000 lists landing on one tick 194–195 µs before and 208–221 µs after: the list of live delayed lists `withdrawDelayed` walks costs a push and a swap-remove per list. A unit spawn is 913–921 ns before and 948–950 ns after (one more field).

Added at F17 (`bench/units.ts`), same Apple Silicon Mac, range of three full runs. A tick of 2,000 thinking grunts, each with a pick timer restarted 1–3 s away whenever it fires (about 33 fire a tick at 30 Hz, each picking from four spells), measures 27.0–29.9 µs; a weighted pick of four `ai` spells, each checked through `spells.check`, 644–676 ns. The unit spawn row, now making and freeing a brain, measures 1,014–1,066 ns against 948–950 ns at F16 (another session was running on the machine during these runs); the horde is spawned on the tick task's first run so the spawn row does not carry it.

At F18 a unit spawn also gives the unit its summons list and, for an owned unit, joins its owner's: spawn plus despawn measures 1,023–1,092 ns, against 1,014–1,066 ns at F17, within the noise of these runs.

Added at F19 (`bench/units.ts`), same Apple Silicon Mac, range of three full runs. `scripts.step` over 2,000 units whose template names no script measures 2.0–2.5 µs a tick (a slot check each); over 2,000 scripted units with nothing due and no `tick` handler, 4.2–4.6 µs; and `scripts.collect` plus the step over 2,000 units whose one behaviour picks from four spells on a timer every 1–3 s, 35.2–36.9 µs, against 27.0–29.6 µs for the same picks fired straight from `ai.step`: the difference is the step loop and each handler's reused context.

At the review after F21 (P1), a stat read no longer walks every gated list the game defines. Before, every sheet held a copy of every aura's modifiers and a read asked the host's stacks for each one, so a read grew with the aura registry: over 2,000 bearers with 10% holding one aura, 31 ns per read with one speed aura defined, 121 ns with 10, 2.8 µs with 100 and 8.1 µs with 300 (and 16–38 KB of entries per sheet). Now the aura lists are compiled once for the system; a sheet points at a stat's shared entries where it has at most four gates at a fold position, and otherwise holds a marker where a read walks the host's held gates (`held: auraGates`): 30, 42, 38 and 44 ns for the same four registries. The new row reads a stat on a bearer holding 2 of 120 aura lists. Same Apple Silicon Mac, range of two full runs, against the F21 commit run the same day:

| benchmark                                       | F21            | now            |
| ----------------------------------------------- | -------------- | -------------- |
| fold a stat, 120 aura lists in the game, 2 held | about 3,000 ns | 80.6–81.6 ns   |
| units: a folded stat (an aura modifier)         | 43.1–44.1 ns   | 44.5–44.8 ns   |
| modifier fold, two stats (6 sources, gates)     | 121.3–126.6 ns | 129.1–129.2 ns |
| scaled value evaluation (live folded stats)     | 142.9–146.3 ns | 155.2–156.8 ns |
| units: spawn + despawn a grunt (template stats) | 1,005–1,015 ns | 1,198–1,218 ns |

The spawn row reads 961 ns in a run without the 120-aura system: that second modifier system, whose sheets hold markers, makes the sheet build polymorphic in the one bench process, which a game with one modifier system does not see. The F21 figure for the new row is the old read's cost at 100–120 lists from the numbers above.

At the review after F21 (P2), a caster steps only the `auto` clocks it has armed (`spells.arm`: a template's `autoAttack` at spawn, a card as the game grants it), in place of one clock per `auto` spell of the registry, each unowned one asking `host.owns` every step once it ran out (the host hook is gone). With 20 `auto` spells defined and 2,000 casters owning one each, far from casting, the auto step measured 155–162 µs a tick before (a scratch bench on the F21 code) and 17–20 µs now. The bench registry now defines the 20: the horde tick still arms only `strike` and measures 142.8 µs (142.8–145.2 µs at P1, with one `auto` spell defined), and the new row steps 2,000 idle casters with one of the 20 armed. Same Apple Silicon Mac, range of two full runs:

| benchmark                                                      | per op         |
| -------------------------------------------------------------- | -------------- |
| spells: auto step, 2,000 casters, 1 of 20 auto spells armed    | 20.2–20.3 µs   |
| spells: horde tick, 2,000 casters in flight (tick)             | 142.8 µs       |
| units: spawn + despawn a grunt (template stats), now arming it | 1,133–1,163 ns |

At the review after F21 (P3), an `auto` activation takes a `ready` hook: while it answers no, a run-out clock waits at zero and no cast is attempted. A melee swing out of reach otherwise polls a whole refused cast every step (a pooled cast, the host's id, rank and variant, the gates, the stats table, the target and reach, the interval), which is most of a walking horde. Same Apple Silicon Mac, range of two full runs; the two new rows arm 2,000 mobs each with a swing whose target is out of reach:

| benchmark                                                | per tick   |
| -------------------------------------------------------- | ---------- |
| spells: 2,000 mobs, swing out of reach, polling a cast   | 529–553 µs |
| spells: 2,000 mobs, swing out of reach, waiting on ready | 48–49 µs   |

At the review after F21 (P4), `areaTriggers.stepOwner` walks the owner's own area triggers: each owner keeps its own tick-order lists, in the order of the whole walk (a child placed after its parent lands after its owner's area trigger just before it), and an owner with none costs one lookup. Before, it walked every live area trigger of the slot and kept the owner's. The new row steps the area trigger tick owner by owner, as a game stepping each unit's area triggers in its own movement loop does (§II.6.1 rule 1): the 2,000 foes, which own none, then the ten owners. Same Apple Silicon Mac, range of two full runs; before, from a run at the P3 commit:

| benchmark                                                   | before | now      |
| ----------------------------------------------------------- | ------ | -------- |
| areas: 150 pools + 50 missiles over 2,000 units (tick)      | 51 µs  | 53–55 µs |
| areas: the same, stepped owner by owner, 2,010 units (tick) | 461 µs | 76 µs    |

At the review after F21 (P6), distances are one correctly rounded square root (`hypot` in `runtide/math`, in place of `Math.hypot`, which the spec only approximates and which boxes a number where V8 does not inline it), the merge sort passes no tuple, a query limited to one unit scans for it in place of sorting every unit it keeps, and `count` sorts nothing unless a limit or a separation needs the order. The new row asks for the nearest foe in a horde crowding its target (2,000 foes within 30 m). Same Apple Silicon Mac, one full run each, against the P4 commit the same day:

| benchmark                                               | P4       | now      |
| ------------------------------------------------------- | -------- | -------- |
| world: nearest foe in a crowd, 2,000 within 30 m (grid) | 185.7 µs | 50.4 µs  |
| world: nearest foe in 10 m (grid)                       | 681 ns   | 545 ns   |
| world: sweep 40 m, body 0.5 (grid)                      | 419 ns   | 344 ns   |
| world: 2,000 units move, grid updated (tick)            | 76.5 µs  | 51.3 µs  |
| world: 2,000 units move, k-d rebuilt + a query (tick)   | 167.9 µs | 129.7 µs |
| world: seconds inside a ring over one tick              | 83.9 ns  | 65.3 ns  |

At the review after F21 (P7), a step of a bearer's clock first scans its auras for anything to do (an aura on that clock counting down, beating or with its own expiry rule, or any aura that has run out) and returns before opening its events when there is nothing: a bearer holding only a passive and a long buff no longer runs the expiry walk and the event bookkeeping every tick. The new row ticks 2,000 such bearers. Same Apple Silicon Mac, one full run each, against the P6 commit the same day:

| benchmark                                                  | P6       | now      |
| ---------------------------------------------------------- | -------- | -------- |
| aura tick, 2,000 bearers x 2 auras, nothing due (per tick) | 90.7 µs  | 53.8 µs  |
| aura tick, 2,000 bearers x 3 auras (per tick)              | 133.3 µs | 122.8 µs |
| abilities: 1,000 heroes press 3 slots (tick)               | 174.6 µs | 161.1 µs |

At the review after F21 (P5), a spawn stops rebuilding what every unit of its template shares: sheets holding the same compiled lists (a template's units, each given its template's base list) share one compiled cache, built by the first and kept weakly by its first list; a unit spawned without stats of its own shares its template's base array (a unit's bases are now read-only, `ArrayLike<number>`); an aura state with no countdown overrides shares the system's clock rules; and a source's lists are checked with no closure. Same Apple Silicon Mac, one full run each, against the P7 commit the same day (a second full run after the change read 394 ns):

| benchmark                                       | P7       | now     |
| ----------------------------------------------- | -------- | ------- |
| units: spawn + despawn a grunt (template stats) | 1,175 ns | 379 ns  |
| units: a folded stat (an aura modifier)         | 44.0 ns  | 41.0 ns |

One full run read the thinkers' row at 15.9 ms, once: the next full run and a run of the unit rows alone read 34.6 µs and 35.0 µs, as before.

At the review after F21, a pool handle stays a small integer: 20 bits of slot (1,048,576 items a pool, down from 4,194,304) and 11 of generation, which wraps after 2,047 reuses of a slot, read with bit operations. Before, the generation sat above 22 bits of slot, so a slot reused about 500 times made its handles heap numbers read through float division and modulo: every cast, aura, delayed list and area trigger lookup of a long-running game. Released slots are now reused oldest first, so a slot comes round only after every other free one and a kept handle needs 2,047 turns of the whole free list to read as live again. `isLive` measured 1.3 ns on a fresh slot and 6.5 ns on a slot reused 5,000 times before; 1.2 and 3.4 ns now. Same Apple Silicon Mac, one full run each, against the P5 commit the same day:

| benchmark                                              | P5       | now      |
| ------------------------------------------------------ | -------- | -------- |
| spells: horde tick, 2,000 casters in flight (tick)     | 139.2 µs | 119.5 µs |
| spells: 2,000 mobs, swing out of reach, polling a cast | 517.4 µs | 402.2 µs |
| spells: instant cast, table stats + release            | 412.9 ns | 355.0 ns |
| spells: after(0), scheduled + landed (per list)        | 296.5 ns | 242.4 ns |
| spells: 1,000 after(0) landing on one tick (tick)      | 170.3 µs | 144.0 µs |
| ai: 2,000 brains, a pick timer each every 1–3 s (tick) | 26.6 µs  | 22.1 µs  |
| ai: a weighted pick of 4 spells (checked)              | 585.9 ns | 440.2 ns |

At the review after F21, the smaller hot-path items: indexed loops where an iterator over a frozen list allocated (a scaled value's caster stats at every cast start, a proc group, the weighted draw an AI pick makes, the polygon tests a catch runs per unit, a stat watch); `stepsUntil` remembers walks of 64 steps or more by rule, step and length (a 60 s aura applied at 30 Hz walked 1,800 steps each time); a `hottest` shared beat marks each unit's hottest catch in one pass instead of comparing every catch with every other (1.2 ms a beat with 40 patches in a crowd, per the review); and an AI interrupt edge reads its hold bit from a map. None of the suite's rows runs these paths hot, and a full run against the pool commit reads within its noise.

At the review after F21's hooks for swarm, `bench/horde.ts` adds one row for a whole unit game, which no row had measured together: 2,000 grunts and 4 heroes on the unit system, in a game with 120 auras and 41 spells defined (what swarm carries). Each tick steps the clock, every unit's auras (each grunt holds a haste and a mark; the lead hero a slow its grunts' swings refresh), walks every grunt toward the heroes at its folded speed, steps each grunt's auto swing (a `ready` hook reading the distance the walk measured, `afterCast: 'reset'`) and casts, fires the brains' picks (a 0.5 s windup from a pool of four, every 1–3 s), lands the delayed lists, and has the heroes kill 10 grunts, which are despawned and replaced at the edge. The runner loads it only after every other row has run, since a whole game made at load changed the type feedback of rows it never touches (the blow pipeline read 15% slower in a full run with it loaded first, while alone it matched R2). Writing it found a leak: a despawned unit kept its auras, so a game replacing its units filled the aura pool; a despawn now releases them (`auras.release`).

The hooks themselves cost nothing on the rows they touch. Same Apple Silicon Mac, one full run at the R2 commit against two with the hooks, and, since a full run moves rows R3 never touched (the 5-part keyed roll 13.8 → 22 ns, the modifier fold and scaled evaluation by 8–10%, the cue ticks by 7%), the damage, unit spawn and delayed-list rows run alone at both commits:

| benchmark                                                | R2       | now (two runs)     | alone, R2 → now  |
| -------------------------------------------------------- | -------- | ------------------ | ---------------- |
| horde: 2,000 mobs + 4 heroes, the whole unit game (tick) |          | 303.7 µs, 308.2 µs |                  |
| blow, full pipeline, 3 hooking auras                     | 307.0 ns | 293.3 ns, 301.1 ns | 272.8 → 277.0 ns |
| burst of 100 blows on 100 hooked targets                 | 30.6 µs  | 30.0 µs, 30.6 µs   | 27.6 → 28.1 µs   |
| spells: auto step, 2,000 casters, 1 of 20 armed (tick)   | 20.8 µs  | 20.7 µs, 20.1 µs   |                  |
| spells: 2,000 mobs, swing out of reach, waiting on ready | 49.3 µs  | 43.0 µs, 43.6 µs   |                  |
| spells: after(0), scheduled + landed (per list)          | 262.1 ns | 250.3 ns, 255.2 ns | 165.5 → 151.9 ns |
| units: spawn + despawn a grunt (template stats)          | 399.2 ns | 408.3 ns, 415.7 ns | 375.1 → 385.4 ns |

A spawn and despawn costs about 10 ns more: the despawn now tells the unit's auras its state (`onState`) and releases them. A blow walks the attacker's `onOutgoingDamage` auras only in a game that has one. The whole-game tick is about 1% of a 30 Hz frame; run alone, outside tinybench, it measures 240–263 µs.

After the review, every clock keeps one timing (§II.6.1 rule 4): a countdown snaps to zero below `1e-6`, and a stamp is `⌈(seconds − 1e-6) / dt⌉` steps away, computed rather than walked step by step (the remembered walks are gone). The per-clock countdown rules, the per-bearer overrides and the auras' countdown mode are gone, so an aura tick no longer asks whether its clock counts down, and a countdown step no longer asks its rule whether it snaps. Same Apple Silicon Mac, one full run against the two full runs above; the rows this change touches:

| benchmark                                                | before (two runs)  | now      |
| -------------------------------------------------------- | ------------------ | -------- |
| aura tick, 2,000 bearers x 3 auras (per tick)            | 120.2 µs, 125.3 µs | 104.8 µs |
| aura tick, 2,000 bearers x 2 auras, nothing due          | 48.3 µs, 49.0 µs   | 43.4 µs  |
| aura apply x3 + fold two stats                           | 374.8 ns, 375.2 ns | 341.1 ns |
| spells: auto step, 2,000 casters, 1 of 20 armed (tick)   | 20.7 µs, 20.1 µs   | 18.6 µs  |
| spells: horde tick, 2,000 casters in flight (tick)       | 119.8 µs, 119.4 µs | 113.9 µs |
| spells: instant cast, table stats + release              | 350.6 ns, 347.3 ns | 314.8 ns |
| spells: 1,000 after(0) landing on one tick (tick)        | 153.6 µs, 153.0 µs | 143.7 µs |
| ai: 2,000 brains, a pick timer each every 1–3 s (tick)   | 24.4 µs, 24.5 µs   | 20.0 µs  |
| areas: 150 pools + 50 missiles over 2,000 units (tick)   | 50.9 µs, 50.7 µs   | 51.0 µs  |
| horde: 2,000 mobs + 4 heroes, the whole unit game (tick) | 303.7 µs, 308.2 µs | 304.9 µs |

Rows the change does not touch moved within their usual noise in both directions (the cue ticks 7% faster, the nearest foe in 10 m 4% slower).

## The fourth review: a co-op bench and the crowd costs

The horde bench runs at 30 Hz with no world and no area triggers, and the area trigger bench spreads its units so a catch finds almost no one. `bench/coop.ts` is swarm's busy co-op wave instead: 350 mobs crowding 4 heroes in a memory world moved every tick, at 60 Hz, each hero with a chilling field (an area aura) and a nova pulsing on the crowd, bolts every 0.25 s and pools every 2 s, the dead replaced by the current wave's mobs. The budget is swarm's tick: 0.57 ms at 300 mobs, of which the framework may cost at most a tenth more than swarm's own code does today.

Measured outside tinybench on the Apple Silicon Mac (1,200 warm-up ticks, then the median of five runs of 2,000 ticks), at each step of the review:

| change                                                       | co-op tick | 2,000-mob horde tick |
| ------------------------------------------------------------ | ---------- | -------------------- |
| before                                                       | 103 µs     | 205 µs               |
| catches ordered by a radix sort on the ids                   | 98 µs      |                      |
| area auras compare each frame's catch with the last          | 92 µs      |                      |
| a bearer's aura tick scheduled by its earliest end and beats | 94 µs      | 176 µs               |
| unit variants: a wave's bases compiled once                  | 86 µs      |                      |
| position reads and views fill the caller's objects           | 86 µs      |                      |

A 150-unit catch goes from 8.4 to 6.5 µs. What the co-op tick still spends most on is the world's unit-to-slot lookups (a `Map` keyed by unit, about a tenth) and stat folds on every read (a mob's speed, folded through its auras each step, about a sixth): a per-sheet cache keyed by the bearer's aura revision is the next step if a game needs it.

## The fifth review: kept totals, id slots and stamped clocks

Measured the same way, each change against the commit before it in a worktree, runs interleaved (the machine was loaded that day, so the absolute numbers sit a few percent above the fourth review's; read the differences):

| change                                                             | co-op tick | 2,000-mob horde tick |
| ------------------------------------------------------------------ | ---------- | -------------------- |
| before                                                             | 87 µs      | 192 µs               |
| a sheet keeps a stat's plain total until its bearer's auras change | 78 µs      | unchanged            |
| the world finds a unit's slot by its entity id (`idOf`)            | 77 µs      |                      |
| `auto` clocks stamped on the caster's steps, not counted down      |            | 188 µs               |
| spells read a live definition unchecked on per-step paths          |            | 186 µs               |

The abilities tick did not move (92–94 µs outside tinybench): an aura not held is answered without a walk and a press allocates nothing, but the tick is bound by reading a thousand heroes' records, not by the checks. What a horde mob with nothing due still costs is its aura clock's count, written every tick per bearer, which stays: a clock counts only for the bearers the game steps.

## Mitata: medians, allocations and the JIT

The suite now runs on [mitata](https://github.com/evanwashere/mitata): one operation per iteration (no hand-made batches), the result kept live with `do_not_optimize`, and each row's distribution (min, p75, p99, max) and the heap it allocates per iteration printed beside its mean. Under `--expose-gc` (the `bench` script) mitata collects garbage before each row, so one row's garbage is not the next row's pause.

- `npm run bench [filter]` runs every row, or those whose names the filter (a case-blind pattern) matches; a late phase (the whole-game horde, the co-op game) whose rows the filter leaves out is never loaded.
- `npm run bench:ab <ref> [filter]` runs the working tree's rows over a commit's `src/` in a temporary worktree and over the working tree's, twice each, alternating, and prints each row's faster median side by side, flagging a change of 5% or more.
- `npm run bench:jit <filter> [function]` runs the rows under `--trace-deopt` and `--trace-turbo-inlining` and sums up the deoptimisations and the calls TurboFan would not inline; with a function name, also where it was inlined and what it inlined. The whole trace is kept in `.bench/jit.txt`.
- `npm run bench:prof [filter]` writes a CPU profile to `.bench/` for Chrome DevTools or speedscope.
- `npm run bench:alloc [filter] [--sites[=N]]` prints what each row allocates per run, short-lived garbage included (V8's sampling heap profiler with collected objects kept), and with `--sites` the N sites that allocate most, each with its callers. Inlined callees allocate in their caller's name; under `node --no-turbo-inlining --no-maglev-inlining bench/alloc.ts …` they show apart, with the boxing inlining would have spared.

A/B comparisons read medians: a row's mean includes the collector's pauses, which swing from run to run (the whole-game horde's ticks run from 201 µs to 3.75 ms, a mean of about 300 µs over a median near 276 µs). The heap column shows where ticks allocate: the out-of-reach polling row allocates about 0.5 MB a tick, the whole-game horde about 165 KB and the co-op tick about 41 KB, which the medians below do not show.

Recorded on the Apple Silicon Mac (M4 Pro, Node 25.8.1), one full run, medians:

| benchmark                                                          | median   |
| ------------------------------------------------------------------ | -------- |
| registry get(id) + column read                                     | 8.5 ns   |
| registry has-bit + hook table dispatch                             | 4.7 ns   |
| bitset has                                                         | 5.6 ns   |
| bitset intersects (immunity check)                                 | 11.0 ns  |
| timing wheel schedule + collect (15% overflow)                     | 31.9 ns  |
| keyed roll, 5-part key (spread)                                    | 25.3 ns  |
| keyed roll, 4-part scratch key                                     | 21.6 ns  |
| sequential stream draw                                             | 2.8 ns   |
| modifier fold, two stats (6 sources, gates)                        | 122.5 ns |
| scaled value evaluation (live folded stats)                        | 142.0 ns |
| scaled value finish from a snapshot                                | 43.9 ns  |
| scaled cooldown through the haste curve                            | 29.8 ns  |
| aura apply x3 + fold two stats                                     | 332.6 ns |
| fold a stat, 120 aura lists in the game, 2 held                    | 88.9 ns  |
| aura tick, 2,000 bearers x 3 auras (per tick)                      | 113.6 µs |
| aura tick, 2,000 bearers x 2 auras, nothing due (per tick)         | 28.9 µs  |
| trigger dispatch, owner + 4 party listeners                        | 484.9 ns |
| trigger dispatch, owner + 24 party listeners                       | 2.1 µs   |
| proc list run, 8 prepared procs                                    | 872.5 ns |
| blow, full pipeline, 3 hooking auras                               | 375.0 ns |
| burst of 100 blows on 100 hooked targets                           | 35.4 µs  |
| cues: fire 200 specs + encode bytes (tick)                         | 27.2 µs  |
| cues: emit 200 by slot + encode numbers (tick)                     | 18.3 µs  |
| cues: decode 200 events from bytes (tick)                          | 12.8 µs  |
| spells: horde tick, 2,000 casters in flight (tick)                 | 97.4 µs  |
| spells: auto step, 2,000 casters, 1 of 20 auto spells armed (tick) | 7.6 µs   |
| spells: 2,000 mobs, swing out of reach, polling a cast (tick)      | 423.9 µs |
| spells: 2,000 mobs, swing out of reach, waiting on ready (tick)    | 45.2 µs  |
| spells: instant cast, table stats + release                        | 337.2 ns |
| spells: after(0), scheduled + landed (per list)                    | 375.0 ns |
| spells: 1,000 after(0) landing on one tick (tick)                  | 163.8 µs |
| world: inside r 6, 2,000 units (grid)                              | 306.0 ns |
| world: nearest foe in a crowd, 2,000 within 30 m (grid)            | 41.4 µs  |
| world: nearest foe in 10 m (grid)                                  | 505.8 ns |
| world: sweep 40 m, body 0.5 (grid)                                 | 440.2 ns |
| world: 2,000 units move, grid updated (tick)                       | 35.5 µs  |
| world: 2,000 units move, k-d rebuilt + a query (tick)              | 98.6 µs  |
| world: a body crossing a circle over one tick                      | 57.8 ns  |
| areas: 150 pools + 50 missiles over 2,000 units (tick)             | 43.3 µs  |
| areas: the same, stepped owner by owner, 2,010 units (tick)        | 66.3 µs  |
| abilities: 1,000 heroes press 3 slots (tick)                       | 97.6 µs  |
| combat log: a blow raised and recorded                             | 33.3 ns  |
| combat log: a blow recorded, a meter subscribed                    | 56.2 ns  |
| units: spawn + despawn a grunt (template stats)                    | 631.4 ns |
| scripts: step 2,000 unscripted grunts (tick)                       | 2.3 µs   |
| scripts: step 2,000 scripted units, nothing due (tick)             | 5.4 µs   |
| scripts: collect + step 2,000 thinkers, a pick every 1–3 s (tick)  | 28.6 µs  |
| ai: 2,000 brains, a pick timer each every 1–3 s (tick)             | 39.8 µs  |
| ai: a weighted pick of 4 spells (checked)                          | 443.8 ns |
| units: canAct + canMove                                            | 14.1 ns  |
| units: a folded stat (an aura modifier)                            | 11.6 ns  |
| horde: 2,000 mobs + 4 heroes, the whole unit game (tick)           | 275.9 µs |
| co-op: 350 mobs on 4 heroes, 60 Hz, fields + AoE (tick)            | 85.5 µs  |
