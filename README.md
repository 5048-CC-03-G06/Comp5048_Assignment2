# COMP5048 Assignment 2 — Air Quality Sensor Data Visual Analytics

Group: 5048-CC-03-G06

An interactive visual analytics tool for discovering pollution-profile groupings,
their temporal evolution, and critical moments in the
[UCI Air Quality dataset](https://archive.ics.uci.edu/dataset/360/air+quality).

## Repository structure

```
data/
  raw/                  Original UCI files (AirQualityUCI.csv / .xlsx), never modified
  processed/            Cleaned data produced by preprocessing scripts
preprocessing/          Cleaning and derivation scripts
  clean.py              Cleans the raw data into data/processed/ (no imputation)
code/                   Interactive visual analytics tool
modelling/              Regression models for what-if analysis (Task 3)
evaluation/
  protocol/             Evaluation tasks, questionnaire, instructions
  responses/            Anonymised participant responses
  analysis/             Evaluation analysis and resulting design changes
  before-after/         Screenshots of views before and after redesign
figures/                Annotated figures for the report
  data/                 Data-quality / preprocessing figures
  task1-grouping/
  task2-temporal/
  task3-critical-moment/
  task4-evaluation/
report/
  group/                Group report (max 8 pages)
  individual/member-*/  Individual reports (max 4 pages each)
requirements.txt        Python dependencies
```

## Team and responsibilities

| Member | Owns |
|---|---|
| Kavvin Udhayakumar Valarmathi | Preprocessing |
| name_ | --- |
| name_ | --- |
| name_ | --- |

## Getting started

```bash
pip install -r requirements.txt
python preprocessing/clean.py
```

The raw files in `data/raw/` are extracted unchanged from the official UCI archive
(`https://archive.ics.uci.edu/static/public/360/air+quality.zip`).

| File | SHA-256 |
|---|---|
| AirQualityUCI.csv | `13277ae5d8581e80b7be09d47c7d3d06fe9b8e957078f2cf6e859f955e62f996` |
| AirQualityUCI.xlsx | `c92d102bb35cd4c0b42c0b6a1336c4065ccdca7069f80a6890ee1b7e3124bd5d` |

## Dataset overview

- 9,357 hourly records, 10 Mar 2004 18:00 to 4 Apr 2005 14:00, continuous with no duplicate timestamps.
- 13 value columns: 5 reference-analyser concentrations (`*(GT)`), 5 metal-oxide sensor responses
  (`PT08.S1`–`S5`), and `T`, `RH`, `AH`.

| Column | Description | Unit |
|---|---|---|
| CO(GT) | CO concentration (reference analyser) | mg/m³ |
| PT08.S1(CO) | Tin-oxide sensor response, nominally CO | raw |
| NMHC(GT) | Non-methane hydrocarbons (reference analyser) | µg/m³ |
| C6H6(GT) | Benzene concentration (reference analyser) | µg/m³ |
| PT08.S2(NMHC) | Titania sensor response, nominally NMHC | raw |
| NOx(GT) | NOx concentration (reference analyser) | ppb |
| PT08.S3(NOx) | Tungsten-oxide sensor response, nominally NOx | raw |
| NO2(GT) | NO2 concentration (reference analyser) | µg/m³ |
| PT08.S4(NO2) | Tungsten-oxide sensor response, nominally NO2 | raw |
| PT08.S5(O3) | Indium-oxide sensor response, nominally O3 | raw |
| T | Temperature | °C |
| RH | Relative humidity | % |
| AH | Humidity measure derived from T and RH (see findings) | ≈ kPa |

## Data quality findings

Findings from a data-quality audit of the raw files.

| # | Finding | Detail | Handling |
|---|---|---|---|
| 1 | File format | CSV: `;` separator, decimal comma, CRLF, 2 empty trailing columns, 114 blank trailing rows | Drop blank rows/columns on load |
| 2 | CSV vs XLSX | Same records and same missing positions. XLSX keeps full precision (sensor values with fractional parts); CSV rounds sensors to integers and T/RH/C6H6 to 0.1 | Load XLSX; round its float32 artefacts |
| 3 | Missing-value code | `-200` is the only code; no blank cells or other sentinels | `-200` → NaN, **no imputation** |
| 4 | Missingness per column | CO(GT) 18.0 %, NOx(GT) 17.5 %, NO2(GT) 17.5 %, NMHC(GT) 90.2 %, all other columns 3.9 % | Report per view how many records are hidden |
| 5 | Device outages | The 8 device columns (`PT08.*`, T, RH, AH) are always missing together, and C6H6(GT) is missing in exactly the same hours (366 h); 31 hours have no data at all; longest outage 76 h (Feb 2005) | Show as gaps; never interpolate |
| 6 | Daily analyser gaps | NOx/NO2 missing at 03:00 on 93 % of days; CO missing at 04:00 on 54 % of days | Take care with 03:00/04:00 in hourly views |
| 7 | Long analyser gaps | CO/NOx/NO2 missing for up to 173 consecutive hours (from 13 Oct 2004); monthly missingness up to 48 % (NOx/NO2, Oct 2004) | Visible gaps in time-based views |
| 8 | NMHC(GT) | Valid only from 10 Mar to 1 May 2004 (914 values) | Exclude from the attribute set |
| 9 | C6H6(GT) | Near-exact monotone function of PT08.S2(NMHC) (Spearman 0.99998; equal S2 values give C6H6 within 0.1) and shares its missingness | Kept as a reference-analyser column for now (pending tutor confirmation); avoid relying on C6H6 and S2 as two independent signals |
| 10 | AH | Matches water-vapour pressure in kPa computed from T and RH (ratio 0.98–1.02), not g/m³ | Derived from T and RH; recompute it when T or RH change in what-if scenarios |
| 11 | NOx vs NO2 | Different units (ppb vs µg/m³); after conversion NO2 ≤ NOx holds in all but 5 of 7,715 rows | Never compare on a shared axis without conversion |
| 12 | Sensor drift / cross-sensitivity | PT08.S3 response at fixed NOx ranges 620–923 by month; PT08.S4(NO2) correlates more with T/AH (0.56/0.63) than with NO2(GT) (0.16) | Seasonal changes in `PT08.*` values are partly instrumental; note as a limitation |
| 13 | Extremes | 141 hours with extreme CO/C6H6/NOx (robust z > 5), almost all Oct–Feb at 09–11 h and 17–20 h. Max CO 11.9 mg/m³, NOx 1,479 ppb | Plausible pollution episodes: keep and flag |
| 14 | Ranges and stuck values | RH 9.2–88.7 %; T −1.9 to 44.6 °C; no zero or negative concentrations; longest run of identical values ≤ 5 h | No range or stuck-sensor errors |
| 15 | Duplicates | No duplicate timestamps or records; 33 rows share values only because they are empty or near-empty | Nothing dropped |
| 16 | Time base | 24 rows on every DST-change day; local/solar time not documented | Don't shift timestamps; note as a limitation |

## Cleaning plan (to implement in `preprocessing/`)

1. Load XLSX (cross-checked against CSV), drop empty rows/columns, build a single hourly `timestamp`.
2. Replace `-200` with NaN. **No imputation, interpolation or fill of any kind.** Keep all rows;
   each view excludes missing values itself and shows how many records it hides.
3. Keep extreme values; add flag columns instead of deleting.
4. Derive time fields from the timestamp only (hour, weekday/weekend, month, season).
5. Store units per attribute (see the table above).
6. Freeze the attribute set (≥ 8 including the timestamp), justified by the findings above,
   and use the same set in every task.

## Dataset citation

De Vito, S. (2008). Air Quality [Dataset]. UCI Machine Learning Repository.
https://doi.org/10.24432/C59K5F

De Vito, S., Massera, E., Piga, M., Martinotto, L., & Di Francia, G. (2008). On field calibration of an
electronic nose for benzene estimation in an urban pollution monitoring scenario.
*Sensors and Actuators B: Chemical*, 129(2).

Licence: CC BY 4.0. The UCI page also restricts use to research purposes.
