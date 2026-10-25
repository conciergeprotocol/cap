# Same answers, a fifth of the cost

<p class="bench-dateline">CAP benchmark · October 22, 2026 · Frozen at commit <code>53019ef</code></p>

An AI agent visiting a website can read it, or it can ask. This benchmark measures both on the same store, with the same questions, scoring answers against the same record. A capable agent got the same answers either way. Asking through CAP cost about a fifth of fetching the site and about a seventh of browsing it, in about a third of the steps.

<div class="bench-stats" data-stats></div>

The gap is small when the answer already sits on one clean page. It is large when the visitor has to search: filter a catalog, check sizes and stock, compare prices. That is where most shopping questions live.

<figure class="bench-chart" data-chart="category"></figure>

## Results

The main run is 50 tasks in five categories, four ways of visiting, three runs each: 600 runs. The visitor is Claude Opus 5.5. Cost counts both sides at list prices: the visitor's tokens, and the tokens the site's concierge spends answering. A CAP message and a page fetch each count as one step.

| How the visitor got in | Successes | Cost per success | Steps | Seconds | Tokens |
| --- | --- | --- | --- | --- | --- |
| **Asked through CAP** | **145/150** | **$0.037** | **3.4** | **15.8** | **19,000** |
| Fetched a clean site | 144/150 | $0.080 | 8.3 | 15.8 | 24,000 |
| Fetched a realistic site | 148/150 | $0.169 | 11.1 | 21.1 | 48,000 |
| Browsed a realistic site | 147/150 | $0.248 | 13.1 | 24.6 | 112,000 |

Success rates overlap. Bootstrapped over the 50 tasks, CAP is 0.93 to 0.99, the clean fetch 0.91 to 0.99, the realistic fetch 0.97 to 1, and the browser 0.95 to 1. CAP did not win on accuracy, and the benchmark does not claim it did. It won on what each right answer cost.

<figure class="bench-chart" data-chart="overall"></figure>

The clean site is a best case that few real sites match: plain HTML, every fact in the markup. The realistic site is the same store built the way stores usually are, with client-side filters, rendered prices, and chrome around the content. Reading the realistic site cost twice as much as reading the clean one. Asking does not depend on how the pages are built, because the visitor never loads them.

## Search is where reading gets expensive

Two categories make the visitor search. Multi-constraint tasks ask for the one product that meets several conditions. Catalog queries ask for every product that does, with prices and links. On both, CAP cost about a seventh of the browser: $0.049 against $0.335 per answer on multi-constraint, and $0.069 against $0.484 on catalog queries.

A reader has to open listing pages, apply filters the page renders in script, then open each candidate to check its size and stock. A concierge runs that query against its own catalog and returns the matches. The visitor sends one or two messages.

## Cost stays flat as the catalog grows

The catalog-size arm reruns three tasks on stores of 402, 5,000, and 50,000 styles, with heavier, paginated pages. Every run in every cell succeeded. Reading cost stayed high at every size. CAP rose from about 3 cents to about 5 cents between 402 and 5,000 styles, then held.

<figure class="bench-chart" data-chart="scale"></figure>

## Smaller visitors do well through CAP

The weaker-visitor arm reruns the ten pilot tasks with Claude Sonnet 5 and Claude Haiku 4.5 as the visitor. Haiku through CAP answered all 30 for under 2 cents each. Haiku in the browser also answered all 30, at 11 times the cost and with 19 steps a run. Reading the realistic site by fetch, Haiku answered 27.

<figure class="bench-chart" data-chart="models"></figure>

A smaller model asking a good concierge did as well as a larger one, for less. The work of searching the catalog moved to the site, where the catalog is.

## Where reading ties

On a single fact that sits on one clean page, such as what a shoe's upper is made of, reading is nearly as cheap as asking: $0.031 by fetch against $0.021 through CAP. A short page is a fine interface for a short question. CAP's advantage comes from the questions a page cannot answer in one read.

## Where CAP missed

CAP's weak spot was local stock: 26 of 30 on local and delivery tasks, against 30 of 30 for the realistic fetch. Three of the four misses were the same mistake. Asked to find a store with an item in stock when no store had it, the concierge named one anyway. The fourth gave the wrong stock answer for a named store.

