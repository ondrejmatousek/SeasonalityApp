using Microsoft.AspNetCore.Mvc;

namespace SeasonalityApp.Controllers;

public sealed class DataController : Controller
{
    [HttpGet("/runs/")]
    public IActionResult Index() => View();
    [HttpGet("/strategy-lab/")]
    public IActionResult StrategyLab() => View();
    [HttpGet("/daily-outlook/")]
    public IActionResult FmOutlook() => View();
}
