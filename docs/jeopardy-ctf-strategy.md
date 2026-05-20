# Jeopardy CTF Strategy

This document describes the operating strategy for the ICC-style jeopardy CTF phase model used by Coach Command Center. It is written for coaches and future AI agents that need to make priority, staffing, and challenge-triage decisions from live dashboard data.

## Core Objective

Maximize Team USA score by using scarce human effort before the end of Human Resistance to lock the highest-value challenge solves.

The strategic edge is not just solving many challenges. It is solving the right challenges before Robot Uprising starts:

- Human Resistance solves can lock at high value when the phase ends.
- Scores for challenges solved during Human Resistance are not locked until Human Resistance ends.
- If other teams solve the same challenge before the phase ends, the value can still decay before our locked value is finalized.
- During Robot Uprising, AI-assisted solving becomes available, so manual effort should shift toward cleanup items that are easier or already heavily solved.

## Phase Model

The event is jeopardy-only with an optional locked-phase configuration.

For ICC 2026:

- Human Resistance: first 7 hours.
- Robot Uprising: final 2 hours.
- Human Resistance solve values lock only at the Human Resistance to Robot Uprising boundary.
- Robot Uprising allows broader AI-assisted work.

The dashboard should treat `platformPoints`, `platformSolveCount`, platform solves, and official solver data from the ICC API as authoritative observed data. Coach-entered confidence, assignments, notes, and manual solved states are planning data.

## Decay Model

Use the current ICC point value as the true current value. Use the table below for forecasts when modeling what happens if Team USA solves and if other teams solve before the lock.

| Total solves | Points |
| ---: | ---: |
| 1 | 500 |
| 2 | 339 |
| 3 | 230 |
| 4 | 156 |
| 5 | 106 |
| 6 | 72 |
| 7+ | 50 |

Important interpretation:

- The public solve count is the current total solve count on the platform.
- If Team USA has not solved a challenge, a Team USA solve increments the total solve count.
- Example: if a challenge currently has 2 public solves and Team USA solves next, forecast the USA solve value as the 3-solve value, 230 points, unless the authoritative current ICC value is already lower.
- Forecasts must never be presented as true platform data.

## Data Labels

Future agents should preserve this distinction:

- `ICC TRUE`: authoritative current value from the platform.
- `USA NEXT`: forecast value if Team USA is the next solve.
- `LOCK FCST`: forecast value at the Human Resistance boundary after Team USA solves and projected extra HR solves occur.
- `AI FCST`: forecast value if the challenge is delayed for Robot Uprising cleanup.
- `GAIN`: forecast advantage of solving before lock compared with waiting for AI cleanup.

When explaining recommendations, explicitly say whether a number is observed platform data or a forecast.

## Human Resistance Priority

During Human Resistance, prioritize high-value challenges that have low public solve counts.

Primary targets:

- 0 public solves: highest upside, possible 500-point lock, but may require confidence before committing.
- 1 public solve: still strong; Team USA next solve likely forecasts at 339.
- 2 public solves: still viable; Team USA next solve likely forecasts at 230.

Discussion targets:

- 3 public solves: captain discussion required. These can still be worth finishing if near-solved, but they should compete poorly against 0-2 solve targets unless conversion cost is low.

Park-for-AI targets:

- 4 or more public solves: normally deprioritize for Robot Uprising cleanup. Manual HR time is usually better spent on lower-solve challenges where the lock gain is larger.

Near-solved override:

- If captains report a challenge is near-solved, it may stay active even with 3+ solves.
- The override should be cost-sensitive: finish only if remaining effort is small and likely to convert before the phase boundary.

## Robot Uprising Priority

During Robot Uprising, shift toward AI cleanup.

Sort cleanup candidates by:

1. Easiest difficulty first.
2. Most public solves first.
3. Near-solved or high-progress work before cold starts.

Reasoning:

- Many-solved challenges are less attractive for Human Resistance because the lock gain is small.
- Once AI is available, those same challenges become good cleanup targets because public solves imply feasibility and the lost value from waiting is less strategically painful.
- Low-solve high-value challenges may still matter after Robot Uprising starts, but the main lost opportunity was failing to lock them before the boundary.

## Forecasting Rules

Use a simple forecast unless better live intelligence exists:

- 0 public solves: project 0 extra HR solves if the boundary is close, otherwise 1.
- 1-2 public solves: project 1 extra HR solve before lock.
- 3 public solves: project 1-2 extra HR solves before lock, depending on remaining HR time.
- 4+ public solves: do not spend much modeling HR lock gain unless near-solved; park for AI by default.

