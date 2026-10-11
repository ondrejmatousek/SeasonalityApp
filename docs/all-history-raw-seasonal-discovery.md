# Full-history, unsmoothed interval discovery

Discovery identifier: `all-completed-years-unsmoothed-v2`.

Intervals now use every eligible completed price year, not only years preceding the latest eight or a capped 20-year discovery sample. Current-year prices are excluded. Existing completeness checks remain: annual edges within seven days, positive finite closes, and no gaps over seven days.

Daily curves normalize each year to its first close = 100, interpolate missing calendar days and average years equally. February 29 is excluded from the common 365-day calendar in both Seasonality and discovery. No seven-day smoothing is applied. Discovery and detail export the same curve and year set. Local extrema still require the existing ±7-day neighborhood; the first suitable opposite extremum remains 14–60 days later. All price outcomes are recomputed for the newly selected interval.

Selection still chooses at most one up and one down window, using the existing selection comparator. COT does not choose endpoints. V1/V2 formulas, weights, confidence logic, COT normalization/tolerance, registry and tracking logic are unchanged. Scores and rankings can change because their input intervals change.

The latest eight years participate in discovery. Their check is descriptive regime consistency, **not an independent holdout**. `recentCheckIndependent: false` makes this explicit in the export. In-sample selection and searching many intervals can inflate historical results. Neither raw extrema nor greater chart detail demonstrate more precise trade execution or calibrated future success probabilities.

Existing V2 S/R calculation still splits its fixed 20-year evaluation history into non-overlapping older/recent samples. That does not make recent results independent of full-history interval selection. Recent discovery samples are never added twice to aggregate historical cases.

Checks: `Tools/opportunities-checks.cjs`, `Tools/raw-seasonality-checks.cjs <static export>`, and `Tools/detail-chart-browser-checks.cjs <export or URL>`.
