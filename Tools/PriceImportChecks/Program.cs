using TradingJournal.Services;
using TradingJournal.Models;
using System.Text.Json;
void Check(bool value,string message){if(!value)throw new Exception(message);}
string Feed(string zone,string[] times,decimal[] closes)=>JsonSerializer.Serialize(new{chart=new{result=new[]{new{meta=new{exchangeTimezoneName=zone},timestamp=times.Select(t=>DateTimeOffset.Parse(t).ToUnixTimeSeconds()).ToArray(),indicators=new{quote=new[]{new{close=closes}}}}}}});
var summer=DailyPriceImport.YahooCompleted(Feed("Europe/London",["2026-10-06T23:00:00Z","2026-10-07T23:00:00Z"],[1.2m,1.3m]),DateTimeOffset.Parse("2026-10-08T10:00:00Z"));
Check(summer.Count==1 && summer[0].Date==new DateOnly(2026,10,7),"London trading date must not shift to prior UTC date or include current day");
var winter=DailyPriceImport.YahooCompleted(Feed("Europe/London",["2026-01-05T00:00:00Z"],[1.2m]),DateTimeOffset.Parse("2026-01-06T10:00:00Z"));Check(winter[0].Date==new DateOnly(2026,1,5),"Winter date");
var us=DailyPriceImport.YahooCompleted(Feed("America/New_York",["2026-10-07T13:30:00Z"],[100m]),DateTimeOffset.Parse("2026-10-08T02:00:00Z"));Check(us.Count==0,"UTC midnight does not mean NY session date has finished");
string SessionFeed(string date, string start, string end) {
    var data=System.Text.Json.Nodes.JsonNode.Parse(Feed("America/New_York",[date],[100m]))!;
    data["chart"]!["result"]![0]!["meta"]!["currentTradingPeriod"]=System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(new{regular=new{start=DateTimeOffset.Parse(start).ToUnixTimeSeconds(),end=DateTimeOffset.Parse(end).ToUnixTimeSeconds()}}));
    return data.ToJsonString();
}
var friday=SessionFeed("2026-10-16T13:30:00Z","2026-10-16T13:30:00Z","2026-10-16T20:00:00Z");
Check(DailyPriceImport.YahooCompleted(friday,DateTimeOffset.Parse("2026-10-17T01:05:00Z")).Single().Date==new DateOnly(2026,10,16),"03:05 Prague accepts completed Friday without waiting for NY midnight");
Check(DailyPriceImport.YahooCompleted(friday,DateTimeOffset.Parse("2026-10-16T19:59:59Z")).Count==0,"Reject live regular session");
Check(DailyPriceImport.YahooCompleted(friday,DateTimeOffset.Parse("2026-10-16T20:14:59Z")).Count==0,"Wait full finalization buffer");
Check(DailyPriceImport.YahooCompleted(friday,DateTimeOffset.Parse("2026-10-16T20:15:00Z")).Count==1,"Accept exact buffer boundary");
var shortDay=SessionFeed("2026-11-27T14:30:00Z","2026-11-27T14:30:00Z","2026-11-27T18:00:00Z");
Check(DailyPriceImport.YahooCompleted(shortDay,DateTimeOffset.Parse("2026-11-27T18:15:00Z")).Count==1,"Provider early-close metadata, not hard-coded 16:00");
var winterSession=SessionFeed("2026-01-05T14:30:00Z","2026-01-05T14:30:00Z","2026-01-05T21:00:00Z");
Check(DailyPriceImport.YahooCompleted(winterSession,DateTimeOffset.Parse("2026-01-06T02:00:00Z")).Count==1,"Winter EST metadata end");
var mismatched=SessionFeed("2026-10-16T13:30:00Z","2026-10-15T13:30:00Z","2026-10-15T20:00:00Z");
Check(DailyPriceImport.YahooCompleted(mismatched,DateTimeOffset.Parse("2026-10-17T01:05:00Z")).Count==0,"Previous-day metadata cannot authorize current local trading day");
var nextSession=SessionFeed("2026-10-16T13:30:00Z","2026-10-19T13:30:00Z","2026-10-19T20:00:00Z");
Check(DailyPriceImport.YahooCompleted(nextSession,DateTimeOffset.Parse("2026-10-17T01:05:00Z")).Count==0,"Future-session metadata keeps conservative fallback");
var malformed=SessionFeed("2026-10-16T13:30:00Z","2026-10-16T20:00:00Z","2026-10-16T13:30:00Z");
Check(DailyPriceImport.YahooCompleted(malformed,DateTimeOffset.Parse("2026-10-17T01:05:00Z")).Count==0,"Inverted session must not accept current day");
foreach(var invalidPeriod in new[]{"null","[]","\"invalid\"","{\"regular\":null}","{\"regular\":{\"start\":\"bad\",\"end\":1}}"}){
    var data=System.Text.Json.Nodes.JsonNode.Parse(friday)!;
    data["chart"]!["result"]![0]!["meta"]!["currentTradingPeriod"]=System.Text.Json.Nodes.JsonNode.Parse(invalidPeriod);
    Check(DailyPriceImport.YahooCompleted(data.ToJsonString(),DateTimeOffset.Parse("2026-10-17T01:05:00Z")).Count==0,"Malformed session metadata fails closed without discarding valid older data");
}
var entity=new SeasonalityPriceEntity{Date=new(2026,10,7),Source="Yahoo",Close=1.1m};var observed=DateTimeOffset.Parse("2026-10-09T10:00:00Z");
Check(DailyPriceImport.RefreshSameSource(entity,new(entity.Date,1.2m),"Yahoo",observed)&&entity.Close==1.2m&&entity.UpdatedAt==observed,"Saved incomplete close must be revisable");
Check(!DailyPriceImport.RefreshSameSource(entity,new(entity.Date,1.2m),"Yahoo",observed),"No-op revision");
try{DailyPriceImport.RefreshSameSource(entity,new(entity.Date,1.3m),"Stooq",observed);throw new Exception("Splice accepted");}catch(InvalidOperationException){}
Check(entity.Close==1.2m,"Rejected source switch must not mutate history");
try{SeasonalityService.ParseStooq("<html>verification</html>");throw new Exception("HTML accepted as prices");}catch(FormatException){}
Check(SeasonalityService.ParseStooq("Date,Open,High,Low,Close,Volume\n2099-01-01,1,2,1,1.5,0\n2026-01-01,1,2,1,1.5,0").Count==1,"Future CSV prices excluded");
Console.WriteLine("Price import checks passed: trading dates, DST, unfinished candles, saved price refresh, source-splice rejection.");
