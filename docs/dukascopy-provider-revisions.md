# Dukascopy provider revisions

Dukascopy can revise previously closed OHLC bars. The importer preserves the first accepted OHLCV and collection reference in `dukascopy.Bars`, continues inserting previously unseen bars, and records subsequent OHLC differences in `dukascopy.Revisions`.

Each revision contains the original and revised OHLCV, the original collection ID, and the incoming collection ID. Both collections and their SHA-256 verified original provider responses are retained in `dukascopy.Collections` and `dukascopy.Sources`. Revisions do not change the price projection exported for analytics or the prospective ledger.

Bars, revisions, collection receipts, and original source evidence commit in one serializable transaction under the existing writer lock. Retrying the same collection does not duplicate bars or revisions. Volume-only differences retain the previous behavior: stored OHLCV is preserved and no OHLC revision is recorded. Import logs report `inserted`, `revisionsObserved`, `revisionsRecorded`, and `revisionPolicy`.

The additive revision table is created automatically by the importer. Existing tables and prices are not rewritten. Input identity, source hashes, freshness, candle boundaries, and OHLCV validation remain required.

Validation:

```
dotnet build Tools/DukascopyImport/DukascopyImport.csproj -c Release
dotnet Tools/DukascopyImport/bin/Release/net10.0/DukascopyImport.dll --self-test-localdb
```

The SQL regression uses a uniquely named disposable LocalDB database and never reads production credentials. It verifies original prices/provenance, H4 and D1 corrections across all OHLC fields, exact revision evidence, new-bar insertion, retry deduplication, volume-only handling, and rollback of all writes when source persistence fails.
