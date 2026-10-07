using Microsoft.EntityFrameworkCore;
using TradingJournal.Models;

namespace TradingJournal.Data;

public sealed class SeasonalityDbContext(DbContextOptions<SeasonalityDbContext> options) : DbContext(options)
{
    public DbSet<SeasonalityPriceEntity> SeasonalityPrices => Set<SeasonalityPriceEntity>();
    public DbSet<CotReportEntity> CotReports => Set<CotReportEntity>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.Entity<CotReportEntity>(entity =>
        {
            entity.HasKey(x => new { x.ContractCode, x.ReportDate });
            entity.Property(x => x.ContractCode).HasMaxLength(6).IsRequired();
        });
        builder.Entity<SeasonalityPriceEntity>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.AssetKey, x.Date }).IsUnique();
            entity.Property(x => x.AssetKey).HasMaxLength(32).IsRequired();
            entity.Property(x => x.Source).HasMaxLength(40).IsRequired();
            entity.Property(x => x.Close).HasPrecision(20, 8);
        });
    }

    // EnsureCreated does not add tables to an existing Seasonality database.
    // Serialize this additive initialization across the web and update processes.
    public async Task EnsureCotSchemaAsync(CancellationToken ct = default)
    {
        var strategy = Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await Database.BeginTransactionAsync(ct);
            await Database.ExecuteSqlRawAsync("""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock @Resource = N'SeasonalityApp.CotSchema',
                    @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
                IF @result < 0 THROW 50001, 'Could not acquire COT schema lock.', 1;
                IF OBJECT_ID(N'[dbo].[CotReports]', N'U') IS NULL
                BEGIN
                    CREATE TABLE [dbo].[CotReports] (
                        [ContractCode] nvarchar(6) NOT NULL,
                        [ReportDate] date NOT NULL,
                        [OpenInterest] bigint NOT NULL,
                        [CommercialLong] bigint NOT NULL,
                        [CommercialShort] bigint NOT NULL,
                        [NonCommercialLong] bigint NOT NULL,
                        [NonCommercialShort] bigint NOT NULL,
                        [NonCommercialSpread] bigint NOT NULL,
                        [NonReportableLong] bigint NOT NULL,
                        [NonReportableShort] bigint NOT NULL,
                        [UpdatedAt] datetimeoffset NOT NULL,
                        CONSTRAINT [PK_CotReports] PRIMARY KEY ([ContractCode], [ReportDate])
                    );
                END
                """, ct);
            await transaction.CommitAsync(ct);
        });
    }
}
