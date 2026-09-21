using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using TradingJournal.Data;
using TradingJournal.Services;
using SeasonalityApp.Controllers;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
var connection = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is required.");

builder.Services.AddDbContext<SeasonalityDbContext>(options => options.UseSqlServer(connection));
builder.Services.AddHttpClient();
builder.Services.AddSingleton<TursoSeasonalityStore>();
builder.Services.AddScoped<SeasonalityService>();
builder.Services.AddSingleton<SeasonalityUpdateState>();
builder.Services.AddHostedService<SeasonalityUpdateHostedService>();
builder.Services.AddControllersWithViews().ConfigureApplicationPartManager(parts =>
{
    foreach (var part in parts.ApplicationParts.OfType<AssemblyPart>().Where(part => part.Assembly != typeof(SeasonalityController).Assembly).ToList())
        parts.ApplicationParts.Remove(part);
});

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SeasonalityDbContext>();
    await db.Database.EnsureCreatedAsync();
    if (args.Contains("--update-once", StringComparer.OrdinalIgnoreCase))
    {
        await scope.ServiceProvider.GetRequiredService<SeasonalityService>().UpdateAsync();
        return;
    }
}
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler("/Home/Error");
app.UseStaticFiles();
app.UseRouting();
app.MapControllerRoute("default", "{controller=Seasonality}/{action=Index}/{id?}");
app.Run();
