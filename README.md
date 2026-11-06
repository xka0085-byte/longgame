# longgame — public data series

Independently collected time series of public records that cannot be reconstructed after the fact. Each series records one quantity, its source, the date it describes and the counting method used.

This repository is both the machine-readable store and the publisher for **https://xka0085-byte.github.io/longgame/**.

## What is in here

| Path | Contents |
|---|---|
| `data/lines/*.json` | one file per series: `collect.runs` (one record per collection run) and `collect.events` (append-only change log) |
| `data/collect-runs.json` | outcome of the last round: attempted / failed / stale / verdict |
| `data/heartbeat.json` | automation liveness |
| `assurance/` | gate results, contract definitions, fixtures, exported verification artifacts |
| `docs/` | published pages: dashboard, method, verify, health, ops, monthly reports |
| `portfolio.json` | series registry: cadence, drivers, radar keywords, known-tolerated sources |
| `SERIES.md` | registry rules and known boundaries (Chinese) |

## How to read a number

Every run record carries the fields needed to decide whether it can be compared at all:

- `scanDate` — the date the upstream record describes
- `generatedAt` — when the sweep actually ran
- `comparedAgainst`, `comparedAgainstComplete`, `comparedAgainstCoverage` — what it was compared with, and how complete that comparison was
- `baseline` — whether this run may serve as an anchor for later changes
- `feedVersion` — which counting definition produced the record

If `scanDate` equals `comparedAgainst`, the run is a same-day re-run: any difference it sees is re-scan noise, not change over time. The published method page states which runs qualify as anchors, and the definition-change log on that page records every time a counting rule was altered.

## Getting the data

No API key, no registration, no request quota.

```bash
curl -s https://raw.githubusercontent.com/xka0085-byte/longgame/master/data/lines/trust-delta.json
```

Machine-readable entry points: `docs/feed.xml`, `docs/status.json`, `docs/attestations.json`, and `llms.txt` for readers that prefer one flat document.

A read-only snapshot mirror of the same files is served from Hugging Face datasets: https://huggingface.co/datasets/Eidonze/longgame-public-data-series (same `data/lines/*.json`, plus a derived run index at `data/hf/runs_index.csv`). The mirror is a snapshot, not a continuous sync; this repository is the upstream of record when the two disagree.

## Verifying it yourself

```bash
git clone https://github.com/xka0085-byte/longgame && cd longgame
npm i
node scripts/verify-data.mjs      # recomputes published numbers from the raw data
node scripts/assurance-gate.mjs   # verify + contracts + fixtures + fault injection
```

The gate refuses to publish when any of those fails, and its result is stamped with the commit and an input hash, so a published page can be traced to the data it came from. Exported artifacts under `assurance/` carry the `sha256` of every data file they cover.

## Citing

Archive DOI for this snapshot: **[10.5281/zenodo.23998349](https://doi.org/10.5281/zenodo.23998349)** — the archive holds the same content as commit `4cec9a7`, as a single tarball.

`CITATION.cff` for the citation entry, `.zenodo.json` for archive metadata. If you need a link that cannot change, use the DOI; if you need the upstream of record, use the GitHub URL.

## License

Text, data and pages are released under CC BY 4.0 — see `LICENSE`. Attribution is the only requirement.

## Boundaries

- Evidence level is **E0** on every series: publicly recheckable, not yet recomputed by a third party.
- No outreach, no paid data, no manual backfilling. Gaps are published as gaps; a failing source is recorded as failing rather than replaced with a stale value.
- A series is retired when its driver stops moving; the retirement rules are in `SERIES.md`.
- This repository does not claim its data is important, novel or useful. Whether any of it is worth anything is for readers, citers and recomputers to decide. What this repository can do is keep it dated, checkable and citable so that judgement is possible at all.
