-- Explicit additive migration. NEVER run automatically during web startup.
-- Raw quarantine inbox only: not SeasonalityPrices, COT, or canonical market history.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock = sys.sp_getapplock @Resource=N'Seasonality.MarketDailyInbox.Schema.v1',
    @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=30000;
IF @lock < 0 THROW 50001, 'Inbox schema lock unavailable', 1;
IF SCHEMA_ID(N'market_daily') IS NULL EXEC(N'CREATE SCHEMA market_daily');
IF OBJECT_ID(N'market_daily.Inbox', N'U') IS NULL
BEGIN
    CREATE TABLE market_daily.Inbox (
        Sequence bigint IDENTITY(1,1) NOT NULL,
        ReceiptId char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PayloadSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        AuditSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        DailyUtf8 varbinary(max) NOT NULL,
        AuditUtf8 varbinary(max) NOT NULL,
        FetchedAt datetimeoffset(7) NOT NULL,
        ReceivedAt datetimeoffset(7) NOT NULL CONSTRAINT DF_MarketInbox_ReceivedAt DEFAULT SYSDATETIMEOFFSET(),
        Status varchar(24) NOT NULL CONSTRAINT DF_MarketInbox_Status DEFAULT 'PendingValidation',
        Attempts int NOT NULL CONSTRAINT DF_MarketInbox_Attempts DEFAULT 0,
        LeaseId uniqueidentifier NULL,
        LeaseUntil datetimeoffset(7) NULL,
        LastErrorCode varchar(64) NULL,
        CONSTRAINT PK_MarketInbox PRIMARY KEY (ReceiptId),
        CONSTRAINT UQ_MarketInbox_Sequence UNIQUE (Sequence),
        CONSTRAINT UQ_MarketInbox_Pair UNIQUE (PayloadSha256, AuditSha256),
        CONSTRAINT CK_MarketInbox_Bytes CHECK (DATALENGTH(DailyUtf8) BETWEEN 1 AND 262144 AND DATALENGTH(AuditUtf8) BETWEEN 1 AND 262144),
        CONSTRAINT CK_MarketInbox_Status CHECK (Status IN ('PendingValidation', 'Processing', 'Blocked')),
        CONSTRAINT CK_MarketInbox_Attempts CHECK (Attempts >= 0),
        CONSTRAINT CK_MarketInbox_Lease CHECK (
            (Status='Processing' AND LeaseId IS NOT NULL AND LeaseUntil IS NOT NULL) OR
            (Status<>'Processing' AND LeaseId IS NULL AND LeaseUntil IS NULL))
    );
    CREATE INDEX IX_MarketInbox_Queue ON market_daily.Inbox (Status, Sequence) INCLUDE (LeaseUntil);
END;
COMMIT;
