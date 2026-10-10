using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TradingJournal.Data;
using TradingJournal.Models;
using TradingJournal.ViewModels;

namespace TradingJournal.Services;

public sealed class SeasonalityService
{
    private static readonly SemaphoreSlim UpdateGate = new(1, 1);
    public static IReadOnlyList<SeasonalityAsset> Assets { get; } = BuildAssets();

    // Search aliases resolve to existing assets; they do not create duplicate price histories.
    public static IReadOnlyList<string> SearchAliases(string key) => key switch
    {
        "NDX" => ["NQ"], "SPX" => ["ES"], "DJI" => ["YM"], "RUT" => ["RTY"],
        "XAUUSD" => ["XAU", "GC"], "SILVER" => ["XAG", "SI"],
        "WTI" => ["CL"], "NATGAS" => ["NG"],
        "LIVECATTLE" => ["LE", "LE=F", "Live Cattle", "dobytek", "skot", "hovězí", "maso"],
        "FEEDERCATTLE" => ["GF", "GF=F", "Feeder Cattle", "dobytek", "skot", "hovězí", "maso"],
        "LEANHOGS" => ["HE", "HE=F", "Lean Hogs", "prasata", "vepřové", "maso"],
        "MILK" => ["DC", "DC=F", "Class III Milk", "mléko", "mleko"],
        "BUTTER" => ["CB=F", "Cash-settled Butter", "máslo", "maslo"],
        "CHEESE" => ["CSC", "CSC=F", "Cash-Settled Cheese", "sýr", "syr"],
        "KCWHEAT" => ["KE", "KE=F", "KC HRW Wheat", "Kansas", "pšenice", "psenice"], _ => []
    };

