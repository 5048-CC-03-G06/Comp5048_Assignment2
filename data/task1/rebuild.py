"""Create Tableau-ready, no-imputation extracts for Task 1."""

from __future__ import annotations

import csv
import math
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data" / "processed" / "air_quality_clean.csv"
OUT = Path(__file__).resolve().parent

FIELDS = [
    ("co_gt", "CO (GT)"),
    ("c6h6_gt", "C6H6 (GT)"),
    ("nox_gt", "NOx (GT)"),
    ("no2_gt", "NO2 (GT)"),
    ("s1_co", "PT08.S1 (CO)"),
    ("s5_o3", "PT08.S5 (O3)"),
    ("t", "Temperature"),
    ("rh", "Relative Humidity"),
]


def season(month: int) -> str:
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Spring"
    if month in (6, 7, 8):
        return "Summer"
    return "Autumn"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    records: list[dict[str, object]] = []
    with SOURCE.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            values = {}
            try:
                for key, _ in FIELDS:
                    value = float(row[key])
                    if not math.isfinite(value):
                        raise ValueError
                    values[key] = value
                timestamp = datetime.fromisoformat(row["timestamp"])
            except (ValueError, TypeError):
                continue
            records.append(
                {
                    "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                    "date": timestamp.date().isoformat(),
                    "month": timestamp.month,
                    "month_name": timestamp.strftime("%B"),
                    "season": season(timestamp.month),
                    "hour": timestamp.hour,
                    **values,
                }
            )

    ranges = {
        key: (min(float(r[key]) for r in records), max(float(r[key]) for r in records))
        for key, _ in FIELDS
    }

    core_columns = ["timestamp", "date", "month", "month_name", "season", "hour"] + [key for key, _ in FIELDS]
    with (OUT / "core_hourly.csv").open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=core_columns)
        writer.writeheader()
        writer.writerows(records)

    by_day: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in records:
        by_day[str(record["date"])].append(record)

    heatmap_columns = ["date", "month", "month_name", "season", "coverage_hours", "attribute", "attribute_order", "median", "scaled_median"]
    with (OUT / "daily_heatmap.csv").open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=heatmap_columns)
        writer.writeheader()
        for date, daily_records in sorted(by_day.items()):
            if len(daily_records) < 18:
                continue
            for order, (key, label) in enumerate(FIELDS, start=1):
                median = statistics.median(float(record[key]) for record in daily_records)
                lower, upper = ranges[key]
                scaled = (median - lower) / (upper - lower) if upper > lower else 0.0
                writer.writerow(
                    {
                        "date": date,
                        "month": daily_records[0]["month"],
                        "month_name": daily_records[0]["month_name"],
                        "season": daily_records[0]["season"],
                        "coverage_hours": len(daily_records),
                        "attribute": label,
                        "attribute_order": order,
                        "median": f"{median:.8g}",
                        "scaled_median": f"{scaled:.8g}",
                    }
                )

    parallel_columns = ["timestamp", "date", "month", "month_name", "season", "hour", "attribute", "attribute_order", "scaled_value"]
    with (OUT / "parallel_coordinates.csv").open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=parallel_columns)
        writer.writeheader()
        for record in records:
            for order, (key, label) in enumerate(FIELDS, start=1):
                lower, upper = ranges[key]
                scaled = (float(record[key]) - lower) / (upper - lower) if upper > lower else 0.0
                writer.writerow(
                    {
                        "timestamp": record["timestamp"],
                        "date": record["date"],
                        "month": record["month"],
                        "month_name": record["month_name"],
                        "season": record["season"],
                        "hour": record["hour"],
                        "attribute": label,
                        "attribute_order": order,
                        "scaled_value": f"{scaled:.8g}",
                    }
                )

    print(f"Wrote {len(records):,} complete hourly records and {sum(len(v) >= 18 for v in by_day.values()):,} heatmap days.")


if __name__ == "__main__":
    main()
