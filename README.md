# snowmobile

Snowmobile hunts real software tools and programming paradigms for their parts, and recombines distant parts into new developer tools, or into consumer apps in Stack mode. It kills each idea that already exists, then grills you on a survivor as a visual design tree: one tap per decision, until you have a build brief.

![A grill tree: settled decisions on top, the open round below with the recommended cards already selected](docs/screens/grill-1280.jpg)

```
seed ──► hunt parts ──► recombine ──► prior-art check ──► grill tree ──► build brief
         (web search)                  (dead ones go to                (a decision that kills the
                                        the graveyard)                  idea marks the bad part)
```

## Start

You need Node.js 22.13 or later and [Claude Code](https://claude.com/claude-code), signed in. Snowmobile runs your local `claude` CLI, so it uses your own login and needs no API key.

```sh
npx github:yujieteo/snowmobile
```

Open the URL that it prints. The URL holds a token. Without the token, the server refuses each request.

Snowmobile is a server because a browser cannot run Claude Code, and because you can then use it from your phone.

## Use it from your phone

The server listens only on `127.0.0.1:4747`. From a device with SSH access to the machine that runs snowmobile, forward the port:

```sh
ssh -L 4747:127.0.0.1:4747 your-machine
```

Then open the printed URL, with its token, in the browser on that device.

## Your data

Everything stays in one SQLite file on your machine: `~/.snowmobile/snowmobile.db`. It holds the parts and their source links, the paradigms, axes and scores of the stack map, the ideas, the graveyard and each grill tree. The library page searches the hunts, the parts and the ideas. Set `SNOWMOBILE_HOME` to keep the file somewhere else, and `PORT` to change the port.

## How it works

- **Hunt.** From your seed (a pain, a domain, a tool or a paradigm), Claude searches the web for 6 real tools and paradigms. It breaks each one into its principal components: the mechanisms that make it work, each with a link to its source. "Hunt more parts" adds more.
- **Create.** Claude combines parts from distant sources into candidates. Each candidate must name the problem and who has it, a link that shows the problem is real, the solution that people use today, and the gain over it on one axis, with a claim that a test can prove false. Claude then searches for prior art. A candidate that exists, that has no real source for its problem, or that has no clear gain goes to the graveyard with the reason. The idea card shows these 4 lines first.
- **Grill.** Each round shows every open decision whose prerequisites are settled, with the recommended card already selected. One tap answers the round. Tap another card or type a note to override. While you read a round, snowmobile already computes the next round for the recommended answers, so the next round usually appears at once. The first round always tests why the idea is better than the solution that people use today. A decision that kills the idea sends you back to the hunt with the bad part marked, and the next creation leaves that part out. The build brief starts with the problem, the evidence, today's solution and the gain.
- **Change your mind.** Swipe an idea left to bury it, or swipe a graveyard entry right to restore it. Each card also has a button for this. Leave out a part, or bring it back, on the parts tab. Undo the last round of a grill, also a kill or a finished brief. Each change shows "Undo" at once, so snowmobile never asks you to confirm.

## Stack mode

Stack mode makes consumer apps and developer tools from a stack of 4 paradigms. The layers are programming language, hardware, operating system and software. Tap **Stack** at the bottom of the screen.

![The stack map: paradigms of 4 layers on the first two principal components, with a stack of 4 picked paradigms](docs/screens/stack-1280.jpg)

- **Paradigms.** The seed list covers all 4 layers, with a definition and source link for each entry. Sources include taxonomies, papers, project documentation and architecture styles. "Hunt more paradigms" finds more on the web, each with a source link. Each start adds absent seeds to an existing database and keeps user edits.
  The hunt receives the practical problems, survey scope and current source assessments.
  It asks for practical benefit before map distance and candidate order by respondent share when evidence and benefit are comparable.
  Each summary must name the problem, source links, benefits, harms and limits, or state that the effect is unknown.
  This prompt does not prove actual candidate quality or store structured problem links for new paradigms.
  Reason: a hunt trial showed no practical problems or source assessments in the prompt.
- **Axes.** Claude proposes 8 to 12 design axes once, for example where state lives or when binding happens. Each axis runs through all 4 layers. Then Claude scores each paradigm on each axis from 0 to 10, with a one-line reason. You can edit each axis and each score. A new score never replaces your edit.
- **Map.** Principal component analysis puts all paradigms on a 2D map, with a colour and a shape for each layer. Tap a mark to pick it for its layer. Tap an empty area, and Claude tells you which paradigm would live at that point.
  The map-point prompt receives the sourced practical problems and current assessments.
  Among comparable fits, it gives practical benefit priority over map distance and uses respondent share when evidence and benefit are comparable.
  Each answer must name a practical problem and source links for benefits, harms and limits, or state that the effect is unknown.
  A real paradigm needs a source URL that Claude opened. Without a verified match, the answer must say "No verified match".
  Prompt tests verify evidence delivery. They do not prove actual answer quality or source accuracy.
  Reason: a map-point trial supplied zero practical problems and requested an invented paradigm when no real paradigm fit.
- **Practical problems.** The map page lists leading frustrations from the [2024 Stack Overflow survey](https://survey.stackoverflow.co/2024/professional-developers/#2-most-common-frustrations). Each problem shows its respondent share. Tap a problem to use it as the app seed. These shares describe the survey sample. Source links explain which mechanisms can reduce a problem or make it worse. Tap a linked paradigm to pick it for your stack. The page counts links and names problems without a documented reduction. These assessments describe specific mechanisms, not effects on survey shares. A paradigm without a link has no assessment. This does not prove that it has no benefit. A change to a paradigm name, layer or source removes its seed assessment.
  Reason: an API trial found no paradigm-problem links or measure of problems without a documented reduction.
  The debt assessment uses [Fowler's separation of configuration from use](https://martinfowler.com/articles/injection.html#SeparatingConfigurationFromUse).
  It infers a reduction in dependency-related debt, with no claim about all debt.
  The reliability assessment uses [Erlang/OTP supervisors](https://www.erlang.org/doc/system/sup_princ.html), which restart failed processes and limit repeated restarts.
  Actors alone provide no supervisor. A documented reduction does not prove that a problem has a complete solution.
  Reason: the Stack API reported no reduction for technical debt or unreliable systems.
  The [Rust ownership assessment](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) links Ownership types to fewer memory faults.
  Rust checks reject use after a move and prevent double-free faults in the documented model.
  This assessment does not prove whole-system reliability.
  Reason: an Ownership types trial found no reliability assessment.
  The [CQRS assessment](https://martinfowler.com/bliki/CQRS.html) identifies a cost when separate models do not fit the domain.
  Fowler reports extra complexity, lower productivity and greater risk in that case.
  The assessment infers a technical debt cost. It does not apply to every CQRS use.
  Reason: a CQRS trial found no assessment of its cost for technical debt.
  The [SQLite assessment](https://www.sqlite.org/serverless.html) links Embedded database to less database server setup and less isolation from client memory faults.
  These assessments describe specific mechanisms. They do not prove a whole-application benefit or cost.
  Reason: an Embedded database trial found no assessment of deployment cost or fault isolation.
  The [MINIX 3 assessment](https://wiki.minix3.org/doku.php?id=www:documentation:reliability) links Microkernel to driver fault isolation through separate processes and memory access limits.
  This can contain driver memory faults. It does not prove whole-system reliability or apply to every microkernel.
  Reason: a Microkernel trial found no reliability assessment and four problem gaps.
  The [Fowler assessment](https://martinfowler.com/eaaDev/EventSourcing.html) links Event sourcing to state recovery and faults from repeat external updates.
  A retained event log can support recovery. Gateways must suppress repeat external updates during replay.
  These assessments do not prove whole-system reliability.
  Reason: an Event sourcing trial found no assessment and four problem gaps.
  The [Ink & Switch assessment](https://www.inkandswitch.com/essay/local-first/) links Local-first software to offline access and resource costs from retained CRDT history.
  Offline access does not protect against device loss. Resource costs depend on the implementation and workload.
  Reason: a Local-first software trial found no assessment and four problem gaps.
  The [AWS Lambda assessments](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html) link Serverless to less server setup and maintenance.
  [Concurrency limits](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html) can cause request failures across functions in one account.
  Application configuration costs remain. The reliability cost depends on demand, quotas and concurrency controls.
  Reason: a Serverless trial found no assessment and four problem gaps.
  The [Microsoft assessment](https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters) links Pipes and filters to less duplicate code and faults from repeat state updates.
  Shared filters require compatible data schemas. Retry controls affect the risk from repeat updates.
  Reason: a Pipes and filters trial found no assessment and four problem gaps.
  The [Microsoft assessment](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven) links Event-driven architecture to fewer component dependencies and data loss after a crash.
  Event contracts still need maintenance. Durable event storage and receipt controls affect the data-loss risk.
  These assessments do not prove whole-system outcomes.
  Reason: an Event-driven architecture trial found no assessment and four problem gaps.
  The [IPFS assessment](https://docs.ipfs.tech/concepts/persistence/) links Peer-to-peer to access through remote copies and data loss from temporary caches.
  The benefit requires retained copies on reachable peers. Temporary caches do not guarantee data retention.
  These assessments do not prove whole-system reliability or apply to every peer-to-peer system.
  Reason: a Peer-to-peer trial found no assessment and four problem gaps.
  The [CRDT assessment](https://crdt.tech/) links automatic conflict resolution to less custom merge code and offline updates to network outage tolerance.
  These benefits require suitable data types. Convergence does not prove application correctness or protect against device loss.
  Reason: a CRDT trial found no assessment and four problem gaps.
  The [Clojure assessment](https://clojure.org/about/state#_functional_programming) links Functional programming to local behavior that simplifies maintenance and removes mutable state from pure code.
  Effects and shared state still need controls. These benefits do not prove whole-system reliability or address all technical debt.
  Reason: a Functional programming trial found no assessment and four problem gaps.
  The [Microsoft assessment](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices#benefits) links Microservices to fewer code dependencies and fault isolation.
  Suitable service boundaries and fault controls in dependent services are necessary for these benefits.
  Cross-service changes still add maintenance costs. The deployment cost assessment still applies.
  Reason: a Microservices trial found only deployment harm and four problem gaps.
  Your stack also shows problems without a documented reduction among its selected paradigms.
  This measure uses only selected paradigms. Empty layers remain open for Claude to choose.
  The whole database measure stays separate. No assessment means an unknown effect.
  Reason: a Microservices trial showed no uncovered problems because the page measured only the whole database.
- **Gaps.** With 2 or more picked paradigms, the page shows the gap between them on each axis. A gap of 5 or more is a mismatch: a chance for a new idea.
- **Create.** Write a practical problem, pick a stack, or do both. If you do not pick a paradigm for a layer, Claude chooses one. Claude then proposes consumer apps or developer tools that the stack makes possible, cheap or fast.
  The prompt gives practical developer problems priority over novelty.
  The prompt includes source assessments only for available paradigms, with their mechanisms and limits.
  Each candidate must explain any documented harm to a named problem and compare that cost with its benefit.
  Reason: the brainstorm prompt omitted all five source assessments, which include a harmful effect.
  Each candidate names the sourced problems that it claims to reduce, or has no problem link.
  Ideas appear in order of their greatest linked respondent share. Shares do not measure severity and never add together.
  The page shows the fraction of all candidates with a problem link, also those in the graveyard.
  Links are model claims. The problem evidence and gain still need review.
  Old ideas retain their data and have no inferred problem links.
  Reason: the Stack trial had no problem links, priority or coverage measure for generated ideas.
  The same checks as above send weak apps to the graveyard. The grill and the build brief are the same as in the other mode, and the brief also names the layer mismatch that the app uses.

## Repository subset

Select distant repositories and inspect their joint PCA map with the scored paradigms:

```sh
node scripts/select-repos.js data/repo-scores.json 4
```

Reason: the source-backed corpus supplies distinct repository examples for the paradigm search.
The corpus records manual scores, axis definitions, profile scopes, source links, score reasons, and fixed README revisions.
Scores describe the stated scope. They do not measure performance or code quality.
Some reasons mark uncertain evidence. Review those scores before a conclusion.
These study axes do not replace your Stack axes or change your database.

The script tries each initial pair, then adds the repository farthest from its nearest selected repository.
It retains the subset with the greatest minimum pair distance across equally weighted axes.
Reason: a corpus trial found a better subset than the farthest initial pair alone.
The method is greedy and does not guarantee the best subset. Ties retain the earlier result.
Two repositories or the full input count need only one trial. Other counts use one trial per initial pair.

The JSON output contains the selected `repos`, their `minimumDistance`, a joint `map`, and repository search regions in `gaps`.
PCA subtracts axis means without variance normalization and uses every input profile, regardless of the selected subset count.
Reason: all points need the same coordinate frame for a valid comparison.
`map.records` preserves each input record at the same index as its point. `map.explained` reports the retained variance shares.
Each gap retains repository evidence and the nearest scored paradigm on the map and across all axes.
An exact full-axis match supplies no gap. PCA can hide separation, so map coincidence does not remove a gap.
Reason: a synthetic trial lost four distinct regions under the former map-distance filter.
Search regions suggest source research. Unscored seeds can already describe them, so check seeds and sources before a new entry.
The corpus retains verified discoveries as scored profiles, with `suggestedBy` links where repositories supplied the candidates.

`map.coverage` estimates the largest empty-circle radius on a 41 by 41 grid within the rectangle around all input points.
It measures distance to scored paradigms. The true maximum lies between `radius` and `radius + errorBound`.
An optional `coverageBaseline` compares a named subset of paradigms within the same PCA frame, rectangle, and grid.
Reason: separate PCA runs can change the frame and prevent a valid coverage comparison.
Use the output for current measurements. Empty space does not prove that a real paradigm exists there.

For your own score file, supply at least two distinct `axes` names and two `repos` with distinct GitHub repository URLs.
Each repository needs `url` and `scores`, with one value from 0 to 10 per axis in the same order.
For joint PCA, add a nonempty `paradigms` array. Each paradigm needs `name`, `layer`, and `scores` on those same axes.
Use `language`, `hardware`, `os`, or `software` for `layer`. Keep definitions, source links, scopes, and score reasons in the records.
The script preserves extra record fields. Set `coverageBaseline` to distinct paradigm names from the same file.
Reason: mismatched axes or duplicate profiles can distort distances and coverage.
The script reads only the score file. It does not fetch repositories, assign scores, verify sources, or open a Snowmobile database.

## Interface

The interface comes from a conceptual model: the objects, their relationships, their actions and their attributes. [docs/concepts.md](docs/concepts.md) has the model and the object-action matrix. The content fills the screen. The navigation and the primary action of each screen float above it at the bottom, within reach of your thumb. [docs/screens](docs/screens) has a screenshot of each screen at 375, 430 and 1280 px.

## Credits

- The name and the method come from John Boyd's essay [*Destruction and Creation*](https://www.coljohnboyd.com/static/documents/1976-09-03__Boyd_John_R__Destruction_and_Creation.pdf) (1976). Boyd takes skis, an outboard motor, tank treads and bicycle handlebars out of their unrelated wholes and recombines them into a snowmobile.
- The grill comes from Matt Pocock's [grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) prompt, in which an LLM interviews you about a plan, one branch of the design tree at a time, with a recommended answer for each question.

## Development

```sh
npm test
```

The tests run the server against a fake `claude`. Snowmobile has no dependencies.

MIT licence.
