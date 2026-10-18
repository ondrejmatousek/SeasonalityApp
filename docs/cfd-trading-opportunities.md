# CFD watchlist and zone-only prices

The requested watchlist is versioned in `wwwroot/js/cfd-instruments.js`: **50 unique instruments** (39 FX, 3 energies, 3 metals, 5 crypto). The default trading-zone filter now includes reviewed sources, without relabelling them validated core instruments. Each available instrument is evaluated by the existing D1/W1 detector, and FX also by H4. Zero valid zones is an explicit legitimate outcome, not missing COT confirmation.

## Source identity

- The original 39-market daily submission, seed, SQL generations and original 28-FX H4 pipeline are unchanged.
- Eleven additional OANDA FX pairs: USDHKD, EURNOK, EURPLN, EURSEK, USDMXN, USDNOK, USDPLN, USDSEK, USDZAR, SGDJPY, USDSGD. New D1 and H4 series use separate `market_zones` SQL tables.
- OANDA:XPTUSD supplies a new, isolated platinum D1/W1 zone reference. It is not spliced into PL=F seasonality history.
- BTCUSD, ETHUSD, SOLUSD, XRPUSD, BNBUSD zones use Yahoo OHLC matched against the existing Yahoo daily close series. CRYPTO:* D1 captures are stored separately in SQL for comparison and **never enter the zone projection**.
- Aliases: NGAS → NATGAS, XAGUSD → SILVER, XPTUSD → PLATINUM. Existing energy futures and OANDA metal sources remain unchanged. These are reference prices, not the particular broker's executable CFD bid/ask.
- New OANDA series have `contextCompatible:false`. Existing futures COT or unrelated seasonal windows are not borrowed to manufacture confirmation. Macro/session evidence remains unverified.

## Admission and persistence

New MCP tools `submit_zone_prices` and `get_zone_prices_status` retain the existing OAuth identity and `market.ingest` scope. Authorization is checked before parsing or SQL. Live captures must be fresh within 30 minutes, max 256 KiB and 96 bars/capture, 28 captures/batch. Original provider rows/columns JSON is retained exactly inside the immutable UTF-8 receipt, with SHA-256 readback. Server-side bootstrap is an explicit CLI-only path (8,000 bars/capture, max 24 MiB, 24h capture freshness); it is not exposed as an MCP flag.

Keys are `(provider-qualified symbol, interval, UTC start)`. Exact OHLC changes reject the whole batch. Volume-only differences are audited; stored volume, including null, is never overwritten. Successful retries return the saved decision. New active-zone bars request the existing static publishing workflow; crypto comparison-only batches do not.

OANDA H4 uses the existing NY17-aligned, elapsed + adjacent-boundary policy, including regular Friday close and conservative Dec24–Jan2 exclusion. OANDA D1 requires an elapsed NY17 session and an adjacent provider boundary (regular Thursday→Friday close exception). Crypto D1 uses elapsed UTC days. These are **provider-boundary checks, not a complete independently certified exchange calendar**. The new H4 projection is labelled `zone-provider-boundary-v1`, not the original historical six-H4-to-D1 parity certification. No missing bars are synthesized. The original H4 parity pipeline is unchanged.

An SQL export is independently checked against receipt hashes, exact raw OHLCV and boundary rules before the isolated zone snapshot is published. Normal seasonality/COT exports are not changed by this overlay.

## Initial import and operational handoff

2026-10-18: raw D1 from 2020 for 12 OANDA sources and the latest 3,000 H4 per new FX pair were fetched through TradingView MCP. H4 responses indicated older pages exist: this is an initial bounded history, **not all available H4 history**. Admission accepted 52,915 bars and excluded 1,234 unproven/holiday boundaries. Receipt `adc02f0253d7342f64c59f1a42371f0f8783aba8fa7f6762011acf9cec78e8da`.

Five separate CRYPTO D1 captures accepted 30 closed bars, excluded five open bars; receipt `539a9447551b4da6955d4af6a7ba6ee4bd43016859f21b84e07b02f276e21ef6`. Yahoo is unchanged.

The cloud Work prompts must add a separate extension leg rather than sending 56 bars into the strict 39-market daily tool or 39 symbols into the old 28-symbol H4 tool. Preserve daily 03:00 and H4 03:05/07:05/11:05/15:05/19:05/23:05 Europe/Prague, existing IDs, retries, raw checkpoints, weekend skip and all original safety rules. Refresh Seasonality tools and verify a real accepted submission + status readback before claiming the expanded schedule works. A failure in the extension leg must not discard the original collection's valid results. No new duplicate automation is required.

Verification: full app build/startup, isolated SQL receipt/conflict/volume tests, real SDK discovery + scope guards, 50-instrument detection checks, desktop/mobile browser filters and chart/navigation checks. CI repeats admission and projection checks during deployment.
