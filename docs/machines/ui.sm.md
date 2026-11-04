# snowmobile page: swipe, toast, point sheet and once

Source: shared/ui.ts. The page refuses a bad event without a message: send() returns false.

## Requirements

- R1: A card moves only after a horizontal drag of more than 8 px. A vertical move scrolls the page. -- test/page.test.ts
- R2: A toast stays while the pointer or the focus is on it or the page is in the background. -- test/page.test.ts "the toast timer stops on hover"
- R3: A tap on the map shows one answer at a time. -- client/page.ts askAt
- R4: A button that starts a request runs it once. -- test/page.test.ts "a double tap on Hunt makes 1 hunt"

## Machine swipe

initial: idle
final:

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| idle | down | | pending | R1 | shared/ui.ts:10 |
| idle | release_near | | - | R1 | shared/ui.ts:10 |
| pending | move_x | | dragging | R1 | shared/ui.ts:11 |
| pending | move_y | | scrolling | R1 | shared/ui.ts:11 |
| pending | release_near | | idle | R1 | shared/ui.ts:11 |
| pending | down | | - | R1 | shared/ui.ts:11 |
| scrolling | release_near | | idle | R1 | shared/ui.ts:12 |
| scrolling | move_y | | - | R1 | shared/ui.ts:12 |
| scrolling | move_x | | - | R1 | shared/ui.ts:12 |
| scrolling | down | | - | R1 | shared/ui.ts:12 |
| dragging | move_x | | dragging | R1 | shared/ui.ts:13 |
| dragging | release_far | | leaving | R1 | shared/ui.ts:13 |
| dragging | release_near | | idle | R1 | shared/ui.ts:13 |
| dragging | down | | - | R1 | shared/ui.ts:13 |
| leaving | down | | pending | R1 | shared/ui.ts:14 |
| leaving | done | | idle | R1 | shared/ui.ts:14 |

## Machine toast

initial: hidden
final:

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| hidden | show | | shown | R2 | shared/ui.ts:25 |
| hidden | hold | | - | R2 | shared/ui.ts:25 |
| hidden | free | | - | R2 | shared/ui.ts:25 |
| hidden | expire | | - | R2 | shared/ui.ts:25 |
| hidden | dismiss | | - | R2 | shared/ui.ts:25 |
| shown | show | | shown | R2 | shared/ui.ts:26 |
| shown | hold | | held | R2 | shared/ui.ts:26 |
| shown | free | | - | R2 | shared/ui.ts:26 |
| shown | expire | | hidden | R2 | shared/ui.ts:26 |
| shown | dismiss | | hidden | R2 | shared/ui.ts:26 |
| held | show | | shown | R2 | shared/ui.ts:27 |
| held | hold | | - | R2 | shared/ui.ts:27 |
| held | free | | shown | R2 | shared/ui.ts:27 |
| held | expire | | - | R2 | shared/ui.ts:27 |
| held | dismiss | | hidden | R2 | shared/ui.ts:27 |

## Machine point-sheet

initial: closed
final:

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| closed | tap | | asking | R3 | shared/ui.ts:38 |
| closed | close | | - | R3 | shared/ui.ts:38 |
| asking | tap | | asking | R3 | shared/ui.ts:39 |
| asking | answer | | answered | R3 | shared/ui.ts:39 |
| asking | error | | failed | R3 | shared/ui.ts:39 |
| asking | close | | closed | R3 | shared/ui.ts:39 |
| answered | tap | | asking | R3 | shared/ui.ts:40 |
| answered | close | | closed | R3 | shared/ui.ts:40 |
| failed | tap | | asking | R3 | shared/ui.ts:41 |
| failed | close | | closed | R3 | shared/ui.ts:41 |

## Machine once

initial: idle
final:

| state | event | guard | next | req | source |
|---|---|---|---|---|---|
| idle | run | | running | R4 | shared/ui.ts:52 |
| running | run | | - | R4 | shared/ui.ts:53 |
| running | settle | | idle | R4 | shared/ui.ts:53 |
