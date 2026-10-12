using TradingJournal.Services;
using Microsoft.Extensions.Logging.Abstractions;
using System.Text.Json;
void Check(bool ok,string message){if(!ok)throw new Exception(message);}
var bundle=args.FirstOrDefault()??"artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json";
var router=new MarketPriceSources(bundle);
var service=new SeasonalityService(new NoNetwork(),NullLogger<SeasonalityService>.Instance,null,router);
foreach(var key in new[]{"EURUSD","NDX","SPX","XAUUSD","WTI"}){
    var prices=await service.LoadCachedPricesAsync(key);
    var expected=router.Prices(key);
    Check(prices.Count>1000&&prices.SequenceEqual(expected),key+" must use market file, not SQL/Yahoo");
    Check(router.Metadata(key).GetProperty("provider").GetString()!="Yahoo",key+" no Yahoo fallback");
}
Check(!MarketPriceSources.IsMarket(SeasonalityService.Assets.Single(a=>a.Key=="AAPL")),"AAPL must keep stock SQL path");
Check(!MarketPriceSources.IsMarket(SeasonalityService.Assets.Single(a=>a.Key=="QQQ")),"ETF is not a cash-index substitute");
Check(router.Prices("LEANHOGS").Count==0,"Unsupported commodity must not fall back to Yahoo");
Check(router.Metadata("SPX").GetProperty("htfFrom").GetString()=="1962-01-01","SPX close-only prehistory excluded from HTF");
using var m=JsonDocument.Parse(File.ReadAllText(bundle));
Check(m.RootElement.GetProperty("entries").GetArrayLength()==36,"Explicit 36 sources");
Console.WriteLine("PASS: actual C# service routing, EURUSD/NDX/SPX/XAUUSD/WTI file histories, no HTTP/SQL fallback, AAPL/QQQ remain stock/ETF SQL, SPX HTF boundary.");
sealed class NoNetwork:IHttpClientFactory {public HttpClient CreateClient(string name)=>throw new Exception("Unexpected HTTP provider request");}
