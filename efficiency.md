# Fewer tokens per answer

An agent that answers a question about a website spends model work reading it. CAP moves the search to the site, where the record is. In the [CAP benchmark](benchmark/README.md), counting both the visiting agent and the site's agent, an answer took about 19,000 tokens through CAP, against 48,000 to fetch a realistic site and 112,000 to browse it.

This page covers what was counted, where CAP saves and where it does not, and what the numbers do not show.

## What was counted

Every run adds the visiting agent's tokens to the tokens the site's agent spent answering: input, output, and cached input. The numbers are the average per run in the main phase: 50 tasks, three runs each, Claude Opus 5.5 as the visitor and Claude Sonnet 5 behind the door.

| How the visitor got in | Tokens per run | Compared with CAP |
| --- | --- | --- |
| **Asked through CAP** | **18,600** | **1x** |
| Fetched a clean site | 24,200 | 1.3x |
| Fetched a realistic site | 48,000 | 2.6x |
| Browsed a realistic site | 112,100 | 6.0x |

All four got about the same share of answers right. The [benchmark](benchmark/README.md#results) has the success rates and their intervals.

## Where it saves, and where it does not

| Task | CAP | Clean fetch | Realistic fetch | Browser |
| --- | --- | --- | --- | --- |
| Fact on one page | 14,100 | 12,700 | 12,400 | 56,800 |
| Multi-constraint | 23,000 | 29,100 | 65,400 | 138,200 |
| Page versus record | 12,800 | 22,900 | 35,600 | 75,600 |
| Local and delivery | 12,900 | 26,300 | 49,700 | 111,600 |
| Catalog query | 30,400 | 30,000 | 76,900 | 178,400 |

On a fact that sits on one page, fetching that page used fewer tokens than asking. On a catalog query, a clean site tied with CAP. The savings come from two places: sites built the way most sites are, with rendered prices and client-side filters, and questions that need a search across many pages.

## Smaller visitors

The weaker-visitor arm reran ten tasks with Claude Haiku 4.5 as the visitor. Through CAP, Haiku answered all 30 runs at 12,700 tokens a run. Browsing, it also answered all 30, at 270,800 tokens a run. Fetching the realistic site, it answered 27 at 58,600.

A small visitor that asks can do the work of a large one that reads. The site's agent was Claude Sonnet 5 in every CAP run, so this does not show what a smaller model behind the door would do.

## What this does not show

- **Tokens are not energy.** Energy per token depends on the model, the hardware, batching, caching, and the data center. The benchmark did not measure kilowatt-hours or emissions. Cached input counts the same as new input here, though it takes less work to process.
- **Per answer, not in total.** CAP makes each answer take less work. It does not change how many questions agents ask, and cheaper answers could mean more of them.
- **A chat page is new model use.** A door answers agents that were going to read the site anyway. A chat page answers people, some of whom would have read a page with no model involved.
- **One store, one model family.** The benchmark ran on one synthetic store with Claude models. Its [limitations](benchmark/README.md#limitations) apply here.

## A door with a small footprint

- **Publish a door without a chat page.** Leave the `Chat` line out of `agent.txt`. Agents can ask, and people browse the site as before.
- **Use the smallest model that answers well.** The door hides which model answers, so you can change it without telling callers.
- **Answer from the record.** Search over a catalog reads a few records instead of many pages.
- **Set a daily limit.** It caps what a busy day can spend.
- **Skip the door when pages are enough.** When every answer is already on a few accurate pages, reading them is cheaper. See [When to publish an agent](publish.md#when-to-publish-an-agent).
