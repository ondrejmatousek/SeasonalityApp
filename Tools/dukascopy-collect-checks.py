"""Regression checks for source delta decoding, missing H1 and NY17 boundaries."""
import datetime as dt
import importlib.util
import json
import pathlib

spec = importlib.util.spec_from_file_location('collector', pathlib.Path(__file__).with_name('dukascopy-collect.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

source = dict(timestamp=1790812800000, multiplier=0.00001, shift=3600000,
              open=1.1, high=1.2, low=1.0, close=1.15,
              times=[0, 3], opens=[0, 1], highs=[0, 1], lows=[0, 1], closes=[0, 1], volumes=[1, 2])
rows = collector.decode(json.dumps(source).encode())
assert len(rows) == 2, 'Missing source hours must remain missing'
assert rows[1]['timestamp'] - rows[0]['timestamp'] == 10800
assert rows[1]['close'] == 1.15001

for day, expected in [('2026-03-09', 21), ('2026-11-02', 22)]:
    local = dt.datetime.fromisoformat(day).replace(hour=17, tzinfo=collector.NY)
    start = int(local.timestamp())
    bars = [dict(timestamp=start + i * 3600, open=1.1, high=1.2, low=1.0, close=1.15, volume=1) for i in range(24)]
    observed = dt.datetime.fromtimestamp(start + 86460, collector.UTC)
    result = collector.aggregate(bars, observed)
    assert dt.datetime.fromtimestamp(start, collector.UTC).hour == expected
    assert len(result['h4']) == 6 and len(result['daily']) == 1
    assert result['daily'][0]['date'] == (local.date() + dt.timedelta(days=1)).isoformat()
    incomplete = collector.aggregate(bars[:3] + bars[4:], observed)
    assert len(incomplete['h4']) == 5 and not incomplete['daily']
    assert incomplete['exclusions']['daily'][0]['received'] == 23
    unfinished = collector.aggregate(bars, dt.datetime.fromtimestamp(start + 3600, collector.UTC))
    assert not unfinished['h4'] and not unfinished['daily']

print('PASS original price deltas, no synthetic gap filling, DST NY17, complete H4/D1 and open-bar exclusion')
