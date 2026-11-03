# Facts (each on-screen string, with its source)

- "Seed": README "From your seed (a pain, a domain, a tool or a paradigm)".
- "Hunt parts", "web search": README "Claude searches the web for 6 real tools and paradigms"; src/prompts.ts hunt prompt.
- "Recombine": README ASCII diagram "recombine"; README "Claude combines parts from distant sources into candidates".
- "Prior-art check": README "Claude then searches for prior art".
- "Graveyard", "dead": README "goes to the graveyard with the reason"; src/recombine.ts status 'graveyard'.
- "Grill tree", "one tap per round": README "One tap answers the round"; shared/flow.ts grill machine.
- "kill", "bad part marked": README "A decision that kills the idea sends you back to the hunt with the bad part marked"; src/grill.ts kill(), src/prompts.ts "These components killed earlier ideas".
- "State machine", "sm-axi check": README "runs `sm-axi check`"; src/grill.ts buildMachine.
- "fault", "new decision": README "Each fault that the check finds ... comes back as a decision in one more round".
- "Build brief": README "until you have a build brief"; src/brief.ts renderBrief.
- "survivor": src/recombine.ts status 'survivor'.
- "settled": README "When no decision is open".

On-screen strings, quoted: "Seed", "Hunt parts", "web search", "Recombine", "Prior-art check", "Graveyard", "Grill tree", "one tap per round", "State machine", "optional sm-axi check", "Build brief", "survivor", "settled", "kill · bad part marked", "fault →", "new decision", "fault →new decision", "restore".
- "optional": README "Without it, the step is off and the brief has no machine".
- "restore": README "swipe a graveyard entry right to restore it"; shared/flow.ts idea machine graveyard + restore -> survivor.
