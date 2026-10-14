using Microsoft.AspNetCore.Mvc;

namespace SeasonalityApp.Controllers;

public sealed class DataController : Controller
{
    [HttpGet("/runs/")]
    public IActionResult Index() => View();
}
