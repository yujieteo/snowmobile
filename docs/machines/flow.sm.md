# snowmobile flow: hunt, idea, grill and stack job

Source: shared/flow.ts. The test test/machines.test.ts compares each row to the table in the code. An event that has no row is refused (HTTP 409). Each `-` row is an ignored event.

## Requirements

- R1: A hunt runs one step at a time. A second hunt or create request while a step runs changes nothing. — test/page.test.ts "a double tap on Hunt makes 1 hunt"
- R2: A failed or finished hunt can hunt or create again. — README.md
- R3: Only an owner action or a prior-art result moves an idea to the graveyard. A grill result moves only a survivor. — B1
- R4: A grill answers one round at a time. The owner can undo the last round. — README.md
- R5: A stack job runs one at a time. A failed job can start again. — test/stack.test.ts

## Bugs

- B1: A late grill result moves a buried idea to grilled or killed. — test/machines.test.ts "a late grill result does not revive a buried idea" fails on fc12b04

## Machine hunt

initial: seeded
final: 

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| seeded | seed | | hunting | R1 | shared/flow.ts:10 |
| seeded | seed_stack | | creating | R1 | shared/flow.ts:10 |
| hunting | hunt_done | | hunted | R1 | shared/flow.ts:11 |
| hunting | fail | | failed | R1 | shared/flow.ts:11 |
| hunting | hunt | | - | R1 | shared/flow.ts:11 |
| hunting | create | | - | R1 | shared/flow.ts:11 |
| hunted | hunt | | hunting | R2 | shared/flow.ts:12 |
| hunted | create | | creating | R2 | shared/flow.ts:12 |
| creating | create_done | | created | R1 | shared/flow.ts:13 |
| creating | fail | | failed | R1 | shared/flow.ts:13 |
| creating | hunt | | - | R1 | shared/flow.ts:13 |
| creating | create | | - | R1 | shared/flow.ts:13 |
| created | hunt | | hunting | R2 | shared/flow.ts:14 |
| created | create | | creating | R2 | shared/flow.ts:14 |
| failed | hunt | | hunting | R2 | shared/flow.ts:15 |
| failed | create | | creating | R2 | shared/flow.ts:15 |

## Machine idea

initial: candidate
final: 

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| candidate | pass | | survivor | R3 | shared/flow.ts:26 |
| candidate | exile | | graveyard | R3 | shared/flow.ts:26 |
| survivor | bury | | graveyard | R3 | shared/flow.ts:27 |
| survivor | finish | | grilled | R3 | shared/flow.ts:27 |
| survivor | kill | | killed | R3 | shared/flow.ts:27 |
| survivor | undo | | - | R3 | shared/flow.ts:27 |
| graveyard | restore | | survivor | R3 | shared/flow.ts:28 |
| grilled | undo | | survivor | R3 | shared/flow.ts:29 |
| killed | undo | | survivor | R3 | shared/flow.ts:30 |

## Machine grill

initial: fresh
final: 

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| fresh | open | | thinking | R4 | shared/flow.ts:41 |
| thinking | open | | - | R4 | shared/flow.ts:42 |
| thinking | answer | | - | R4 | shared/flow.ts:42 |
| thinking | retry | | - | R4 | shared/flow.ts:42 |
| thinking | round | | asking | R4 | shared/flow.ts:42 |
| thinking | finish | | done | R4 | shared/flow.ts:42 |
| thinking | kill | | killed | R4 | shared/flow.ts:42 |
| thinking | error | | failed | R4 | shared/flow.ts:42 |
| thinking | undo | | asking | R4 | shared/flow.ts:42 |
| asking | open | | - | R4 | shared/flow.ts:43 |
| asking | answer | | thinking | R4 | shared/flow.ts:43 |
| asking | kill | | killed | R4 | shared/flow.ts:43 |
| asking | retry | | - | R4 | shared/flow.ts:43 |
| asking | undo | | asking | R4 | shared/flow.ts:43 |
| failed | open | | - | R4 | shared/flow.ts:44 |
| failed | answer | | thinking | R4 | shared/flow.ts:44 |
| failed | retry | | thinking | R4 | shared/flow.ts:44 |
| failed | undo | | asking | R4 | shared/flow.ts:44 |
| done | open | | - | R4 | shared/flow.ts:45 |
| done | undo | | asking | R4 | shared/flow.ts:45 |
| killed | open | | - | R4 | shared/flow.ts:46 |
| killed | undo | | asking | R4 | shared/flow.ts:46 |

## Machine stack-job

initial: idle
final: 

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| idle | start | | running | R5 | shared/flow.ts:57 |
| running | start | | - | R5 | shared/flow.ts:58 |
| running | done | | idle | R5 | shared/flow.ts:58 |
| running | fail | | failed | R5 | shared/flow.ts:58 |
| failed | start | | running | R5 | shared/flow.ts:59 |
