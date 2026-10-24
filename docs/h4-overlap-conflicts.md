# H4 overlap conflicts — analysis and admission v2 (2026-10-24)

## Evidence and limits

Receipt `bcc7dd48e5f64e36cecb9bb085e4465269a611e8ae1bcb05a3118f826f7c6a08`
contains twelve completed EURUSD candles. Two existing slots disagree with SQL:

| Start UTC | Stored | Observed in submitted capture |
| --- | --- | --- |
| 2026-10-22 09:00 | open 1.12343, high 1.12370 | open 1.12208, high 1.12245 |
| 2026-10-22 21:00 | open 1.12160, low 1.12150 | open 1.12178, low 1.12168 |

Four new Friday slots (2026-10-23 05:00, 09:00, 13:00, 17:00 UTC)
were consequently not stored. Other symbols continued updating.

Earlier immutable raw captures support the stored values; subsequent submitted
captures sometimes agree and sometimes disagree. This establishes an inconsistent
overlap, not which upstream version is authoritative. A raw response retained by
Work is not an independent cryptographic attestation by TradingView. We cannot
prove whether the upstream data changed or a capture was altered before submission.
No provider-wide revision cause or definitive historical correction is claimed.

## Application root cause

`symbol-isolated-conflict-v1` quarantined every new bar of a symbol when any
existing overlap candle disagreed. Repeated rolling overlaps thus froze EURUSD,
even though the missing later candles had no stored counterpart to conflict with.

## New contract

`bar-isolated-conflict-v2` decides independently for each `(symbol, startUnix)`:

- A new candle must pass the unchanged identity, freshness, chronological,
  OHLC/precision and completed-provider-boundary checks before insertion.
- An exact existing OHLC is a duplicate. Volume-only differences remain audited;
  neither prices nor volumes are overwritten.
- A differing existing OHLC is quarantined with both stored and observed values.
  It is NOT inserted or counted as an exact duplicate. Other new candles on the
  same symbol are independent and may be inserted.
- `inserted + duplicates + distinct quarantined slots = admitted input bars`.
  Parser exclusions (e.g. open candles) are separate.
- A mixed result remains `PartialConflict`, with a visible warning. It is not a
  claim that the historical discrepancy was reconciled.
- Publication occurs only if new accepted rows exist, with exact original raw
  proof, original timestamps and immutable receipt hashes. Quarantined versions
  cannot enter the published rows.

The admission version is persisted per receipt. Old receipts and decisions are
immutable, including on retry; a v1 receipt is never reclassified as v2.

## Verification

SQL LocalDB regression: mixed same-symbol admission, exact retries, legacy v1
readback, immutable OHLC/volume and D1 sentinel. Publisher regression: new candles
on the same symbol publish, quarantined slots/unknown policies/open candles and
altered raw bytes are rejected. UI distinguishes bar-level warnings from legacy
symbol-level blocks.

This change prevents historical overlap conflicts from freezing new H4 ingestion.
It cannot guarantee upstream quotes never disagree, certify a complete exchange
calendar, or repair unrelated D1 collection problems. Historical correction requires
separate authoritative evidence and an explicit revision process.
