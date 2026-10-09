import pandas as pd
import numpy as np
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DATA_PATH = ROOT / "data" / "raw"
RAW_CSV_PATH = RAW_DATA_PATH / "AirQualityUCI.csv"
RAW_XLSX_PATH = RAW_DATA_PATH / "AirQualityUCI.xlsx"
PROCESSED_DATA_PATH = ROOT / "data" / "processed"

MISSING_VALUE_CODE = -200
LIST_OF_COLUMNS = ["CO(GT)", "PT08.S1(CO)", "NMHC(GT)", "C6H6(GT)", "PT08.S2(NMHC)", "NOx(GT)", "PT08.S3(NOx)", "NO2(GT)", "PT08.S4(NO2)", "PT08.S5(O3)", "T", "RH", "AH"]
SENSOR_COLUMNS = ["PT08.S1(CO)", "PT08.S2(NMHC)", "PT08.S3(NOx)", "PT08.S4(NO2)", "PT08.S5(O3)"]
RENAME = {"CO(GT)": "co_gt", "PT08.S1(CO)": "s1_co", "NMHC(GT)": "nmhc_gt", "C6H6(GT)": "c6h6_gt",
          "PT08.S2(NMHC)": "s2_nmhc", "NOx(GT)": "nox_gt", "PT08.S3(NOx)": "s3_nox",
          "NO2(GT)": "no2_gt", "PT08.S4(NO2)": "s4_no2", "PT08.S5(O3)": "s5_o3",
          "T": "t", "RH": "rh", "AH": "ah"}

UNITS = {"co_gt": "mg/m3", "s1_co": "raw", "nmhc_gt": "ug/m3", "c6h6_gt": "ug/m3",
         "s2_nmhc": "raw", "nox_gt": "ppb", "s3_nox": "raw", "no2_gt": "ug/m3",
         "s4_no2": "raw", "s5_o3": "raw", "t": "degC", "rh": "%",
         "ah": "kPa (approx., derived from T and RH)"}

def check_timestamps(df):
    idx = df.index
    assert idx.is_unique, "duplicate timestamps"
    assert idx.is_monotonic_increasing, "timestamps out of order"
    full = pd.date_range(idx.min(), idx.max(), freq="h")
    assert len(full.difference(idx)) == 0, "missing hourly slots"


def load_dataset(file_path):

    df = pd.read_csv(file_path, sep=';', decimal=',')
    df.dropna(how='all', inplace=True)
    df["timestamp"] = (
        pd.to_datetime(df["Date"], format="%d/%m/%Y", dayfirst=True, errors="coerce")
        + pd.to_timedelta(df["Time"].astype(str).str.replace(".", ":"), errors="coerce")
    )
    df = df.set_index("timestamp")[LIST_OF_COLUMNS].astype(float)
    df = df.round(4)
    check_timestamps(df)
    return df


def clean_dataset(raw):
    df = raw.rename(columns=RENAME)
    return df.mask(df == MISSING_VALUE_CODE)

# def validate(clean, raw):
#     vals = clean[list(RENAME.values())]
#     assert len(clean) == len(raw), "rows were lost"
#     assert not (vals == MISSING_VALUE_CODE).any(axis=None), "-200 still present"
#     # every NaN corresponds to exactly one -200 in the raw data, so nothing was filled
#     MISSING_VALUE_CODE_counts = (raw == MISSING_VALUE_CODE).sum().rename(RENAME)
#     assert (vals.isna().sum() == MISSING_VALUE_CODE_counts).all(), "NaN count != MISSING_VALUE_CODE count"
#     # every non-missing value is unchanged
#     kept = raw.mask(raw == MISSING_VALUE_CODE).rename(columns=RENAME)
#     assert ((vals - kept).abs().max() < 1e-3).all(), "values were altered"


def save(clean):
    PROCESSED_DATA_PATH.mkdir(parents=True, exist_ok=True)
    clean.to_csv(PROCESSED_DATA_PATH / "air_quality_clean.csv",
                 index_label="timestamp", date_format="%Y-%m-%d %H:%M:%S")
    meta = {
        "rows": len(clean),
        "units": UNITS,
        "original_names": {v: k for k, v in RENAME.items()},
        "missing_counts": {k: int(v) for k, v in clean[list(RENAME.values())].isna().sum().items()},
        "flag_counts": {c: int(clean[c].sum()) for c in clean.columns if c.startswith("flag_")},
    }
    (PROCESSED_DATA_PATH / "air_quality_clean_meta.json").write_text(json.dumps(meta, indent=2))
    return meta

if __name__ == "__main__":
    raw = load_dataset(RAW_CSV_PATH)
    df = clean_dataset(raw)
    # validate(df, raw)
    # print("Validation passed")
    meta = save(df)
    print(f"Wrote {len(df):,} rows to {PROCESSED_DATA_PATH}")
