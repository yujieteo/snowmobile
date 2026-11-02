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
- **State:** a tree of decisions in rounds, each with options, a recommended option and an answer; a status (open, done, killed); the state machine of the settled decisions and its check findings; a brief.
- **Actions:** pick an option, write a note, answer a round, undo the last round, retry a failed round.
- **Operational principle:** if you answer each round, then you get a build brief. If an answer kills the idea, then the bad part is left out and you go back to the hunt. If no decision is open, then the settled design gets its state machine before it gets a brief. Each fault that the check finds (a hidden state, a row with no requirement, a requirement with no row) comes back as a decision of one more round. If you undo the last round, then the tree is as it was before that answer.

### Brief

- **Purpose:** give a builder (a person or an agent) all the settled decisions of an idea.
- **State:** the text of the brief, with the state machine and the faults that its check found.
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

### Practical problem

- **Purpose:** start an app from a problem that a survey shows many developers have.
- **State:** the sourced problems, each with a respondent share; the links from paradigms to problems, each with an effect, a reason and a source; the coverage (problems without a documented reduction, paradigms without an assessment).
- **Actions:** pick a problem as the app seed, pick a linked paradigm for the stack.
- **Operational principle:** if you pick a problem, then it becomes the seed of "create apps", and the ideas name it with its respondent share.

### Library

- **Purpose:** find again a hunt, a part or an idea from an earlier session.
- **State:** a search text and its results: ideas, parts and hunts.
- **Actions:** search, open a result.
- **Operational principle:** if you search for a word, then each hunt, part and idea whose text has that word is listed, and a tap opens it.

## Synchronisations

An action of one concept that causes an action of another concept.

- A kill in the grill (Grill) leaves out the bad part (Leave out). An undo of the kill brings the part back, or puts back the earlier reason.
- The prior-art check (Recombine) buries an idea that exists, or that has no clear problem or gain (Graveyard).
- An answer to a round (Grill) starts the next round, and the last round writes the brief (Brief).
- A pick of a practical problem (Practical problem) writes the seed of "create apps" (Stack).
- "Create apps" (Stack) starts a hunt with the picked paradigms (Hunt, Recombine).

## ORCA objects

Sophia Prater's ORCA: objects, relationships, calls-to-action and attributes. The frequency is an estimate for 1 owner: high (many times in a session), medium (once or twice in a session) or low (a few times in a week or less). A high-frequency action gets no motion.

| Object | Relationships | Calls-to-action (frequency) | Attributes |
| --- | --- | --- | --- |
| Seed (hunt) | has many sources, many ideas; can have a stack | start (low), hunt more (low), create ideas (low), open (medium) | seed text, status, error, date |
| Source | belongs to a hunt; has many parts | open the link (medium) | name, kind, link, summary |
| Part | belongs to a source; used by many ideas | open the link (medium), leave out (medium), bring back (low) | name, mechanism, link, bad reason |
| Idea | belongs to a hunt; uses many parts; has 1 grill | grill (medium), bury (high) | name, pitch, problem, evidence, today, gain, status |
| Graveyard entry | an idea with status graveyard | restore (low), open the proof link (low) | reason, proof link |
| Grill | belongs to 1 idea; has many rounds; has at most 1 state machine | answer the round (high), undo the last round (low), retry (low) | status, round, machine, findings |
| Round | belongs to a grill; has many decisions | answer (high), undo (low) | number |
| Decision | belongs to a round; depends on other decisions; has options | pick an option (high), write a note (medium) | question, options, recommended, answer |
| Brief | belongs to 1 grill | copy (low) | text, machine, findings |
| Paradigm | belongs to a layer; has a score on each axis; is a point on the map | pick (high), open the link (medium) | layer, name, summary, link |
| Axis | has a score for each paradigm | edit (low) | name, 0 means, 10 means |
| Score | joins a paradigm and an axis | edit (low) | value 0 to 10, reason |
| Stack | has at most 1 paradigm for each layer; has gaps | pick (high), clear a layer (medium), create apps (low) | picks, gaps |
| Map point | a place on the map | ask (medium), pick the answer (low) | position, answer |
| Practical problem | has many paradigm links; seeds an app | pick as the seed (low), pick a linked paradigm (medium), open the source (low) | name, respondent share, effect, reason, source |
| Library | finds hunts, parts and ideas | search (medium), open a result (medium) | search text, results |

Navigation between the dock destinations and between the tabs of a hunt is high frequency, so a new view does not animate.

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
| Practical problem | | ✓ source | | ✓ pick as seed | | | | |
| Library | | ✓ | ✓ search | | | | | |

**Faults after: 0.** The audit below found more.

### After the UI audit of 2026-11-02

The audit compared this matrix with the screens. It found more expected cells, and the count is not 0.

| Object | Remove | Undo |
| --- | --- | --- |
| Seed (hunt) | ✗ | |
| Part | ✓ leave out | ✓ bring back, and its undo puts back the earlier reason |
| Paradigm | ✗ | |
| Axis | ✗ | ✓ undo an edit |
| Score | | ✓ undo an edit |

**Faults now: 3.** You cannot remove a hunt, a paradigm or an axis. We accept these 3 faults. Each is local data that does not stop a task, and a remove of a paradigm or an axis also removes its scores and changes the map.

"Remove" has 3 forms: "Leave out" on a part, "Bury" (a swipe and a button) on an idea, and "×" on a stack slot. Only an idea swipes, because only the idea lists are long lists of cards. An undo of a round is a button on the page, not a toast, because a round can stay open for a long time.

## Rules for the interface

These rules map the model onto the screen.

- **Two layers.** Content is the lower layer. The control layer floats above it at the bottom: the navigation and the primary action of the screen. Each object has 1 elevation: a card 1, a sheet or a toast 6, the control layer 8 (Material Design 1).
- **Actions on the object.** You swipe an idea card left to bury it, and swipe a graveyard card right to restore it. A part has its own "leave out" button. Each action is reversible at once with "Undo", so no action asks for a confirmation.
- **Signifiers.** Each swipe also has a visible button, and the card shows a hint. A state shows a word or a mark as well as a colour.
- **Colours.** The content uses more than 3 colours: ink, dim and accent, a good and a bad status colour, and 1 colour for each of the 4 layers. Each status colour and each layer colour has a word, a mark or a shape too, so no meaning depends on colour only.
- **Undo.** The undo toast stays while the pointer or the focus is on it, and while the page is hidden. It is first in the tab order, and Ctrl+Z or Cmd+Z also undoes.
- **Keyboard.** A redraw keeps the focus on the same control. A new view moves the focus to its heading and puts the heading in the page title.
- **Motion.** A swiped card follows the finger. You can catch it again before it settles. A new view does not animate. With `prefers-reduced-motion`, only the spinner pulses slowly.
- **No new screen for the machine.** A fault of the state machine is a decision in a round, with options and a recommended option. The machine and the faults that remain are in the brief.
- **Posture.** Snowmobile is a sovereign application. The content uses the full screen and the chrome stays small.
