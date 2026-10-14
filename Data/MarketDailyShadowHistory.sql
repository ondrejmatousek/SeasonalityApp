-- Explicit stage-2 migration. Shadow state only; no live price routing or stock/COT changes.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock = sys.sp_getapplock @Resource=N'Seasonality.MarketDailyInbox.Schema.v1',
    @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=30000;
IF @lock < 0 THROW 50001, 'Inbox schema lock unavailable', 1;
IF OBJECT_ID(N'market_daily.Inbox',N'U') IS NULL THROW 50002, 'Apply MarketDailyInbox.sql first', 1;
IF COL_LENGTH('market_daily.Inbox','ValidationReportUtf8') IS NULL
    ALTER TABLE market_daily.Inbox ADD ValidationReportUtf8 varbinary(max) NULL;
IF OBJECT_ID(N'market_daily.ShadowHistory',N'U') IS NULL
BEGIN
    CREATE TABLE market_daily.ShadowHistory (
        GenerationId bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_MarketShadowHistory PRIMARY KEY,
        ReceiptId char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        BaselineFingerprint char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        StateSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        StateUtf8 varbinary(max) NOT NULL,
        ReportUtf8 varbinary(max) NOT NULL,
        CreatedAt datetimeoffset(7) NOT NULL CONSTRAINT DF_MarketShadowHistory_Created DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT FK_MarketShadowHistory_Receipt FOREIGN KEY (ReceiptId) REFERENCES market_daily.Inbox(ReceiptId),
        CONSTRAINT UQ_MarketShadowHistory_Receipt UNIQUE (ReceiptId),
        CONSTRAINT CK_MarketShadowHistory_Bytes CHECK (DATALENGTH(StateUtf8) BETWEEN 1 AND 67108864 AND DATALENGTH(ReportUtf8) BETWEEN 1 AND 262144)
    );
END;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CK_MarketInbox_Status' AND parent_object_id=OBJECT_ID(N'market_daily.Inbox'))
    ALTER TABLE market_daily.Inbox DROP CONSTRAINT CK_MarketInbox_Status;
ALTER TABLE market_daily.Inbox WITH CHECK ADD CONSTRAINT CK_MarketInbox_Status
    CHECK (Status IN ('PendingValidation','Processing','Blocked','ShadowAccepted'));
COMMIT;
