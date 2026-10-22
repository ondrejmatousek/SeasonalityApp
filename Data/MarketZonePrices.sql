-- Additive zone-only data. No writes to canonical D1, COT or market_h4 history.
IF SCHEMA_ID('market_zones') IS NULL EXEC('CREATE SCHEMA market_zones');
IF OBJECT_ID('market_zones.Receipts') IS NULL
CREATE TABLE market_zones.Receipts (
 ReceiptId char(64) NOT NULL PRIMARY KEY, PayloadUtf8 varbinary(max) NOT NULL,
 ReceivedAt datetimeoffset NOT NULL, Status varchar(24) NOT NULL,
 InsertedBars int NOT NULL, DuplicateBars int NOT NULL, ExcludedBars int NOT NULL,
 VolumeAudit nvarchar(max) NOT NULL
);
IF OBJECT_ID('market_zones.Bars') IS NULL
CREATE TABLE market_zones.Bars (
 Symbol varchar(32) NOT NULL, Interval varchar(4) NOT NULL, StartUnix bigint NOT NULL,
 [Open] decimal(28,10) NOT NULL, [High] decimal(28,10) NOT NULL,
 [Low] decimal(28,10) NOT NULL, [Close] decimal(28,10) NOT NULL, Volume decimal(28,10) NULL,
 ReceiptId char(64) NOT NULL REFERENCES market_zones.Receipts(ReceiptId),
 CONSTRAINT PK_market_zones_Bars PRIMARY KEY(Symbol,Interval,StartUnix)
);
-- Operator-only historical reconstruction keeps actual SQL ReceivedAt separate
-- from the original provider validation time. MCP submissions never set this.
IF COL_LENGTH('market_zones.Receipts','RecoveryValidatedAt') IS NULL
 ALTER TABLE market_zones.Receipts ADD RecoveryValidatedAt datetimeoffset NULL;
