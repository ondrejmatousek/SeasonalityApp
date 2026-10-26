# Isolated historical strategy study

No live model, Work schedule, SQL write or public dataset publication. The output is a private local report. Do not add an automatic live winner or alter the prospective research v1 methodology/implementation pin.

Frozen before numerical experiments: `plan-v1.json`, SHA-256 `08782141d5c89e5583aaecc89a960fc8522e0602f5112d4de9898b01cb6cd33b` (26 October 2026). Fixed 480 comparisons; discovery 2023–2024, shortlist-eight validation Jan–Jun 2025, single frozen candidate and matching-universe controls Jul 2025–26 October 2026. Some old baseline aggregate results from the final period were already observed: do not call this a completely untouched historical holdout.

Inputs are private artifacts: staged validated H4 history index and per-symbol files (39 pairs, 230,411 bars), plus read-only exported same-provider SQL D1 closes for point-in-time seasonal calculations. `run.cjs` verifies every source SHA and pins input/implementation provenance. It refuses to overwrite a different frozen provenance, shortlist or candidate. Use a new version/plan/output directory for a new experiment; never quietly replace these results with a newer dataset or retune the final period.

The fast engine replays FM formations, armed/ended transitions and pruning **only at their historical knownAt times**, then simulates each variant with its own pending OCO/admission/lifetime. It does not filter baseline trade rows after seeing outcomes. Full-history canonical replay parity was checked on EURUSD (5,939 H4) and USDHKD (5,829 H4), including prices, registration/entry/exit times, outcomes, costs and gaps; synthetic prefix tests verify detector parity and future invariance. Original paper/FM source files remain unchanged.

Run from the repository root:

```
node Tools/h4-strategy-study/checks.cjs [artifacts/sql-recovered-site]
node Tools/h4-strategy-study/checks-stats.cjs [artifacts/h4-strategy-study-20261026]
node Tools/h4-strategy-study/run.cjs artifacts/sql-recovered-site artifacts/h4-strategy-study-20261026
node Tools/h4-strategy-study/report.cjs artifacts/h4-strategy-study-20261026
```

The dated output directory must already contain the frozen plan/plan SHA and `daily-sql.json`; candle and D1 artifacts are intentionally not checked into Git or published. The complete study was independently rerun and produced the identical `report.json` SHA. `report.html` is standalone/read-only, includes all 480 **discovery** rows with sorting/search, and links the full Czech report and CSV/audit downloads; no external fetch or private SQL credentials.

Observed result: no eligible trial had a positive discovery family-adjusted lower mean-R bound. The diagnostic candidate (TP1R, zone-height SL buffer25%, high origin volume and prior-years 20-D1 season alignment, original28 universe) had +29.042 net R /151 resolved trades in the final period versus -22.025R /282 for the same-universe baseline. It remains **not evidence-qualified**. There were41 ambiguous scenarios; assigning each a nominal -1R plus model costs gives a sensitivity of -15.361R. Training was nearly flat, 2024 negative, and the paired final improvement interval includes zero. Seasonal evidence is frozen at registration;18 final entries occurred >28days later. See the full report for these limitations before interpreting the headline profit.

Research context: [Bailey et al., Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf). The implemented weekly max-T wild bootstrap is an approximate multiple-comparison safeguard, **not** PBO/CSCV, not account-return inference, and not a guarantee of independence/nonstationarity correction. Actual broker execution costs, financing and intrabar order remain unresolved.
