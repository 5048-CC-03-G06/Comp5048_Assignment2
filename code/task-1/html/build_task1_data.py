"""Build browser-ready Task 1 data from the group's cleaned CSV.

This script does not alter the cleaned source. It keeps only the agreed Task 1
attributes and exports the complete-case cohort used consistently by all views.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOURCE = PROJECT_ROOT / "data" / "processed" / "air_quality_clean.csv"
OUTPUT = Path(__file__).with_name("data.js")

FIELDS = [
    ("co_gt", "CO(GT)", "mg/m³"),
    ("c6h6_gt", "C6H6(GT)", "µg/m³"),
    ("nox_gt", "NOx(GT)", "ppb"),
    ("no2_gt", "NO2(GT)", "µg/m³"),
    ("s1_co", "PT08.S1(CO)", "raw response"),
    ("s5_o3", "PT08.S5(O3)", "raw response"),
    ("t", "Temperature", "°C"),
    ("rh", "Relative Humidity", "%"),
]

SEASON_BY_MONTH = {
    12: "Winter", 1: "Winter", 2: "Winter",
    3: "Spring", 4: "Spring", 5: "Spring",
    6: "Summer", 7: "Summer", 8: "Summer",
    9: "Autumn", 10: "Autumn", 11: "Autumn",
}


def main() -> None:
    source = pd.read_csv(SOURCE, parse_dates=["timestamp"])
    field_names = [name for name, _, _ in FIELDS]
    missing = [name for name in ["timestamp", *field_names] if name not in source.columns]
    if missing:
        raise ValueError(f"Missing expected columns: {missing}")

    core = source.dropna(subset=field_names).copy()
    core["date"] = core["timestamp"].dt.strftime("%Y-%m-%d")
    core["hour"] = core["timestamp"].dt.hour
    core["month"] = core["timestamp"].dt.month
    core["season"] = core["month"].map(SEASON_BY_MONTH)

    records = []
    for row in core.itertuples(index=False):
        values = [round(float(getattr(row, name)), 4) for name in field_names]
        records.append([
            int(pd.Timestamp(row.timestamp).timestamp() * 1000),
            row.date,
            int(row.hour),
            int(row.month),
            row.season,
            *values,
        ])

    payload = {
        "fields": [
            {"key": key, "label": label, "unit": unit}
            for key, label, unit in FIELDS
        ],
        "sourceRows": int(len(source)),
        "coreRows": int(len(core)),
        "range": {
            "start": core["date"].min(),
            "end": core["date"].max(),
        },
        "ranges": {
            name: [round(float(core[name].min()), 4), round(float(core[name].max()), 4)]
            for name in field_names
        },
        "records": records,
    }
    OUTPUT.write_text(
        "window.TASK1_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(core):,} core records to {OUTPUT}")


if __name__ == "__main__":
    main()
