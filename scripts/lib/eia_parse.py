#!/usr/bin/env python3
"""Parse an EIA-860M generator xlsx and print a compact JSON summary.
Usage: python eia_parse.py <file.xlsx>
Only reads the workbook, no network, no writes.
"""
import sys, json
import openpyxl

path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
out = {"sheets": {}, "plannedMW": 0.0, "canceledMW": 0.0, "plannedByYear": {}, "retiredMW": 0.0}

for name in wb.sheetnames:
    ws = wb[name]
    out["sheets"][name] = max(ws.max_row - 3, 0)

def col_index(ws):
    hdr = [c.value for c in next(ws.iter_rows(min_row=3, max_row=3))]
    return {h: i for i, h in enumerate(hdr) if h}

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

if "Planned" in wb.sheetnames:
    ws = wb["Planned"]
    idx = col_index(ws)
    ci = idx.get("Nameplate Capacity (MW)")
    yi = idx.get("Planned Operation Year")
    for row in ws.iter_rows(min_row=4, values_only=True):
        mw = num(row[ci]) if ci is not None else 0.0
        out["plannedMW"] += mw
        y = row[yi] if yi is not None else None
        if y not in (None, ""):
            key = str(int(y)) if isinstance(y, (int, float)) else str(y)
            out["plannedByYear"][key] = out["plannedByYear"].get(key, 0) + 1

if "Canceled or Postponed" in wb.sheetnames:
    ws = wb["Canceled or Postponed"]
    idx = col_index(ws)
    ci = idx.get("Nameplate Capacity (MW)")
    for row in ws.iter_rows(min_row=4, values_only=True):
        out["canceledMW"] += num(row[ci]) if ci is not None else 0.0

if "Retired" in wb.sheetnames:
    ws = wb["Retired"]
    idx = col_index(ws)
    ci = idx.get("Nameplate Capacity (MW)")
    for row in ws.iter_rows(min_row=4, values_only=True):
        out["retiredMW"] += num(row[ci]) if ci is not None else 0.0

out["plannedMW"] = round(out["plannedMW"], 1)
out["canceledMW"] = round(out["canceledMW"], 1)
out["retiredMW"] = round(out["retiredMW"], 1)
print(json.dumps(out))
