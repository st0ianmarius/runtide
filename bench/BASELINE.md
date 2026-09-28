# Benchmark baseline

`npm run bench` (tinybench, `bench/run.ts`), never part of `npm test`. Each task runs a batch of 1,000 operations per call, since one operation is far below the timer's resolution; the numbers are the mean time per operation.

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
