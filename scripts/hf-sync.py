#!/usr/bin/env python3
"""Mirror this repository to the Hugging Face dataset repo.

Run daily by .github/workflows/hf-sync.yml. Two jobs, in order:

1. rebuild data/hf/runs_index.csv from data/lines/*.json. Counts are literal
   array-element counts and boolean fields copied from the upstream JSON
   (pages_total = len(pages), pages_changed = pages with changed=true,
   pages_unavailable = pages with unavailable=true). Nothing is re-derived and
   no value is invented: a run without a `pages` array leaves those three
   columns empty, exactly like the runs collected before page capture existed.
2. upload the repository tree to the dataset repo, then rewrite the dataset
   card so it states when the mirror was actually last synced. The card is only
   rewritten when the upload produced a new commit (or FORCE_CARD=1), so an
   unchanged repo does not churn a commit every day.

Environment:
    HF_TOKEN        required, write token for the dataset repo
    HF_DATASET_REPO optional, defaults to Eidonze/longgame-public-data-series
    UPSTREAM_SHA    optional, recorded on the card
    FORCE_CARD      optional, "1" rewrites the card even without new data
"""

import csv
import datetime
import json
import os
import sys
from pathlib import Path

REPO_ID = os.environ.get("HF_DATASET_REPO", "Eidonze/longgame-public-data-series")
TOKEN = os.environ.get("HF_TOKEN", "")
SHA = (os.environ.get("UPSTREAM_SHA", "") or "unknown")[:7]
FORCE_CARD = os.environ.get("FORCE_CARD") == "1"
ROOT = Path(__file__).resolve().parent.parent

COLUMNS = ["line_id", "run_date", "ok", "pages_total", "pages_changed", "pages_unavailable"]

CARD_TEMPLATE = """---
license: cc-by-4.0
language:
- en
pretty_name: longgame public data series
size_categories:
- n<1K
tags:
- time-series
- open-data
- public-records
- regulatory-monitoring
- ai-governance
- public-datasets
configs:
- config_name: runs_index
  data_files:
  - split: train
    path: data/hf/runs_index.csv
---

> **Mirror.** This is a read-only snapshot mirror of https://github.com/xka0085-byte/longgame (upstream is authoritative).
> **Synced automatically.** Last sync {now} from upstream commit `{sha}`. Refreshed daily by `hf-sync` in the upstream repository; if this line is stale by more than a couple of days, the sync job is broken, not the data.
> **Archive DOI (frozen):** [10.5281/zenodo.23998349](https://doi.org/10.5281/zenodo.23998349) — the 2026-11-05 snapshot (upstream commit `4cec9a7`) as a single tarball on Zenodo. The DOI does not move; this mirror does.
> `data/hf/runs_index.csv` is a derived index only — one row per collection run, with counts that are literal array-element counts from the upstream JSON (no reinterpretation). The authoritative records stay in `data/lines/*.json`.

{upstream}
"""


def _bool_cell(run):
    if "ok" not in run:
        return ""
    return "true" if run.get("ok") else "false"


def rebuild_runs_index():
    """Rewrite data/hf/runs_index.csv from the upstream line records."""
    rows = []
    for path in sorted((ROOT / "data" / "lines").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        runs = ((data.get("collect") or {}).get("runs")) or []
        for run in runs:
            pages = run.get("pages")
            rows.append(
                [
                    path.stem,
                    (run.get("date") or "")[:10],
                    _bool_cell(run),
                    "" if pages is None else len(pages),
                    "" if pages is None else sum(1 for p in pages if p.get("changed")),
                    "" if pages is None else sum(1 for p in pages if p.get("unavailable")),
                ]
            )

    out = ROOT / "data" / "hf" / "runs_index.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".csv.tmp")
    with tmp.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    tmp.replace(out)
    return len(rows)


def main():
    if not TOKEN:
        sys.exit("HF_TOKEN is not set; refusing to run")

    rows = rebuild_runs_index()
    print(f"runs_index.csv rebuilt: {rows} rows")

    from huggingface_hub import HfApi

    api = HfApi(token=TOKEN)
    api.create_repo(REPO_ID, repo_type="dataset", exist_ok=True, private=False)

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    commit = api.upload_folder(
        repo_id=REPO_ID,
        repo_type="dataset",
        folder_path=str(ROOT),
        ignore_patterns=[
            ".git/**",
            "**/.git/**",
            "node_modules/**",
            "**/node_modules/**",
            "**/__pycache__/**",
            "README.md",
        ],
        commit_message=f"sync upstream {SHA}",
    )

    if commit is None and not FORCE_CARD:
        print("mirror already up to date; dataset card left untouched")
        return

    readme = (ROOT / "README.md").read_text(encoding="utf-8").strip()
    card = CARD_TEMPLATE.format(now=now, sha=SHA, upstream=readme)
    api.upload_file(
        path_or_fileobj=card.encode("utf-8"),
        path_in_repo="README.md",
        repo_id=REPO_ID,
        repo_type="dataset",
        commit_message=f"dataset card: mirror synced {now}",
    )
    print(f"dataset card refreshed ({now}, upstream {SHA})")


if __name__ == "__main__":
    main()
