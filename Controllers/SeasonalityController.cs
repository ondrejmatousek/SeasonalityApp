using Microsoft.AspNetCore.Mvc;
using TradingJournal.Services;
using SeasonalityApp.ViewModels;

namespace SeasonalityApp.Controllers;

public sealed class SeasonalityController(SeasonalityService service, SeasonalityUpdateState state) : Controller
{
    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var model = await service.LoadCachedAsync(ct);
        return View(new SeasonalityViewModel { Assets = model.Assets, Prices = model.Prices, IsUpdating = state.IsRunning });
    }

    [HttpGet]
    public async Task<IActionResult> Data(string? assetKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(assetKey)) return BadRequest(new { message = "Missing assetKey." });
        var asset = SeasonalityService.Assets.FirstOrDefault(x => string.Equals(x.Key, assetKey, StringComparison.OrdinalIgnoreCase));
        if (asset is null) return NotFound(new { message = "Unknown asset." });
        var prices = await service.LoadCachedPricesAsync(asset.Key, ct);
        return Json(new { assetKey = asset.Key, prices = prices.Select(x => new { date = x.Date.ToString("yyyy-MM-dd"), close = x.Close }), isUpdating = state.IsRunning, error = state.LastError });
    }
}
