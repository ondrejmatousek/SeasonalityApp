const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { saveManifest } = require('./apply-market-sources.cjs');
const { extraFx } = require('../wwwroot/js/cfd-instruments.js');

const origin = 'https://delightful-ground-010f3d910.5.azurestaticapps.net';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

async function published(url, pattern) {
    assert.match(url, pattern);
    const response = await fetch(origin + url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, 'Published resource unavailable: ' + url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = url.match(/\.([a-f0-9]{20})\.json$/)?.[1];
    if (digest) assert.equal(sha(bytes).slice(0, 20), digest, 'Published resource hash mismatch');
    return bytes;
}

async function preserve(site, attempted) {
    const manifest = read(path.join(site, 'data/manifest.json'));
    const snapshotPath = manifest.zonePrices.path;
    const snapshot = read(path.join(site, snapshotPath.slice(1)));
    const previous = JSON.parse(await published('/data/manifest.json', /^\/data\/manifest\.json$/));
    const previousSnapshot = JSON.parse(await published(previous.zonePrices.path, /^\/data\/screener\/zone-prices\.[a-f0-9]{20}\.json$/));
    assert.ok(previousSnapshot.h4, 'Published H4 provenance missing');
    const previousH4Date = previousSnapshot.h4.live?.newestReceivedAt;
    const newH4Date = snapshot.h4?.live?.newestReceivedAt;
    const keepPreviousH4 = !snapshot.h4 || (previousH4Date && (!newH4Date || newH4Date < previousH4Date));
    const knownZoneOnly = new Set([...extraFx, 'PLATINUM', 'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD']);
    if (keepPreviousH4) {
        for (const [key, oldPrice] of Object.entries(previousSnapshot.prices)) {
            const current = snapshot.prices[key];
            if (knownZoneOnly.has(key) && (!current?.latestDate || oldPrice.latestDate > current.latestDate))
                snapshot.prices[key] = { ...oldPrice, h4: current?.h4 };
            if (oldPrice.h4?.status !== 'ready') continue;
            const price = snapshot.prices[key];
            if (!price || price.symbol !== oldPrice.symbol || price.provider !== oldPrice.provider) continue;
            if (!price.h4?.latestDate || oldPrice.h4.latestDate >= price.h4.latestDate)
                price.h4 = oldPrice.h4;
        }
        snapshot.h4 = previousSnapshot.h4;
        snapshot.cfdCoverage ??= previousSnapshot.cfdCoverage;
        const bytes = Buffer.from(JSON.stringify(snapshot));
        const url = '/data/screener/zone-prices.' + sha(bytes).slice(0, 20) + '.json';
        fs.writeFileSync(path.join(site, url.slice(1)), bytes);
        manifest.zonePrices = { ...manifest.zonePrices, path: url, h4: snapshot.h4, cfdCoverage: snapshot.cfdCoverage };
    }

    if ((keepPreviousH4 || !manifest.backtestHistory?.ready) && previous.backtestHistory?.ready) {
        const url = previous.backtestHistory.path;
        const bytes = await published(url, /^\/data\/backtesting\/h4-history-index\.[a-f0-9]{20}\.json$/);
        const prices = Object.values(JSON.parse(bytes).prices);
        assert.equal(prices.length, previous.backtestHistory.instruments);
        const folder = path.join(site, 'data/backtesting');
        fs.mkdirSync(folder, { recursive: true });
        for (let start = 0; start < prices.length; start += 6) {
            await Promise.all(prices.slice(start, start + 6).map(async ({ h4 }) => {
                const data = await published(h4.historyPath, /^\/data\/backtesting\/h4-[A-Z0-9]+\.[a-f0-9]{20}\.json$/);
                assert.equal(sha(data), h4.sha256);
                fs.writeFileSync(path.join(site, h4.historyPath.slice(1)), data);
            }));
        }
        fs.writeFileSync(path.join(site, url.slice(1)), bytes);
        manifest.backtestHistory = previous.backtestHistory;
    }

    const oldLedger = await published('/data/h4-paper/ledger.json', /^\/data\/h4-paper\/ledger\.json$/);
    const ledger = JSON.parse(oldLedger);
    const raw = JSON.stringify(ledger.state);
    assert.ok(raw && sha(raw) === ledger.stateSha256, 'Published paper ledger hash mismatch');
    const ledgerPath = path.join(site, 'data/h4-paper/ledger.json');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    if (keepPreviousH4 || !fs.existsSync(ledgerPath) || read(ledgerPath).revision < ledger.revision)
        fs.writeFileSync(ledgerPath, oldLedger);

    const researchPath = path.join(site, 'data/h4-paper/research.json');
    if (!fs.existsSync(researchPath))
        fs.writeFileSync(researchPath, await published('/data/h4-paper/research.json', /^\/data\/h4-paper\/research\.json$/));

    const auditPath = path.join(site, 'data/data-runs/receipts.json');
    const previousAudit = await published('/data/data-runs/receipts.json', /^\/data\/data-runs\/receipts\.json$/);
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    if (keepPreviousH4 || !fs.existsSync(auditPath)) fs.writeFileSync(auditPath, previousAudit);

    manifest.h4Publication = { status: keepPreviousH4 ? 'last-verified' : 'verified', liveObservedAt: keepPreviousH4 ? previousH4Date : newH4Date, refreshAttempted: attempted };
    saveManifest(site, manifest);
    console.log(JSON.stringify(manifest.h4Publication));
}

preserve(path.resolve(process.argv[2]), process.argv[3] === 'true').catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
