"""Four-pair HTTPS access evidence only. Never follows redirects or uses credentials."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import lzma
import math
import pathlib
import struct
import sys
import urllib.error
import urllib.request

PAIRS = ('EURUSD', 'GBPUSD', 'USDCAD', 'USDCHF')
UTC = dt.timezone.utc
HOST = 'https://datafeed.dukascopy.com/datafeed/'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def stamp():
    return dt.datetime.now(UTC).isoformat()

def url_for(pair, hour):
    if pair not in PAIRS or hour.tzinfo != UTC or hour.minute or hour.second:
        raise ValueError('Explicit pilot symbol and UTC hour required')
    return f'{HOST}{pair}/{hour.year}/{hour.month-1:02d}/{hour.day:02d}/{hour.hour:02d}h_ticks.bi5'

def decode(data, hour):
    # Legacy hourly archive, NOT the newer daily S3 layout: milliseconds from this UTC hour.
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=128*1024*1024)
    raw = decoder.decompress(data, max_length=128*1024*1024+1)
    if not decoder.eof or decoder.unused_data or not raw or len(raw) % 20:
        raise ValueError('Incomplete/empty/non-BI5 LZMA or wrong record length')
    ticks = []
    previous = -1
    duplicates = 0
    for offset in range(0, len(raw), 20):
        ms, ask, bid, ask_volume, bid_volume = struct.unpack_from('>IIIff', raw, offset)
        if ms >= 3600000 or ms < previous or not bid or ask < bid or not all(math.isfinite(x) and x >= 0 for x in (ask_volume, bid_volume)):
            raise ValueError('Invalid hourly timestamp, BID/ASK orientation, price or volume')
        duplicates += int(ms == previous)
        previous = ms
        ticks.append({'time': int(hour.timestamp()*1000)+ms, 'bid': bid/100000, 'ask': ask/100000})
    return ticks, duplicates

def fetch_hour(root, pair, hour, group):
    url = url_for(pair, hour)
    name = f'{pair}-{hour:%Y%m%d-%H}-{group}'
    evidence = {'pair':pair, 'group':group, 'url':url, 'requestTimestamp':stamp(), 'httpStatus':None,
                'responseHeaders':[], 'bytes':0, 'contentType':None, 'sha256':None, 'error':None,
                'validBI5':False, 'credentialsUsed':False, 'priceSide':'BID decoded from field 3; ASK from field 2',
                'hourStart':hour.isoformat(), 'redirectFollowed':False}
    body = None
    try:
        request = urllib.request.Request(url, headers={'User-Agent':'SeasonalityApp-read-only-access-audit/1.0'})
        opener = urllib.request.build_opener(NoRedirect())
        try:
            response = opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error  # Preserve failures and redirects, never follow them.
        with response:
            evidence['httpStatus'] = response.code
            evidence['responseHeaders'] = list(response.headers.items())
            evidence['contentType'] = response.headers.get('Content-Type')
            body = response.read(16*1024*1024+1)
            if len(body) > 16*1024*1024:
                raise ValueError('Payload size cap exceeded; not a complete file')
        evidence['bytes'] = len(body)
        evidence['sha256'] = hashlib.sha256(body).hexdigest()
        (root/(name+'.response')).write_bytes(body)
        evidence['rawFile'] = name+'.response'
        if evidence['httpStatus'] == 200:
            try:
                ticks, duplicates = decode(body, hour)
                evidence.update(validBI5=True, tickCount=len(ticks), duplicateTimestampCount=duplicates,
                                firstTickTimestamp=ticks[0]['time'], lastTickTimestamp=ticks[-1]['time'])
                if group == 'control':
                    (root/(name+'.ticks.json')).write_text(json.dumps(ticks, separators=(',',':')), encoding='utf-8')
            except (ValueError, lzma.LZMAError, EOFError, struct.error) as error:
                evidence['decodeError'] = str(error)
    except Exception as error:
        evidence['error'] = type(error).__name__+': '+str(error)
    evidence['completedTimestamp'] = stamp()
    (root/(name+'.metadata.json')).write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    return evidence

def run(destination):
    root = pathlib.Path(destination).resolve()
    if not root.is_relative_to(pathlib.Path('artifacts').resolve()) or root == pathlib.Path('artifacts').resolve() or root.exists():
        raise ValueError('New private artifacts subdirectory required')
    root.mkdir(parents=True)
    requests = [(pair, dt.datetime(2006,1,3,tzinfo=UTC), 'access') for pair in PAIRS]
    requests += [(pair, dt.datetime(2026,10,9,tzinfo=UTC), 'access') for pair in PAIRS]
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(fetch_hour, root, *args) for args in requests]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print(json.dumps({k:result.get(k) for k in ('pair','hourStart','httpStatus','bytes','contentType','validBI5','error','decodeError')}), flush=True)
    access_pass = len(results)==8 and all(r['validBI5'] for r in results)
    # No alternative hosts, HTTP downgrade, S3, credentials, or retries around an access failure.
    controls = []
    if access_pass:
        # Preselected complete NY17 session, 2026-10-08 17 NY -> 2026-10-09 17 NY.
        start = dt.datetime(2026,10,8,21,tzinfo=UTC)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(fetch_hour,root,pair,start+dt.timedelta(hours=i),'control') for pair in PAIRS for i in range(24)]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                controls.append(result)
                print(json.dumps({'controlPair':result['pair'],'hourStart':result['hourStart'],'httpStatus':result['httpStatus'],'validBI5':result['validBI5']}), flush=True)
    manifest = {'observedAt':stamp(), 'accessResult':'PASS' if access_pass else 'FAIL',
                'status':'ACCESS PASS' if access_pass else 'ACCESS BLOCKED', 'results':results, 'controlResults':controls,
                'productionChanged':False, 'session':'NY17 only after all 24 hours validate',
                'format':'LZMA-alone hourly ticks, 20-byte >IIIff, ms since UTC hour, scale 100000 for these 4 non-JPY FX pairs',
                'pilotReady':False}
    (root/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest

if __name__ == '__main__':
    manifest = run(sys.argv[1])
    # Outcome is recorded in artifact; packaging must run even when access fails.
    print(json.dumps({'accessResult':manifest['accessResult'],'validBI5Files':sum(r['validBI5'] for r in manifest['results']),'productionChanged':False}))