    private static IReadOnlyList<SeasonalityAsset> BuildAssets()
    {
        SeasonalityAsset[] assets =
        [
                new("EURUSD", "EUR/USD", "EURUSD=X", "eurusd"),
                new("GBPUSD", "GBP/USD", "GBPUSD=X", "gbpusd"),
                new("USDJPY", "USD/JPY", "JPY=X", "usdjpy"),
                new("USDCHF", "USD/CHF", "CHF=X", "usdchf"),
                new("AUDUSD", "AUD/USD", "AUDUSD=X", "audusd"),
                new("NZDUSD", "NZD/USD", "NZDUSD=X", "nzdusd"),
                new("USDCAD", "USD/CAD", "CAD=X", "usdcad"),
                new("EURGBP", "EUR/GBP", "EURGBP=X", "eurgbp"),
                new("EURJPY", "EUR/JPY", "EURJPY=X", "eurjpy"),
                new("EURCHF", "EUR/CHF", "EURCHF=X", "eurchf"),
                new("EURAUD", "EUR/AUD", "EURAUD=X", "euraud"),
                new("EURCAD", "EUR/CAD", "EURCAD=X", "eurcad"),
                new("EURNZD", "EUR/NZD", "EURNZD=X", "eurnzd"),
                new("GBPJPY", "GBP/JPY", "GBPJPY=X", "gbpjpy"),
                new("GBPCHF", "GBP/CHF", "GBPCHF=X", "gbpchf"),
                new("GBPAUD", "GBP/AUD", "GBPAUD=X", "gbpaud"),
                new("GBPCAD", "GBP/CAD", "GBPCAD=X", "gbpcad"),
                new("GBPNZD", "GBP/NZD", "GBPNZD=X", "gbpnzd"),
                new("AUDJPY", "AUD/JPY", "AUDJPY=X", "audjpy"),
                new("AUDNZD", "AUD/NZD", "AUDNZD=X", "audnzd"),
                new("AUDCAD", "AUD/CAD", "AUDCAD=X", "audcad"),
                new("AUDCHF", "AUD/CHF", "AUDCHF=X", "audchf"),
                new("NZDJPY", "NZD/JPY", "NZDJPY=X", "nzdjpy"),
                new("NZDCAD", "NZD/CAD", "NZDCAD=X", "nzdcad"),
                new("NZDCHF", "NZD/CHF", "NZDCHF=X", "nzdchf"),
                new("CADJPY", "CAD/JPY", "CADJPY=X", "cadjpy"),
                new("CADCHF", "CAD/CHF", "CADCHF=X", "cadchf"),
                new("CHFJPY", "CHF/JPY", "CHFJPY=X", "chfjpy"),
                new("DXY", "US Dollar Index / DXY", "DX-Y.NYB", "dx.f"),
                new("XAUUSD", "Gold / XAU/USD", "GC=F", "xauusd"),
                new("SILVER", "Silver", "SI=F", "si.f"),
                new("COPPER", "Copper", "HG=F", "hg.f"),
                new("PLATINUM", "Platinum", "PL=F", "pl.f"),
                new("PALLADIUM", "Palladium", "PA=F", "pa.f"),
                new("WTI", "Crude Oil WTI", "CL=F", "cl.f"),
                new("BRENT", "Brent Crude Oil", "BZ=F", "bz.f"),
                new("NATGAS", "Natural Gas", "NG=F", "ng.f"),
                new("CORN", "Corn", "ZC=F", "zc.f"),
                new("WHEAT", "Wheat", "ZW=F", "zw.f"),
                new("KCWHEAT", "Pšenice Kansas HRW / KC Wheat", "KE=F", "ke.f"),
                new("SOYBEANS", "Soybeans", "ZS=F", "zs.f"),
                new("COFFEE", "Coffee", "KC=F", "kc.f"),
                new("SUGAR", "Sugar", "SB=F", "sb.f"),
                new("GASOLINE", "RBOB Gasoline", "RB=F", "rb.f"),
                new("HEATINGOIL", "Heating Oil", "HO=F", "ho.f"),
                new("COTTON", "Cotton", "CT=F", "ct.f"),
                new("COCOA", "Cocoa", "CC=F", "cc.f"),
                new("OATS", "Oats", "ZO=F", "zo.f"),
                new("RICE", "Rough Rice", "ZR=F", "zr.f"),
                new("SOYBEANOIL", "Soybean Oil", "ZL=F", "zl.f"),
                new("SOYBEANMEAL", "Soybean Meal", "ZM=F", "zm.f"),
                new("LIVECATTLE", "Live Cattle / Skot na porážku", "LE=F", "le.f"),
                new("FEEDERCATTLE", "Feeder Cattle / Skot na výkrm", "GF=F", "gf.f"),
                new("LEANHOGS", "Lean Hogs / Vepřové", "HE=F", "he.f"),
                new("MILK", "Class III Milk / Mléko", "DC=F", "dc.f"),
                new("BUTTER", "Cash-Settled Butter / Máslo", "CB=F", "cb.f"),
                new("CHEESE", "Cash-Settled Cheese / Sýr", "CSC=F", "csc.f"),
                new("ORANGEJUICE", "Orange Juice", "OJ=F", "oj.f"),
                new("LUMBER", "Lumber", "LBS=F", "lbs.f"),
                new("DBC", "Invesco DB Commodity Index Tracking Fund", "DBC", "dbc.us"),
                new("PDBC", "Invesco Optimum Yield Diversified Commodity Strategy", "PDBC", "pdbc.us"),
                new("DBA", "Invesco DB Agriculture Fund", "DBA", "dba.us"),
                new("DBE", "Invesco DB Energy Fund", "DBE", "dbe.us"),
                new("DBB", "Invesco DB Base Metals Fund", "DBB", "dbb.us"),
                new("CPER", "United States Copper Index Fund", "CPER", "cper.us"),
                new("WEAT", "Teucrium Wheat Fund", "WEAT", "weat.us"),
                new("CORNETF", "Teucrium Corn Fund", "CORN", "corn.us"),
                new("SOYBETF", "Teucrium Soybean Fund", "SOYB", "soyb.us"),
                new("CANE", "Teucrium Sugar Fund", "CANE", "cane.us"),
                new("BTCUSD", "Bitcoin / BTC/USD", "BTC-USD", "btcusd"),
                new("ETHUSD", "Ethereum / ETH/USD", "ETH-USD", "ethusd"),
                new("SOLUSD", "Solana / SOL/USD", "SOL-USD", "solusd"),
                new("XRPUSD", "XRP / XRP/USD", "XRP-USD", "xrpusd"),
                new("BNBUSD", "BNB / BNB/USD", "BNB-USD", "bnbusd"),
                new("SPX", "S&P 500", "^GSPC", "^spx"),
                new("NDX", "Nasdaq-100", "^NDX", "^ndx"),
                new("DJI", "Dow Jones Industrial Average", "^DJI", "^dji"),
                new("RUT", "Russell 2000", "^RUT", "^rut"),
                new("VIX", "CBOE Volatility Index", "^VIX", "^vix"),
                new("DAX", "DAX", "^GDAXI", "^dax"),
                new("FTSE100", "FTSE 100", "^FTSE", "^ftse"),
                new("NIKKEI225", "Nikkei 225", "^N225", "^nkx"),
                new("HSI", "Hang Seng Index", "^HSI", "^hsi"),
                new("STOXX50E", "Euro Stoxx 50", "^STOXX50E", "^stoxx50e"),
                new("SPY", "SPDR S&P 500 ETF", "SPY", "spy.us"),
                new("QQQ", "Invesco QQQ ETF", "QQQ", "qqq.us"),
                new("DIA", "SPDR Dow Jones Industrial Average ETF", "DIA", "dia.us"),
                new("IWM", "iShares Russell 2000 ETF", "IWM", "iwm.us"),
                new("VTI", "Vanguard Total Stock Market ETF", "VTI", "vti.us"),
                new("VT", "Vanguard Total World Stock ETF", "VT", "vt.us"),
                new("EFA", "iShares MSCI EAFE ETF", "EFA", "efa.us"),
                new("EEM", "iShares MSCI Emerging Markets ETF", "EEM", "eem.us"),
                new("TLT", "iShares 20+ Year Treasury Bond ETF", "TLT", "tlt.us"),
                new("IEF", "iShares 7-10 Year Treasury Bond ETF", "IEF", "ief.us"),
                new("GLD", "SPDR Gold Shares ETF", "GLD", "gld.us"),
                new("SLV", "iShares Silver Trust ETF", "SLV", "slv.us"),
                new("USO", "United States Oil Fund", "USO", "uso.us"),
                new("UNG", "United States Natural Gas Fund", "UNG", "ung.us"),
                new("XLE", "Energy Select Sector SPDR ETF", "XLE", "xle.us"),
                new("XLF", "Financial Select Sector SPDR ETF", "XLF", "xlf.us"),
                new("XLK", "Technology Select Sector SPDR ETF", "XLK", "xlk.us"),
                new("XLV", "Health Care Select Sector SPDR ETF", "XLV", "xlv.us"),
                new("XLY", "Consumer Discretionary Select Sector SPDR ETF", "XLY", "xly.us"),
                new("XLP", "Consumer Staples Select Sector SPDR ETF", "XLP", "xlp.us"),
                new("XLI", "Industrial Select Sector SPDR ETF", "XLI", "xli.us"),
                new("XLU", "Utilities Select Sector SPDR ETF", "XLU", "xlu.us"),
                new("XLB", "Materials Select Sector SPDR ETF", "XLB", "xlb.us"),
                new("VNQ", "Vanguard Real Estate ETF", "VNQ", "vnq.us"),
                new("ARKK", "ARK Innovation ETF", "ARKK", "arkk.us"),
                new("AAPL", "Apple", "AAPL", "aapl.us"),
                new("MSFT", "Microsoft", "MSFT", "msft.us"),
                new("NVDA", "NVIDIA", "NVDA", "nvda.us"),
                new("AMZN", "Amazon", "AMZN", "amzn.us"),
                new("GOOGL", "Alphabet", "GOOGL", "googl.us"),
                new("META", "Meta Platforms", "META", "meta.us"),
                new("TSLA", "Tesla", "TSLA", "tsla.us"),
                new("AVGO", "Broadcom", "AVGO", "avgo.us"),
                new("ORCL", "Oracle", "ORCL", "orcl.us"),
                new("AMD", "Advanced Micro Devices", "AMD", "amd.us"),
                new("INTC", "Intel", "INTC", "intc.us"),
                new("QCOM", "Qualcomm", "QCOM", "qcom.us"),
                new("CSCO", "Cisco", "CSCO", "csco.us"),
                new("ADBE", "Adobe", "ADBE", "adbe.us"),
                new("CRM", "Salesforce", "CRM", "crm.us"),
                new("NFLX", "Netflix", "NFLX", "nflx.us"),
                new("NOW", "ServiceNow", "NOW", "now.us"),
                new("IBM", "IBM", "IBM", "ibm.us"),
                new("SHOP", "Shopify", "SHOP", "shop.us"),
                new("UBER", "Uber", "UBER", "uber.us"),
                new("PANW", "Palo Alto Networks", "PANW", "panw.us"),
                new("SNOW", "Snowflake", "SNOW", "snow.us"),
                new("PLTR", "Palantir", "PLTR", "pltr.us"),
                new("MU", "Micron Technology", "MU", "mu.us"),
                new("TSM", "Taiwan Semiconductor Manufacturing", "TSM", "tsm.us"),
                new("JPM", "JPMorgan Chase", "JPM", "jpm.us"),
                new("BAC", "Bank of America", "BAC", "bac.us"),
                new("GS", "Goldman Sachs", "GS", "gs.us"),
                new("V", "Visa", "V", "v.us"),
                new("MA", "Mastercard", "MA", "ma.us"),
                new("UNH", "UnitedHealth Group", "UNH", "unh.us"),
                new("JNJ", "Johnson & Johnson", "JNJ", "jnj.us"),
                new("LLY", "Eli Lilly", "LLY", "lly.us"),
                new("PFE", "Pfizer", "PFE", "pfe.us"),
                new("XOM", "Exxon Mobil", "XOM", "xom.us"),
                new("CVX", "Chevron", "CVX", "cvx.us"),
                new("COST", "Costco", "COST", "cost.us"),
                new("WMT", "Walmart", "WMT", "wmt.us"),
                new("MCD", "McDonald's", "MCD", "mcd.us"),
                new("DIS", "Disney", "DIS", "dis.us"),
                new("MMM", "3M", "MMM", "mmm.us"),
                new("AOS", "A. O. Smith", "AOS", "aos.us"),
                new("ABT", "Abbott Laboratories", "ABT", "abt.us"),
                new("ABBV", "AbbVie", "ABBV", "abbv.us"),
                new("ACN", "Accenture", "ACN", "acn.us"),
                new("AES", "AES Corporation", "AES", "aes.us"),
                new("AFL", "Aflac", "AFL", "afl.us"),
                new("A", "Agilent Technologies", "A", "a.us"),
                new("APD", "Air Products", "APD", "apd.us"),
                new("ABNB", "Airbnb", "ABNB", "abnb.us"),
                new("AKAM", "Akamai Technologies", "AKAM", "akam.us"),
                new("ALB", "Albemarle Corporation", "ALB", "alb.us"),
                new("ARE", "Alexandria Real Estate Equities", "ARE", "are.us"),
                new("ALGN", "Align Technology", "ALGN", "algn.us"),
                new("ALLE", "Allegion", "ALLE", "alle.us"),
                new("LNT", "Alliant Energy", "LNT", "lnt.us"),
                new("ALL", "Allstate", "ALL", "all.us"),
                new("GOOG", "Alphabet Inc. (Class C)", "GOOG", "goog.us"),
                new("MO", "Altria", "MO", "mo.us"),
                new("AMCR", "Amcor", "AMCR", "amcr.us"),
                new("AEE", "Ameren", "AEE", "aee.us"),
                new("AEP", "American Electric Power", "AEP", "aep.us"),
                new("AXP", "American Express", "AXP", "axp.us"),
                new("AIG", "American International Group", "AIG", "aig.us"),
                new("AMT", "American Tower", "AMT", "amt.us"),
                new("AWK", "American Water Works", "AWK", "awk.us"),
                new("AMP", "Ameriprise Financial", "AMP", "amp.us"),
                new("AME", "Ametek", "AME", "ame.us"),
                new("AMGN", "Amgen", "AMGN", "amgn.us"),
                new("APH", "Amphenol", "APH", "aph.us"),
                new("ADI", "Analog Devices", "ADI", "adi.us"),
                new("AON", "Aon plc", "AON", "aon.us"),
                new("APA", "APA Corporation", "APA", "apa.us"),
                new("APO", "Apollo Global Management", "APO", "apo.us"),
                new("AMAT", "Applied Materials", "AMAT", "amat.us"),
                new("APP", "AppLovin", "APP", "app.us"),
                new("APTV", "Aptiv", "APTV", "aptv.us"),
                new("ACGL", "Arch Capital Group", "ACGL", "acgl.us"),
                new("ADM", "Archer Daniels Midland", "ADM", "adm.us"),
                new("ARES", "Ares Management", "ARES", "ares.us"),
                new("ANET", "Arista Networks", "ANET", "anet.us"),
                new("AJG", "Arthur J. Gallagher & Co.", "AJG", "ajg.us"),
                new("AIZ", "Assurant", "AIZ", "aiz.us"),
                new("T", "AT&T", "T", "t.us"),
                new("ATO", "Atmos Energy", "ATO", "ato.us"),
                new("ADSK", "Autodesk", "ADSK", "adsk.us"),
                new("ADP", "Automatic Data Processing", "ADP", "adp.us"),
                new("AZO", "AutoZone", "AZO", "azo.us"),
                new("AVY", "Avery Dennison", "AVY", "avy.us"),
                new("AXON", "Axon Enterprise", "AXON", "axon.us"),
                new("BKR", "Baker Hughes", "BKR", "bkr.us"),
                new("BALL", "Ball Corporation", "BALL", "ball.us"),
                new("BAX", "Baxter International", "BAX", "bax.us"),
                new("BDX", "Becton Dickinson", "BDX", "bdx.us"),
                new("BRKB", "Berkshire Hathaway", "BRK-B", "brk-b.us"),
                new("BBY", "Best Buy", "BBY", "bby.us"),
                new("TECH", "Bio-Techne", "TECH", "tech.us"),
                new("BIIB", "Biogen", "BIIB", "biib.us"),
                new("BLK", "BlackRock", "BLK", "blk.us"),
                new("BX", "Blackstone Inc.", "BX", "bx.us"),
                new("XYZ", "Block, Inc.", "XYZ", "xyz.us"),
                new("BNY", "BNY Mellon", "BNY", "bny.us"),
                new("BA", "Boeing", "BA", "ba.us"),
                new("BKNG", "Booking Holdings", "BKNG", "bkng.us"),
                new("BSX", "Boston Scientific", "BSX", "bsx.us"),
                new("BMY", "Bristol Myers Squibb", "BMY", "bmy.us"),
                new("BR", "Broadridge Financial Solutions", "BR", "br.us"),
                new("BRO", "Brown & Brown", "BRO", "bro.us"),
                new("BFB", "Brown–Forman", "BF-B", "bf-b.us"),
                new("BLDR", "Builders FirstSource", "BLDR", "bldr.us"),
                new("BG", "Bunge Global", "BG", "bg.us"),
                new("BXP", "BXP, Inc.", "BXP", "bxp.us"),
                new("CHRW", "C.H. Robinson", "CHRW", "chrw.us"),
                new("CDNS", "Cadence Design Systems", "CDNS", "cdns.us"),
                new("CPT", "Camden Property Trust", "CPT", "cpt.us"),
                new("COF", "Capital One", "COF", "cof.us"),
                new("CAH", "Cardinal Health", "CAH", "cah.us"),
                new("CCL", "Carnival Corporation", "CCL", "ccl.us"),
                new("CARR", "Carrier Global", "CARR", "carr.us"),
                new("CVNA", "Carvana", "CVNA", "cvna.us"),
                new("CASY", "Casey's", "CASY", "casy.us"),
                new("CAT", "Caterpillar Inc.", "CAT", "cat.us"),
                new("CBOE", "Cboe Global Markets", "CBOE", "cboe.us"),
                new("CBRE", "CBRE Group", "CBRE", "cbre.us"),
                new("CDW", "CDW Corporation", "CDW", "cdw.us"),
                new("COR", "Cencora", "COR", "cor.us"),
                new("CNC", "Centene Corporation", "CNC", "cnc.us"),
                new("CNP", "CenterPoint Energy", "CNP", "cnp.us"),
                new("CF", "CF Industries", "CF", "cf.us"),
                new("CRL", "Charles River Laboratories", "CRL", "crl.us"),
                new("SCHW", "Charles Schwab Corporation", "SCHW", "schw.us"),
                new("CHTR", "Charter Communications", "CHTR", "chtr.us"),
                new("CMG", "Chipotle Mexican Grill", "CMG", "cmg.us"),
                new("CB", "Chubb Limited", "CB", "cb.us"),
                new("CHD", "Church & Dwight", "CHD", "chd.us"),
                new("CIEN", "Ciena", "CIEN", "cien.us"),
                new("CI", "Cigna", "CI", "ci.us"),
                new("CINF", "Cincinnati Financial", "CINF", "cinf.us"),
                new("CTAS", "Cintas", "CTAS", "ctas.us"),
                new("C", "Citigroup", "C", "c.us"),
                new("CFG", "Citizens Financial Group", "CFG", "cfg.us"),
                new("CLX", "Clorox", "CLX", "clx.us"),
                new("CME", "CME Group", "CME", "cme.us"),
                new("CMS", "CMS Energy", "CMS", "cms.us"),
                new("KO", "Coca-Cola Company (The)", "KO", "ko.us"),
                new("CTSH", "Cognizant", "CTSH", "ctsh.us"),
                new("COHR", "Coherent Corp.", "COHR", "cohr.us"),
                new("COIN", "Coinbase", "COIN", "coin.us"),
                new("CL", "Colgate-Palmolive", "CL", "cl.us"),
                new("CMCSA", "Comcast", "CMCSA", "cmcsa.us"),
                new("FIX", "Comfort Systems USA", "FIX", "fix.us"),
                new("COP", "ConocoPhillips", "COP", "cop.us"),
                new("ED", "Consolidated Edison", "ED", "ed.us"),
                new("STZ", "Constellation Brands", "STZ", "stz.us"),
                new("CEG", "Constellation Energy", "CEG", "ceg.us"),
                new("COO", "Cooper Companies (The)", "COO", "coo.us"),
                new("CPRT", "Copart", "CPRT", "cprt.us"),
                new("GLW", "Corning Inc.", "GLW", "glw.us"),
                new("CPAY", "Corpay", "CPAY", "cpay.us"),
                new("CTVA", "Corteva", "CTVA", "ctva.us"),
                new("CSGP", "CoStar Group", "CSGP", "csgp.us"),
                new("CRH", "CRH plc", "CRH", "crh.us"),
                new("CRWD", "CrowdStrike", "CRWD", "crwd.us"),
                new("CCI", "Crown Castle", "CCI", "cci.us"),
                new("CSX", "CSX Corporation", "CSX", "csx.us"),
                new("CMI", "Cummins", "CMI", "cmi.us"),
                new("CVS", "CVS Health", "CVS", "cvs.us"),
                new("DHR", "Danaher Corporation", "DHR", "dhr.us"),
                new("DRI", "Darden Restaurants", "DRI", "dri.us"),
                new("DDOG", "Datadog", "DDOG", "ddog.us"),
                new("DVA", "DaVita", "DVA", "dva.us"),
                new("DECK", "Deckers Brands", "DECK", "deck.us"),
                new("DE", "Deere & Company", "DE", "de.us"),
                new("DELL", "Dell Technologies", "DELL", "dell.us"),
                new("DAL", "Delta Air Lines", "DAL", "dal.us"),
                new("DVN", "Devon Energy", "DVN", "dvn.us"),
                new("DXCM", "Dexcom", "DXCM", "dxcm.us"),
                new("FANG", "Diamondback Energy", "FANG", "fang.us"),
                new("DLR", "Digital Realty", "DLR", "dlr.us"),
                new("DG", "Dollar General", "DG", "dg.us"),
                new("DLTR", "Dollar Tree", "DLTR", "dltr.us"),
                new("D", "Dominion Energy", "D", "d.us"),
                new("DPZ", "Domino's", "DPZ", "dpz.us"),
                new("DASH", "DoorDash", "DASH", "dash.us"),
                new("DOV", "Dover Corporation", "DOV", "dov.us"),
                new("DOW", "Dow Inc.", "DOW", "dow.us"),
                new("DHI", "D. R. Horton", "DHI", "dhi.us"),
                new("DTE", "DTE Energy", "DTE", "dte.us"),
                new("DUK", "Duke Energy", "DUK", "duk.us"),
                new("DD", "DuPont", "DD", "dd.us"),
                new("ETN", "Eaton Corporation", "ETN", "etn.us"),
                new("EBAY", "eBay Inc.", "EBAY", "ebay.us"),
                new("ECHO", "EchoStar", "ECHO", "echo.us"),
                new("ECL", "Ecolab", "ECL", "ecl.us"),
                new("EIX", "Edison International", "EIX", "eix.us"),
                new("EW", "Edwards Lifesciences", "EW", "ew.us"),
                new("ELV", "Elevance Health", "ELV", "elv.us"),
                new("EME", "Emcor", "EME", "eme.us"),
                new("EMR", "Emerson Electric", "EMR", "emr.us"),
                new("ETR", "Entergy", "ETR", "etr.us"),
                new("EOG", "EOG Resources", "EOG", "eog.us"),
                new("EQT", "EQT Corporation", "EQT", "eqt.us"),
                new("EFX", "Equifax", "EFX", "efx.us"),
                new("EQIX", "Equinix", "EQIX", "eqix.us"),
                new("ERIE", "Erie Indemnity", "ERIE", "erie.us"),
                new("ESS", "Essex Property Trust", "ESS", "ess.us"),
                new("EL", "Estée Lauder Companies (The)", "EL", "el.us"),
                new("EG", "Everest Group", "EG", "eg.us"),
                new("EVRG", "Evergy", "EVRG", "evrg.us"),
                new("ES", "Eversource Energy", "ES", "es.us"),
                new("EXC", "Exelon", "EXC", "exc.us"),
                new("EXE", "Expand Energy", "EXE", "exe.us"),
                new("EXPE", "Expedia Group", "EXPE", "expe.us"),
                new("EXPD", "Expeditors International", "EXPD", "expd.us"),
                new("EXR", "Extra Space Storage", "EXR", "exr.us"),
                new("FFIV", "F5, Inc.", "FFIV", "ffiv.us"),
                new("FDS", "FactSet", "FDS", "fds.us"),
                new("FICO", "Fair Isaac", "FICO", "fico.us"),
                new("FAST", "Fastenal", "FAST", "fast.us"),
                new("FRT", "Federal Realty Investment Trust", "FRT", "frt.us"),
                new("FDX", "FedEx", "FDX", "fdx.us"),
                new("FDXF", "FedEx Freight", "FDXF", "fdxf.us"),
                new("FERG", "Ferguson Enterprises", "FERG", "ferg.us"),
                new("FIS", "Fidelity National Information Services", "FIS", "fis.us"),
                new("FITB", "Fifth Third Bancorp", "FITB", "fitb.us"),
                new("FSLR", "First Solar", "FSLR", "fslr.us"),
                new("FE", "FirstEnergy", "FE", "fe.us"),
                new("FISV", "Fiserv", "FISV", "fisv.us"),
                new("FLEX", "Flex Ltd.", "FLEX", "flex.us"),
                new("F", "Ford Motor Company", "F", "f.us"),
                new("FTNT", "Fortinet", "FTNT", "ftnt.us"),
                new("FTV", "Fortive", "FTV", "ftv.us"),
                new("FOXA", "Fox Corporation (Class A)", "FOXA", "foxa.us"),
                new("FOX", "Fox Corporation (Class B)", "FOX", "fox.us"),
                new("BEN", "Franklin Resources", "BEN", "ben.us"),
                new("FCX", "Freeport-McMoRan", "FCX", "fcx.us"),
                new("GRMN", "Garmin", "GRMN", "grmn.us"),
                new("IT", "Gartner", "IT", "it.us"),
                new("GE", "GE Aerospace", "GE", "ge.us"),
                new("GEHC", "GE HealthCare", "GEHC", "gehc.us"),
                new("GEV", "GE Vernova", "GEV", "gev.us"),
                new("GEN", "Gen Digital", "GEN", "gen.us"),
                new("GNRC", "Generac", "GNRC", "gnrc.us"),
                new("GD", "General Dynamics", "GD", "gd.us"),
                new("GIS", "General Mills", "GIS", "gis.us"),
                new("GM", "General Motors", "GM", "gm.us"),
                new("GPC", "Genuine Parts Company", "GPC", "gpc.us"),
                new("GILD", "Gilead Sciences", "GILD", "gild.us"),
                new("GPN", "Global Payments", "GPN", "gpn.us"),
                new("GL", "Globe Life", "GL", "gl.us"),
                new("GDDY", "GoDaddy", "GDDY", "gddy.us"),
                new("HAL", "Halliburton", "HAL", "hal.us"),
                new("HIG", "Hartford (The)", "HIG", "hig.us"),
                new("HAS", "Hasbro", "HAS", "has.us"),
                new("HCA", "HCA Healthcare", "HCA", "hca.us"),
                new("DOC", "Healthpeak Properties", "DOC", "doc.us"),
                new("HSIC", "Henry Schein", "HSIC", "hsic.us"),
                new("HSY", "Hershey Company (The)", "HSY", "hsy.us"),
                new("HPE", "Hewlett Packard Enterprise", "HPE", "hpe.us"),
                new("HLT", "Hilton Worldwide", "HLT", "hlt.us"),
                new("HD", "Home Depot (The)", "HD", "hd.us"),
                new("HONA", "Honeywell Aerospace", "HONA", "hona.us"),
                new("HON", "Honeywell Technologies", "HON", "hon.us"),
                new("HRL", "Hormel Foods", "HRL", "hrl.us"),
                new("HST", "Host Hotels & Resorts", "HST", "hst.us"),
                new("HWM", "Howmet Aerospace", "HWM", "hwm.us"),
                new("HPQ", "HP Inc.", "HPQ", "hpq.us"),
                new("HUBB", "Hubbell Incorporated", "HUBB", "hubb.us"),
                new("HUM", "Humana", "HUM", "hum.us"),
                new("HBAN", "Huntington Bancshares", "HBAN", "hban.us"),
                new("HII", "Huntington Ingalls Industries", "HII", "hii.us"),
                new("IEX", "IDEX Corporation", "IEX", "iex.us"),
                new("IDXX", "Idexx Laboratories", "IDXX", "idxx.us"),
                new("ITW", "Illinois Tool Works", "ITW", "itw.us"),
                new("INCY", "Incyte", "INCY", "incy.us"),
                new("IR", "Ingersoll Rand", "IR", "ir.us"),
                new("PODD", "Insulet Corporation", "PODD", "podd.us"),
                new("IBKR", "Interactive Brokers", "IBKR", "ibkr.us"),
                new("ICE", "Intercontinental Exchange", "ICE", "ice.us"),
                new("IFF", "International Flavors & Fragrances", "IFF", "iff.us"),
                new("IP", "International Paper", "IP", "ip.us"),
                new("INTU", "Intuit", "INTU", "intu.us"),
                new("ISRG", "Intuitive Surgical", "ISRG", "isrg.us"),
                new("IVZ", "Invesco", "IVZ", "ivz.us"),
                new("INVH", "Invitation Homes", "INVH", "invh.us"),
                new("IQV", "IQVIA", "IQV", "iqv.us"),
                new("IRM", "Iron Mountain", "IRM", "irm.us"),
                new("JBHT", "J.B. Hunt", "JBHT", "jbht.us"),
                new("JBL", "Jabil", "JBL", "jbl.us"),
                new("JKHY", "Jack Henry & Associates", "JKHY", "jkhy.us"),
                new("J", "Jacobs Solutions", "J", "j.us"),
                new("JCI", "Johnson Controls", "JCI", "jci.us"),
                new("KVUE", "Kenvue", "KVUE", "kvue.us"),
                new("KDP", "Keurig Dr Pepper", "KDP", "kdp.us"),
                new("KEY", "KeyCorp", "KEY", "key.us"),
                new("KEYS", "Keysight Technologies", "KEYS", "keys.us"),
                new("KMB", "Kimberly-Clark", "KMB", "kmb.us"),
                new("KIM", "Kimco Realty", "KIM", "kim.us"),
                new("KMI", "Kinder Morgan", "KMI", "kmi.us"),
                new("KKR", "KKR & Co.", "KKR", "kkr.us"),
                new("KLAC", "KLA Corporation", "KLAC", "klac.us"),
                new("KHC", "Kraft Heinz", "KHC", "khc.us"),
                new("KR", "Kroger", "KR", "kr.us"),
                new("LHX", "L3Harris", "LHX", "lhx.us"),
                new("LH", "Labcorp", "LH", "lh.us"),
                new("LRCX", "Lam Research", "LRCX", "lrcx.us"),
                new("LVS", "Las Vegas Sands", "LVS", "lvs.us"),
                new("LDOS", "Leidos", "LDOS", "ldos.us"),
                new("LEN", "Lennar", "LEN", "len.us"),
                new("LII", "Lennox International", "LII", "lii.us"),
                new("LIN", "Linde plc", "LIN", "lin.us"),
                new("LYV", "Live Nation Entertainment", "LYV", "lyv.us"),
                new("LMT", "Lockheed Martin", "LMT", "lmt.us"),
                new("L", "Loews Corporation", "L", "l.us"),
                new("LOW", "Lowe's", "LOW", "low.us"),
                new("LULU", "Lululemon Athletica", "LULU", "lulu.us"),
                new("LITE", "Lumentum", "LITE", "lite.us"),
                new("LYB", "LyondellBasell", "LYB", "lyb.us"),
                new("MTB", "M&T Bank", "MTB", "mtb.us"),
                new("MPC", "Marathon Petroleum", "MPC", "mpc.us"),
                new("MAR", "Marriott International", "MAR", "mar.us"),
                new("MRSH", "Marsh McLennan", "MRSH", "mrsh.us"),
                new("MLM", "Martin Marietta Materials", "MLM", "mlm.us"),
                new("MRVL", "Marvell Technology", "MRVL", "mrvl.us"),
                new("MAS", "Masco", "MAS", "mas.us"),
                new("MKC", "McCormick & Company", "MKC", "mkc.us"),
                new("MCK", "McKesson Corporation", "MCK", "mck.us"),
                new("MDT", "Medtronic", "MDT", "mdt.us"),
                new("MRK", "Merck & Co.", "MRK", "mrk.us"),
                new("MET", "MetLife", "MET", "met.us"),
                new("MTD", "Mettler Toledo", "MTD", "mtd.us"),
                new("MGM", "MGM Resorts", "MGM", "mgm.us"),
                new("MCHP", "Microchip Technology", "MCHP", "mchp.us"),
                new("MAA", "Mid-America Apartment Communities", "MAA", "maa.us"),
                new("MRNA", "Moderna", "MRNA", "mrna.us"),
                new("TAP", "Molson Coors Beverage Company", "TAP", "tap.us"),
                new("MDLZ", "Mondelez International", "MDLZ", "mdlz.us"),
                new("MPWR", "Monolithic Power Systems", "MPWR", "mpwr.us"),
                new("MNST", "Monster Beverage", "MNST", "mnst.us"),
                new("MCO", "Moody's Corporation", "MCO", "mco.us"),
                new("MS", "Morgan Stanley", "MS", "ms.us"),
                new("MOS", "Mosaic Company (The)", "MOS", "mos.us"),
                new("MSI", "Motorola Solutions", "MSI", "msi.us"),
                new("MSCI", "MSCI", "MSCI", "msci.us"),
                new("NDAQ", "Nasdaq, Inc.", "NDAQ", "ndaq.us"),
                new("NTAP", "NetApp", "NTAP", "ntap.us"),
                new("NEM", "Newmont", "NEM", "nem.us"),
                new("NWSA", "News Corp (Class A)", "NWSA", "nwsa.us"),
                new("NWS", "News Corp (Class B)", "NWS", "nws.us"),
                new("NEE", "NextEra Energy", "NEE", "nee.us"),
                new("NKE", "Nike, Inc.", "NKE", "nke.us"),
                new("NI", "NiSource", "NI", "ni.us"),
                new("NDSN", "Nordson Corporation", "NDSN", "ndsn.us"),
                new("NSC", "Norfolk Southern", "NSC", "nsc.us"),
                new("NTRS", "Northern Trust", "NTRS", "ntrs.us"),
                new("NOC", "Northrop Grumman", "NOC", "noc.us"),
                new("NCLH", "Norwegian Cruise Line Holdings", "NCLH", "nclh.us"),
                new("NRG", "NRG Energy", "NRG", "nrg.us"),
                new("NUE", "Nucor", "NUE", "nue.us"),
                new("NVR", "NVR, Inc.", "NVR", "nvr.us"),
                new("NXPI", "NXP Semiconductors", "NXPI", "nxpi.us"),
                new("ORLY", "O'Reilly Automotive", "ORLY", "orly.us"),
                new("OXY", "Occidental Petroleum", "OXY", "oxy.us"),
                new("ODFL", "Old Dominion", "ODFL", "odfl.us"),
                new("OMC", "Omnicom Group", "OMC", "omc.us"),
                new("ON", "ON Semiconductor", "ON", "on.us"),
                new("OKE", "Oneok", "OKE", "oke.us"),
                new("OTIS", "Otis Worldwide", "OTIS", "otis.us"),
                new("PCAR", "Paccar", "PCAR", "pcar.us"),
                new("PKG", "Packaging Corporation of America", "PKG", "pkg.us"),
                new("PSKY", "Paramount Skydance Corporation", "PSKY", "psky.us"),
                new("PH", "Parker Hannifin", "PH", "ph.us"),
                new("PAYX", "Paychex", "PAYX", "payx.us"),
                new("PYPL", "PayPal", "PYPL", "pypl.us"),
                new("PNR", "Pentair", "PNR", "pnr.us"),
                new("PEP", "PepsiCo", "PEP", "pep.us"),
                new("PCG", "PG&E Corporation", "PCG", "pcg.us"),
                new("PM", "Philip Morris International", "PM", "pm.us"),
                new("PSX", "Phillips 66", "PSX", "psx.us"),
                new("PNW", "Pinnacle West Capital", "PNW", "pnw.us"),
                new("PNC", "PNC Financial Services", "PNC", "pnc.us"),
                new("PPG", "PPG Industries", "PPG", "ppg.us"),
                new("PPL", "PPL Corporation", "PPL", "ppl.us"),
                new("PFG", "Principal Financial Group", "PFG", "pfg.us"),
                new("PG", "Procter & Gamble", "PG", "pg.us"),
                new("PGR", "Progressive Corporation", "PGR", "pgr.us"),
                new("PLD", "Prologis", "PLD", "pld.us"),
                new("PRU", "Prudential Financial", "PRU", "pru.us"),
                new("PEG", "Public Service Enterprise Group", "PEG", "peg.us"),
                new("PTC", "PTC Inc.", "PTC", "ptc.us"),
                new("PSA", "Public Storage", "PSA", "psa.us"),
                new("PHM", "PulteGroup", "PHM", "phm.us"),
                new("PWR", "Quanta Services", "PWR", "pwr.us"),
                new("DGX", "Quest Diagnostics", "DGX", "dgx.us"),
                new("Q", "Qnity Electronics", "Q", "q.us"),
                new("RL", "Ralph Lauren Corporation", "RL", "rl.us"),
                new("RJF", "Raymond James Financial", "RJF", "rjf.us"),
                new("RDDT", "Reddit", "RDDT", "rddt.us"),
                new("RTX", "RTX Corporation", "RTX", "rtx.us"),
                new("O", "Realty Income", "O", "o.us"),
                new("REG", "Regency Centers", "REG", "reg.us"),
                new("REGN", "Regeneron Pharmaceuticals", "REGN", "regn.us"),
                new("RF", "Regions Financial Corporation", "RF", "rf.us"),
                new("RSG", "Republic Services", "RSG", "rsg.us"),
                new("RMD", "ResMed", "RMD", "rmd.us"),
                new("RVTY", "Revvity", "RVTY", "rvty.us"),
                new("HOOD", "Robinhood Markets", "HOOD", "hood.us"),
                new("ROK", "Rockwell Automation", "ROK", "rok.us"),
                new("ROL", "Rollins, Inc.", "ROL", "rol.us"),
                new("ROP", "Roper Technologies", "ROP", "rop.us"),
                new("ROST", "Ross Stores", "ROST", "rost.us"),
                new("RCL", "Royal Caribbean Group", "RCL", "rcl.us"),
                new("SPGI", "S&P Global", "SPGI", "spgi.us"),
                new("SNDK", "Sandisk", "SNDK", "sndk.us"),
                new("SBAC", "SBA Communications", "SBAC", "sbac.us"),
                new("SLB", "Schlumberger", "SLB", "slb.us"),
                new("STX", "Seagate Technology", "STX", "stx.us"),
        ];

        var duplicateKey = assets.GroupBy(asset => asset.Key).FirstOrDefault(group => group.Count() > 1);
        if (duplicateKey is not null)
        {
            throw new InvalidOperationException($"Duplicate seasonality asset key: {duplicateKey.Key}");
        }

        if (assets.Length != 526)
        {
            throw new InvalidOperationException($"Expected 526 seasonality assets, got {assets.Length}.");
        }

        return assets;
    }

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SeasonalityService> _logger;
    private readonly SeasonalityDbContext? _context;

