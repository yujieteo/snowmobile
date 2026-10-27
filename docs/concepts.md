# The concepts of snowmobile

This file is the conceptual model of snowmobile. The interface comes from it. It names the objects that you change, their attributes and their actions. It does not name layout or widgets.

## Concepts

Each concept has one purpose, its own state and actions, and an operational principle (Daniel Jackson, *The Essence of Software*).

### Hunt

- **Purpose:** find the parts of real software that relate to a seed.
- **State:** the seed, a status (hunting, hunted, creating, created, failed), an error, the sources and their parts.
- **Actions:** start a hunt from a seed, hunt more parts.
- **Operational principle:** if you write a seed and start a hunt, then after some minutes the hunt shows real tools and paradigms, each broken into parts with a source link.

### Leave out

- **Purpose:** keep a weak part out of the next ideas.
- **State:** for each part, a bad reason or nothing.
- **Actions:** leave out a part, bring back a part. A kill in the grill also leaves out a part.
- **Operational principle:** if you leave out a part, then the next "create" does not use it. If you bring it back, the next "create" can use it again.

### Recombine

- **Purpose:** make new ideas from parts of distant sources.
- **State:** for each hunt, the ideas, each with its parts, problem, evidence, today's solution and gain.
- **Actions:** create ideas.
- **Operational principle:** if you create ideas from a hunt, then you get candidates that each use parts of 2 or more sources and name the problem that they solve.

### Graveyard

- **Purpose:** keep each idea that must not go forward, with the reason.
- **State:** for each idea, a status (survivor, graveyard, grilled, killed) and a reason.
- **Actions:** bury an idea, restore an idea. The prior-art check also buries an idea.
- **Operational principle:** if an idea already exists or has no clear gain, then it goes to the graveyard with the reason, and it is not grilled. If you bury an idea, it goes there too. If you restore it, you can grill it again.

### Grill

- **Purpose:** settle each design decision of an idea, one round at a time, until a build brief or a kill.
- **State:** a tree of decisions in rounds, each with options, a recommended option and an answer; a status (open, done, killed); a brief.
- **Actions:** pick an option, write a note, answer a round, undo the last round, retry a failed round.
- **Operational principle:** if you answer each round, then you get a build brief. If an answer kills the idea, then the bad part is left out and you go back to the hunt. If you undo the last round, then the tree is as it was before that answer.

### Brief

- **Purpose:** give a builder (a person or an agent) all the settled decisions of an idea.
- **State:** the text of the brief.
- **Actions:** read, copy.
- **Operational principle:** if you copy the brief, then you can paste all of it into a coding agent.

### Stack map

- **Purpose:** show where paradigms of 4 layers are similar and where they are far apart.
- **State:** the paradigms, the axes, a score for each paradigm on each axis, the map (principal components).
- **Actions:** propose axes and score, hunt more paradigms, edit an axis, edit a score, ask about a point.
- **Operational principle:** if you tap an empty point of the map, then Claude names the paradigm that would live there.

### Stack

- **Purpose:** choose 1 paradigm for each layer and see the mismatches between them.
- **State:** for each layer, a picked paradigm or nothing; the gaps on each axis.
- **Actions:** pick a paradigm, clear a layer, create apps.
- **Operational principle:** if you pick paradigms of 2 or more layers, then each axis shows the gap between them, and "create apps" uses the stack.

## ORCA objects

Sophia Prater's ORCA: objects, relationships, calls-to-action and attributes.

| Object | Relationships | Calls-to-action | Attributes |
| --- | --- | --- | --- |
| Seed (hunt) | has many sources, many ideas; can have a stack | start, hunt more, create ideas, open | seed text, status, error, date |
| Source | belongs to a hunt; has many parts | open the link | name, kind, link, summary |
| Part | belongs to a source; used by many ideas | open the link, leave out, bring back | name, mechanism, link, bad reason |
| Idea | belongs to a hunt; uses many parts; has 1 grill | grill, bury | name, pitch, problem, evidence, today, gain, status |
| Graveyard entry | an idea with status graveyard | restore, open the proof link | reason, proof link |
| Grill | belongs to 1 idea; has many rounds | answer the round, undo the last round, retry | status, round |
| Round | belongs to a grill; has many decisions | answer, undo | number |
| Decision | belongs to a round; depends on other decisions; has options | pick an option, write a note | question, options, recommended, answer |
| Brief | belongs to 1 grill | copy | text |
| Paradigm | belongs to a layer; has a score on each axis; is a point on the map | pick, open the link | layer, name, summary, link |
| Axis | has a score for each paradigm | edit | name, 0 means, 10 means |
| Score | joins a paradigm and an axis | edit | value 0 to 10, reason |
| Stack | has at most 1 paradigm for each layer; has gaps | pick, clear a layer, create apps | picks, gaps |
| Map point | a place on the map | ask, pick the answer | position, answer |

