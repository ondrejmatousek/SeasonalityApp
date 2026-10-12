import datetime as dt
import importlib.util
import lzma
import struct
import unittest

spec=importlib.util.spec_from_file_location('probe', 'Tools/dukascopy-github-probe.py')
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class Checks(unittest.TestCase):
    def test_layout(self):
        hour=dt.datetime(2006,1,3,tzinfo=dt.timezone.utc)
        data=lzma.compress(struct.pack('>IIIff',123,120005,120000,1.0,2.0),format=lzma.FORMAT_ALONE)
        ticks,duplicates=probe.decode(data,hour)
        self.assertEqual(ticks[0],{'time':int(hour.timestamp()*1000)+123,'bid':1.2,'ask':1.20005})
        self.assertEqual(duplicates,0)
        self.assertEqual(probe.url_for('EURUSD',hour),'https://datafeed.dukascopy.com/datafeed/EURUSD/2006/00/03/00h_ticks.bi5')
    def test_fail_closed(self):
        hour=dt.datetime(2026,10,9,tzinfo=dt.timezone.utc)
        for record in (struct.pack('>IIIff',3600000,120005,120000,1,1),struct.pack('>IIIff',1,110000,120000,1,1),b'bad'):
            with self.assertRaises(ValueError):probe.decode(lzma.compress(record,format=lzma.FORMAT_ALONE),hour)
        with self.assertRaises(lzma.LZMAError):probe.decode(b'<html>503</html>',hour)
        self.assertIsNone(probe.NoRedirect().redirect_request(None,None,301,'moved',{},'http://datafeed.dukascopy.com/'))
        with self.assertRaises(ValueError):probe.url_for('AUDUSD',hour)

if __name__=='__main__':unittest.main()