    public SeasonalityService(IHttpClientFactory httpClientFactory, ILogger<SeasonalityService> logger)
        : this(httpClientFactory, logger, null)
    {
    }

    public SeasonalityService(IHttpClientFactory httpClientFactory, ILogger<SeasonalityService> logger, SeasonalityDbContext? context)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _context = context;
    }

    public async Task<SeasonalityViewModel> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_context is not null)
        {
            return new SeasonalityViewModel { Assets = Assets, Prices = await LoadAllCachedPricesAsync(cancellationToken) };
        }

        return await DownloadAsync(cancellationToken);
    }

    public Task<SeasonalityViewModel> LoadCachedAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new SeasonalityViewModel
        {
            Assets = Assets,
            Prices = new Dictionary<string, IReadOnlyList<SeasonalityPrice>>()
        });
    }

    public Task UpdateAsync(CancellationToken cancellationToken = default)
        => UpdateAsync(cancellationToken, onlyMissing: false);

    public async Task UpdateMissingAsync(CancellationToken cancellationToken = default)
    {
        if (_context is null) throw new InvalidOperationException("Seasonality database context is not configured.");

        var cachedKeys = await _context.SeasonalityPrices
            .AsNoTracking()
            .Select(item => item.AssetKey)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (Assets.All(asset => cachedKeys.Contains(asset.Key, StringComparer.OrdinalIgnoreCase)))
            return;

        await UpdateAsync(cancellationToken, onlyMissing: true);
    }

    private async Task UpdateAsync(CancellationToken cancellationToken, bool onlyMissing)
    {
        if (_context is null) throw new InvalidOperationException("Seasonality database context is not configured.");
        await UpdateGate.WaitAsync(cancellationToken);
        try
        {
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("TradingJournal-Seasonality/1.0");
        var cachedKeys = onlyMissing
            ? await _context.SeasonalityPrices.AsNoTracking().Select(item => item.AssetKey).Distinct().ToListAsync(cancellationToken)
            : [];
        var pendingAssets = Assets.Where(asset => !onlyMissing || !cachedKeys.Contains(asset.Key, StringComparer.OrdinalIgnoreCase)).ToArray();
        var processedAssets = 0;
        foreach (var asset in pendingAssets)
        {
            var current = ++processedAssets;
            var percent = (int)Math.Round(current * 100d / pendingAssets.Length);
            _logger.LogInformation("Sezonalita {Index}/{Total} ({Percent}%): {Ticker}", current, pendingAssets.Length, percent, asset.Key);
            var cached = await _context.SeasonalityPrices
                .Where(item => item.AssetKey == asset.Key)
                .ToDictionaryAsync(item => item.Date, cancellationToken);
            var period1 = cached.Count == 0
                ? 0
                : new DateTimeOffset(cached.Keys.Max().ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).AddDays(-1).ToUnixTimeSeconds();
            try
            {
                var yahoo = await client.GetStringAsync(
                    $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(asset.YahooSymbol)}?period1={period1}&period2={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}&interval=1d&events=history",
                    cancellationToken);
                await UpsertAsync(asset.Key, "Yahoo", ParseYahoo(yahoo), cached, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Yahoo seasonality data load failed for {Asset}; trying Stooq.", asset.Key);
                try
                {
                    var csv = await client.GetStringAsync($"https://stooq.com/q/d/l/?s={asset.StooqSymbol}&i=d", cancellationToken);
                    await UpsertAsync(asset.Key, "Stooq", ParseStooq(csv), cached, cancellationToken);
                }
                catch (Exception fallbackException)
                {
                    _logger.LogError(fallbackException, "Seasonality data load failed for {Asset}.", asset.Key);
                }
            }
        }

        await _context.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            UpdateGate.Release();
        }
    }

    private async Task<SeasonalityViewModel> DownloadAsync(CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("TradingJournal-Seasonality/1.0");
        var prices = new Dictionary<string, IReadOnlyList<SeasonalityPrice>>();
        foreach (var asset in Assets)
        {
            try
            {
                var yahoo = await client.GetStringAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(asset.YahooSymbol)}?period1=0&period2={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}&interval=1d&events=history", cancellationToken);
                prices[asset.Key] = ParseYahoo(yahoo);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Yahoo seasonality data load failed for {Asset}; trying Stooq.", asset.Key);
                try
                {
                    var csv = await client.GetStringAsync($"https://stooq.com/q/d/l/?s={asset.StooqSymbol}&i=d", cancellationToken);
                    prices[asset.Key] = ParseStooq(csv);
                }
                catch (Exception fallbackException)
                {
                    _logger.LogError(fallbackException, "Seasonality data load failed for {Asset}.", asset.Key);
                    prices[asset.Key] = [];
                }
            }
        }
        return new SeasonalityViewModel { Assets = Assets, Prices = prices };
    }

    public async Task<IReadOnlyList<SeasonalityPrice>> LoadCachedPricesAsync(string assetKey, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(assetKey))
        {
            return [];
        }
        if (_context is null) return [];

        return await _context.SeasonalityPrices
            .AsNoTracking()
            .Where(item => item.AssetKey == assetKey)
            .OrderBy(item => item.Date)
            .Select(item => new SeasonalityPrice(item.Date, item.Close))
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyDictionary<string, IReadOnlyList<SeasonalityPrice>>> LoadAllCachedPricesAsync(CancellationToken cancellationToken)
    {
        var rows = await _context!.SeasonalityPrices.AsNoTracking().OrderBy(item => item.Date).ToListAsync(cancellationToken);
        return rows.GroupBy(item => item.AssetKey).ToDictionary(
            group => group.Key,
            group => (IReadOnlyList<SeasonalityPrice>)group.Select(item => new SeasonalityPrice(item.Date, item.Close)).ToList());
    }

    private async Task UpsertAsync(string assetKey, string source, IReadOnlyList<SeasonalityPrice> prices, Dictionary<DateOnly, SeasonalityPriceEntity> cached, CancellationToken cancellationToken)
    {
        var added = 0;
        var skipped = 0;
        foreach (var price in prices.DistinctBy(price => price.Date))
        {
            if (cached.ContainsKey(price.Date))
            {
                skipped++;
                continue;
            }

            _context!.SeasonalityPrices.Add(new SeasonalityPriceEntity
            {
                AssetKey = assetKey,
                Date = price.Date,
                Close = price.Close,
                Source = source,
                UpdatedAt = DateTimeOffset.UtcNow
            });
            cached[price.Date] = new SeasonalityPriceEntity { AssetKey = assetKey, Date = price.Date };
            added++;
        }
        int changes;
        try
        {
            changes = await _context!.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2601 or 2627 })
        {
            foreach (var entry in _context!.ChangeTracker.Entries<SeasonalityPriceEntity>().Where(entry => entry.State == EntityState.Added))
                entry.State = EntityState.Detached;
            _logger.LogWarning(ex, "Sezonalita {Ticker}: paralelní běh už vložil část dat; duplicitní řádky byly přeskočeny.", assetKey);
            changes = 0;
        }
        _logger.LogInformation("Sezonalita {Ticker}: přijato {Received} cen od {Source}, nové {Added}, přeskočeno {Skipped}, uloženo {Changes} změn.", assetKey, prices.Count, source, added, skipped, changes);
    }

    public static IReadOnlyList<SeasonalityPrice> ParseStooq(string csv)
    {
        var result = new List<SeasonalityPrice>();
        foreach (var line in csv.Split('\n', StringSplitOptions.RemoveEmptyEntries).Skip(1))
        {
            var fields = line.Trim().Split(',');
            if (fields.Length < 5 || !DateOnly.TryParse(fields[0], CultureInfo.InvariantCulture, out var date) ||
                !decimal.TryParse(fields[4], NumberStyles.Any, CultureInfo.InvariantCulture, out var close))
                continue;
            result.Add(new SeasonalityPrice(date, close));
        }
        return result.OrderBy(item => item.Date).ToList();
    }

    public static IReadOnlyList<SeasonalityPrice> ParseYahoo(string json)
    {
        using var document = JsonDocument.Parse(json);
        var result = new List<SeasonalityPrice>();
        var chart = document.RootElement.GetProperty("chart").GetProperty("result")[0];
        var timestamps = chart.GetProperty("timestamp");
        var closes = chart.GetProperty("indicators").GetProperty("quote")[0].GetProperty("close");
        for (var index = 0; index < timestamps.GetArrayLength(); index++)
        {
            if (timestamps[index].ValueKind != JsonValueKind.Number || closes[index].ValueKind is JsonValueKind.Null)
                continue;
            result.Add(new SeasonalityPrice(
                DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(timestamps[index].GetInt64()).UtcDateTime),
                closes[index].GetDecimal()));
        }
        return result.Where(item => item.Close > 0).DistinctBy(item => item.Date).OrderBy(item => item.Date).ToList();
    }
}