When Team USA solves, include Team USA's solve in the decay forecast. Do not rank a challenge as if Team USA can receive the current point value without adding a solve.

## Priority Decision Flow

For an unsolved challenge during Human Resistance:

1. Read authoritative ICC current points and public solve count.
2. Forecast `USA NEXT` by adding Team USA as the next solve.
3. Forecast likely additional HR solves before the phase boundary.
4. Estimate `LOCK FCST`.
5. Estimate `AI FCST` if the work is delayed.
6. Compute strategic value as lock value plus the gain over waiting.
7. Apply captain intelligence: near-solved, stuck, operator fit, fatigue, progress, and time spent.
8. Assign a lane:
   - `LOCK 500S`: low-solve, highest-value targets.
   - `MANUAL HR TARGETS`: good HR targets below the top tier.
   - `CAPTAIN CHECK`: missing confidence or 3-solve tradeoff decisions.
   - `RESOURCE SHIFT`: needs operator, specialist, tooling, or rotation.
   - `FINISH IF NEAR`: near-solved work that can convert quickly.
   - `PARK FOR AI`: 4+ solves or low HR value unless near-solved.

For an unsolved challenge during Robot Uprising:

1. Prefer `AI CLEANUP`.
2. Sort by easiest difficulty, then most solved, then progress.
3. Keep captain-near-solved items active if they can convert quickly.
4. Avoid consuming senior human attention on low-value cleanup unless the solve is blocked on a small expert action.

## Operator Allocation

Human Resistance operator time is the scarce resource. Allocate it to maximize locked score, not activity volume.

Use operators for:

- Low-solve high-value challenges with plausible paths.
- Near-solved challenges that can convert before boundary.
- Category-specialist work where an expert materially changes odds.
- Short unblock actions that let a team finish a challenge quickly.

Avoid operators on:

- 4+ solve challenges during Human Resistance unless near-solved.
- Long speculative work with low captain confidence.
- Challenges with high sunk time and no recent progress.
- AI-friendly cleanup before Robot Uprising, unless there is a strong lock-value reason.

## Captain Meeting Questions

Ask captains for decision-driving information, not generic status.

Useful questions:

- Can this solve before Human Resistance ends?
- Is this low, medium, high, or near-solved confidence?
- What is the smallest resource change that would improve odds?
- Is the remaining work mostly execution, research, debugging, or guessing?
- Should we park this for AI because public solves make the lock gain too small?
- For a 3-solve challenge: is it close enough to justify HR time?
- For a 4+ solve challenge: is the remaining finish cost tiny enough to override park-for-AI?

## Recommendation Philosophy

Prefer explicit tradeoffs over vague priority labels.

A good recommendation says:

- What is true now.
- What is forecast if Team USA solves next.
- What is forecast if other teams also solve before lock.
- Why this should be HR manual effort, captain discussion, or AI cleanup.
- What action the coach should take next.

Example:

> TRUE: 500 current, 0 public solves. FORECAST: USA next 500, HR lock 339 if one more team solves before boundary. Prioritize manual HR work because waiting for AI likely gives 106 or less.

Example:

> TRUE: 156 current, 4 public solves. FORECAST: USA next 106. Park for AI unless captain says it is near-solved; manual HR time is better spent on 0-2 solve challenges.

## Anti-Patterns

Do not:

- Treat current ICC points as the guaranteed Team USA solve value.
- Ignore that Team USA's own solve causes decay.
- Treat solved-during-HR points as locked before Human Resistance ends.
- Spend prime Human Resistance effort on many-solved challenges unless near-solved.
- Hide whether a value is true data or a forecast.
- Optimize for number of solves instead of locked score.
- Let stale assignments override official solver data from the API.

## Agent Implementation Notes

When building or modifying decision logic:

- Preserve authoritative platform fields separately from forecasts.
- Use official ICC solve and solver data when available.
- Allow coach-entered manual state to support planning, but do not let it overwrite official API truth.
- Rank Human Resistance targets by expected lock value and lock gain.
- Rank Robot Uprising cleanup by ease, public solves, and progress.
- Surface 3-solve challenges as discussion points.
- Surface 4+ solve challenges as park-for-AI during Human Resistance.
- Keep labels short enough for dashboard cards but reasons explicit enough for post-event analysis.
