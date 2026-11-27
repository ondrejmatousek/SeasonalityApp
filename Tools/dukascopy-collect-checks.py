"""Regression checks for source delta decoding, missing H1 and NY17 boundaries."""
import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import urllib.error
from unittest.mock import patch

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

# Reproduce the API's origin-only Referer gate for both H1 and native CFD D1.
requests = []


def source_response(request, timeout):
    requests.append(request)
    if request.get_header('Referer') != 'https://widgets.dukascopy.com/':
        raise urllib.error.HTTPError(request.full_url, 403, 'Forbidden', {}, None)
    payload = dict(source)
    payload['shift'] = 86400000 if '/day/' in request.full_url else 3600000

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return json.dumps(payload).encode()

    return Response()


with tempfile.TemporaryDirectory() as folder, patch.object(collector.urllib.request, 'urlopen', side_effect=source_response):
    root = pathlib.Path(folder)
    now = dt.datetime(2026, 11, 27, tzinfo=collector.UTC)
    hourly = collector.fetch(root, 'EURUSD', (2026, 10), now)
    daily = collector.fetch_daily(root, 'XAUUSD', 2026, now)
    assert len(hourly['rows']) == len(daily['rows']) == 2
    assert '/hour/EUR-USD/BID/2026/10' in requests[0].full_url
    assert '/day/XAU-USD/BID?from=' in requests[1].full_url
    assert hourly['sha256'] == collector.sha((root / hourly['file']).read_bytes())
    assert daily['sha256'] == collector.sha((root / daily['file']).read_bytes())
    collector.fetch(root, 'EURUSD', (2026, 10), now)
    collector.fetch_daily(root, 'XAUUSD', 2026, now)
    assert len(requests) == 2, 'Cached evidence must not be downloaded again'

print('PASS source request origin, H1/D1 evidence caching, original price deltas, no synthetic gap filling, DST NY17, complete H4/D1 and open-bar exclusion')
