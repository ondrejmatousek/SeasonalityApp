using Microsoft.EntityFrameworkCore;
using TradingJournal.Models;

namespace TradingJournal.Data;

public sealed class SeasonalityDbContext(DbContextOptions<SeasonalityDbContext> options) : DbContext(options)
{
    public DbSet<SeasonalityPriceEntity> SeasonalityPrices => Set<SeasonalityPriceEntity>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.Entity<SeasonalityPriceEntity>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.AssetKey, x.Date }).IsUnique();
            entity.Property(x => x.AssetKey).HasMaxLength(32).IsRequired();
            entity.Property(x => x.Source).HasMaxLength(40).IsRequired();
            entity.Property(x => x.Close).HasPrecision(20, 8);
        });
    }
}
