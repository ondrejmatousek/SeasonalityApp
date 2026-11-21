"""Collect original Dukascopy BID H1 responses and closed NY17 FX H4/D1 bars."""
import argparse
import calendar
import concurrent.futures
import datetime as dt
import decimal
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo('America/New_York')
FX = 'AUDCAD AUDCHF AUDJPY AUDNZD CADCHF CADJPY CHFJPY EURCAD EURCHF EURAUD EURGBP EURJPY EURNZD GBPAUD GBPCAD GBPCHF GBPJPY GBPNZD NZDCAD NZDCHF NZDJPY NZDUSD AUDUSD EURUSD GBPUSD USDCAD USDCHF USDJPY USDHKD EURNOK EURPLN EURSEK USDMXN USDNOK USDPLN USDSEK USDZAR SGDJPY USDSGD'.split()
RULE = 'dukascopy-bid-ny17-h1-v1'
ROOT = 'https://jetta.dukascopy.com/v1/candles/hour/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stamp(value):
    return value.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def market_hour(timestamp):
    local = dt.datetime.fromtimestamp(timestamp, UTC).astimezone(NY)
    return local.weekday() < 4 or local.weekday() == 4 and local.hour < 17 or local.weekday() == 6 and local.hour >= 17


def decode(body):
    """Decode only observed rows. Provider time deltas never create synthetic bars."""
    data = json.loads(body, parse_float=decimal.Decimal)
    keys = ('opens', 'highs', 'lows', 'closes', 'volumes')
    count = len(data['times'])
    if data['shift'] != 3600000 or any(len(data[k]) != count for k in keys):
        raise ValueError('Invalid H1 columns or shift')
    multiplier = decimal.Decimal(data['multiplier'])
    if not multiplier.is_finite() or multiplier <= 0 or multiplier < decimal.Decimal('0.0000000001'):
        raise ValueError('Invalid price multiplier')
    units = [int((decimal.Decimal(data[k]) / multiplier).to_integral_value(rounding=decimal.ROUND_HALF_UP)) for k in ('open', 'high', 'low', 'close')]
    timestamp = data['timestamp']
    previous = -1
    rows = []
    for index, delta in enumerate(data['times']):
        if not isinstance(delta, int) or delta < 0:
            raise ValueError('Invalid time delta')
        timestamp += delta * data['shift']
        if timestamp % 3600000 or timestamp <= previous:
            raise ValueError('Duplicate, unsorted or unaligned H1 timestamp')
        previous = timestamp
        for field, column in enumerate(keys[:4]):
            value = data[column][index]
            if not isinstance(value, int):
                raise ValueError('Price delta is not integer units')
            units[field] += value
        prices = [float(value * multiplier) for value in units]
        volume = data['volumes'][index]
        if not decimal.Decimal(volume).is_finite() or volume < 0:
            raise ValueError('Invalid volume')
        o, h, low, c = prices
        if low <= 0 or low > min(o, c) or h < max(o, c):
            raise ValueError('Invalid H1 OHLC geometry')
        rows.append(dict(timestamp=timestamp // 1000, open=o, high=h, low=low, close=c, volume=float(volume)))
    return rows


def aggregate(rows, observed):
    h4_groups, daily_groups = {}, {}
    for row in rows:
        if not market_hour(row['timestamp']) or row['timestamp'] + 3600 > observed.timestamp() - 60:
            continue
        local = dt.datetime.fromtimestamp(row['timestamp'], UTC).astimezone(NY)
        label = local.date() + dt.timedelta(days=1 if local.hour >= 17 else 0)
        start = dt.datetime.combine(label - dt.timedelta(days=1), dt.time(17), NY).astimezone(UTC)
        start = int(start.timestamp())
        h4_start = start + (row['timestamp'] - start) // 14400 * 14400
        h4_groups.setdefault(h4_start, []).append(row)
        daily_groups.setdefault(start, []).append(row)

    def combine(groups, hours):
        result, rejected = [], []
        for start, bars in sorted(groups.items()):
            end = start + hours * 3600
            if end > observed.timestamp() - 60:
                continue
            if [b['timestamp'] for b in bars] != list(range(start, end, 3600)):
                rejected.append(dict(timestamp=start, reason='missing-source-hours', received=len(bars), expected=hours))
                continue
            label = (dt.datetime.fromtimestamp(start, UTC).astimezone(NY).date() + dt.timedelta(days=1)).isoformat()
            result.append(dict(timestamp=start, date=label, endTimestamp=end, open=bars[0]['open'], high=max(b['high'] for b in bars), low=min(b['low'] for b in bars), close=bars[-1]['close'], volume=sum(b['volume'] for b in bars)))
        return result, rejected

    h4, h4_gaps = combine(h4_groups, 4)
    daily, daily_gaps = combine(daily_groups, 24)
    return dict(h4=h4, daily=daily, exclusions=dict(h4=h4_gaps, daily=daily_gaps))


def fetch(root, symbol, month, now):
    year, number = month
    code = symbol[:3] + '-' + symbol[3:]
    if (year, number) == (now.year, now.month):
        begin = int(dt.datetime(year, number, 1, tzinfo=UTC).timestamp() * 1000)
        url = f'{ROOT}{code}/BID?from={begin}'
    else:
        url = f'{ROOT}{code}/BID/{year}/{number}'
    relative = f'raw/{symbol}/{year}-{number:02d}.json'
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    # Historical files are immutable inputs during retries of the same local run.
    if target.exists():
        body = target.read_bytes()
    else:
        request = urllib.request.Request(url, headers={'Referer': 'https://widgets.dukascopy.com/en/historical-data-export', 'User-Agent': 'Mozilla/5.0 SeasonalityApp/1.0', 'Accept': 'application/json'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=35) as response:
                    body = response.read(2 * 1024 * 1024 + 1)
                    if response.status != 200 or len(body) > 2 * 1024 * 1024:
                        raise ValueError(f'Invalid source response: HTTP {response.status}, {len(body)} bytes')
                break
            except urllib.error.HTTPError as error:
                if error.code not in (429, 502, 503, 504) or attempt == 2:
                    raise
                time.sleep(5 * (attempt + 1))
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
        target.write_bytes(body)
    rows = decode(body)
    lower = int(dt.datetime(year, number, 1, tzinfo=UTC).timestamp())
    upper = lower + calendar.monthrange(year, number)[1] * 86400
    if not rows or any(not lower <= row['timestamp'] < upper for row in rows):
        raise ValueError(f'Empty or incorrect source month for {symbol} {year}-{number}')
    return dict(symbol=symbol, month=f'{year}-{number:02d}', url=url, file=relative, sha256=sha(body), rows=rows)


def collect(output, symbols, months):
    root = pathlib.Path(output).resolve()
    if not root.is_relative_to(pathlib.Path('artifacts').resolve()) or root == pathlib.Path('artifacts').resolve():
        raise ValueError('Output must be under artifacts')
    root.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(UTC)
    requested = []
    for offset in range(months):
        month_index = now.year * 12 + now.month - 1 - offset
        requested.append(divmod(month_index, 12))
    requested = [(year, month + 1) for year, month in reversed(requested)]
    summary = dict(schemaVersion=1, provider='Dukascopy', priceSide='BID', rule=RULE, observedAt=stamp(now), instruments=[], errors=[])
    for symbol in symbols:
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                evidence = list(pool.map(lambda month: fetch(root, symbol, month, now), requested))
            unique = {}
            for item in evidence:
                for row in item['rows']:
                    if row['timestamp'] in unique and unique[row['timestamp']] != row:
                        raise ValueError('Conflicting H1 overlap')
                    unique[row['timestamp']] = row
            bars = aggregate(sorted(unique.values(), key=lambda r: r['timestamp']), now)
            if len(bars['h4']) < 100:
                raise ValueError('Less than 100 complete H4 source candles')
            summary['instruments'].append(dict(key=symbol, symbol='DUKASCOPY:' + symbol, **bars, evidence=[{k: v for k, v in e.items() if k != 'rows'} for e in evidence]))
            print(json.dumps(dict(symbol=symbol, h4=len(bars['h4']), daily=len(bars['daily']), last=bars['h4'][-1]['endTimestamp'])), flush=True)
        except Exception as error:
            summary['errors'].append(dict(symbol=symbol, type=type(error).__name__, message=str(error)))
            print(json.dumps(summary['errors'][-1]), flush=True)
    summary['ready'] = len(summary['instruments']) == len(symbols) and not summary['errors']
    (root / 'collection.json').write_text(json.dumps(summary, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    if not summary['ready']:
        raise RuntimeError('Dukascopy collection incomplete; see collection.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='artifacts/dukascopy')
    parser.add_argument('--symbols', default=','.join(FX))
    parser.add_argument('--months', type=int, default=15)
    args = parser.parse_args()
    symbols = args.symbols.split(',')
    if not symbols or len(set(symbols)) != len(symbols) or not set(symbols).issubset(FX) or not 1 <= args.months <= 36:
        parser.error('Invalid symbol list or month count')
    collect(args.output, symbols, args.months)