That is a concierge problem, not a protocol problem. The reference concierge let the model answer a negative from a partial lookup. A concierge built on CAP has to say "not available" when its tools find nothing. Across the main run CAP made 2 false claims, the clean fetch 3, and the realistic fetch and the browser 1 each.

## What it means for a site

A site owner wants two things from a visiting agent: the right answer, and a link the person can act on. The scorer checks both. An answer counts only when its fields match the record, and each link is checked against the product and variant it names.

On that measure, asking matched reading. What changed was the work before the answer. Through CAP the visitor took 3.4 steps and 15.8 seconds. Reading the realistic site took 11.1 steps and 21.1 seconds by fetch, and 13.1 steps and 24.6 seconds in a browser. Every step is a page the visitor has to load and parse before the person sees an answer and a link.

The site pays for its share. The concierge's model calls are part of the CAP cost above, and an owner bounds them with its own limits. A concierge that answers a negative from a partial lookup, as this one did on local stock, sends the person to the wrong store. The answer is only as good as the record and the tools behind the door.

## One task, read and asked

One catalog query from the main run, first repetition, both visitors answering correctly with the same five shoes. Press play to replay the tool calls in order.

<figure class="bench-replay" data-replay></figure>

## How it was run

- **The store.** A synthetic outdoor retailer, Fieldhouse, with 402 styles, variants by color and size, store-level stock, and a policy page. A generated record is the ground truth for every answer.
- **The tasks.** 50 tasks, ten in each of five categories: a fact on one page, multi-constraint, page versus record, local and delivery, and catalog query. Some tasks have no answer, and the right response is to say so.
- **The visitors.** Fetching uses `mcp-server-fetch`, clamped at 5,000 characters a call. Browsing uses Playwright MCP with accessibility snapshots and no screenshot or code tools. Asking uses `@conciergeprotocol/mcp` against the reference concierge, whose answers come from Claude Sonnet 5 with catalog tools.
- **The limits.** A run fails at 180 seconds or $2 of visitor spend.
- **The freeze.** The harness, tasks, scorer, store, and concierge were hashed and committed before the run, at commit `53019ef`, freeze digest `8cd72ebfd12b`. The run stops if any frozen file changes. The hypotheses were written down at the same commit.

### Hypotheses, scored

| Stated before the run | Result |
| --- | --- |
| On one fact, the success rate is the same | Held |
| On one fact, CAP is slower | Did not hold. Same wall time as the clean fetch, fewer steps |
| On multi-constraint tasks, CAP succeeds more often | Did not hold. All four were 30 of 30 |
| Readers give the page instead of the record | Did not show up as wrong answers |
| On categories 2 to 5, CAP costs less per success than the browser | Held, about 7 to 1 on search |
| CAP cost stays low as the catalog grows | Held |
| Reading cost rises as the catalog grows | Held only mildly |
| Weaker visitors give the page more often when they read | Did not hold |
| On catalog queries, CAP succeeds more often than the realistic fetch | Did not hold. Both 29 of 30 |
| On catalog queries, CAP costs less than the browser | Held |

## Limitations

- **One store.** Fieldhouse is synthetic. Real stores are larger, messier, and slower, which likely widens the cost gap, but this benchmark does not show that.
- **One reference concierge.** CAP results measure this concierge as much as the protocol. A weaker concierge would do worse. A concierge without catalog search could cost more than reading.
- **Small samples.** Ten tasks a category and three runs each give wide intervals. Only a large gap would show, and the accuracy gaps here are not large.
- **One model family.** Every visitor and the concierge are Claude models. Other models may read and ask differently.
- **List prices.** Costs use list token prices, with prompt caching where the API applied it.

## Reproduce it

The harness, store, tasks, scorer, and concierge are public at the frozen commit, and the [raw results](https://github.com/conciergeprotocol/bench/tree/main/results/raw) of all 861 runs are published with the [report](https://github.com/conciergeprotocol/bench/tree/main/report). Check it out, set `ANTHROPIC_API_KEY`, and run the plan:

```bash
git clone https://github.com/conciergeprotocol/bench
cd bench
git checkout 53019ef
bun install
bun run fixture
bun run main
```

The full run is 861 runs and cost $112.59 at list prices. `bun run run -- --task FP-01 --condition cap_ref` runs one task. The numbers on this page come from [`results.json`](results.json), which `report/build.mjs` writes from the raw results.