## Object-action matrix

Daniel Rosenberg's object-action matrix. A row is an object. A column is an action.

- ✓ means that the action is on its object.
- ✗ means that a user expects the action, but it does not exist. This is a fault.
- ↪ means that the action exists, but it is not on its object. This is a fault.
- An empty cell means that a user does not expect the action.

### Before

| Object | Create | Open | Find | Pick | Edit | Remove | Undo | Copy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Seed (hunt) | ✓ | ✓ | ✓ | | ✓ hunt more | | | |
| Part | | ✓ | ✓ | | | ✗ leave out | ✗ bring back | |
| Idea | ✓ | ✓ | ✓ | | | ✗ bury | | |
| Graveyard entry | | ✓ | ✓ | | | | ✗ restore | |
| Decision | | | | ✓ | ✓ note | | | |
| Round | | | | | ✓ answer | | ✗ undo | |
| Brief | | ✓ | ✓ | | | | | ✗ copy |
| Paradigm | ↪ hunt more | ✓ | | ✓ | | | | |
| Axis | ↪ propose | | | | ✓ | | | |
| Score | | | | | ✓ | | | |
| Stack | ↪ create apps | | | ✓ | | ✓ clear | ✓ pick again | |
| Map point | | | | ✗ pick answer | | | | |

**Faults before: 10.** 7 missing actions (✗) and 3 actions away from their object (↪):

1. Part: you cannot leave out a part yourself. Only a kill in the grill does it.
2. Part: you cannot bring back a part that a kill left out.
3. Idea: you cannot bury an idea.
4. Graveyard entry: you cannot restore an idea that the prior-art check buried by mistake.
5. Round: an answer is final. You cannot undo a round, a kill or a brief.
6. Brief: you cannot copy the brief.
7. Paradigm: "Hunt more paradigms" is at the top of the page, far from the paradigm list.
8. Axis: "Propose axes" is at the top of the page, far from the axis list.
9. Stack: "Create apps" is a separate form below the gaps, far from the stack.
10. Map point: when the answer is a paradigm on the map, you cannot pick it from the answer.

### After

| Object | Create | Open | Find | Pick | Edit | Remove | Undo | Copy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Seed (hunt) | ✓ | ✓ | ✓ | | ✓ hunt more | | | |
| Part | | ✓ | ✓ | | | ✓ leave out | ✓ bring back | |
| Idea | ✓ | ✓ | ✓ | | | ✓ bury (swipe left) | ✓ undo | |
| Graveyard entry | | ✓ | ✓ | | | | ✓ restore (swipe right) | |
| Decision | | | | ✓ | ✓ note | | | |
| Round | | | | | ✓ answer | | ✓ undo | |
| Brief | | ✓ | ✓ | | | | | ✓ copy |
| Paradigm | ✓ hunt more | ✓ | | ✓ | | | | |
| Axis | ✓ propose | | | | ✓ | | | |
| Score | | | | | ✓ | | | |
| Stack | ✓ create apps | | | ✓ | | ✓ clear | ✓ pick again | |
| Map point | | | | ✓ pick answer | | | | |

**Faults after: 0.**

## Rules for the interface

These rules map the model onto the screen.

- **Two layers.** Content is the lower layer. The control layer floats above it at the bottom: the navigation and the primary action of the screen. Each object has 1 elevation: a card 1, a sheet or a toast 6, the control layer 8 (Material Design 1).
- **Actions on the object.** You swipe an idea card left to bury it, and swipe a graveyard card right to restore it. A part has its own "leave out" button. Each action is reversible at once with "Undo", so no action asks for a confirmation.
- **Signifiers.** Each swipe also has a visible button, and the card shows a hint. A state shows a word or a mark as well as a colour.
- **Motion.** A swiped card follows the finger. You can catch it again before it settles. With `prefers-reduced-motion`, nothing animates.
- **Posture.** Snowmobile is a sovereign application. The content uses the full screen and the chrome stays small.
