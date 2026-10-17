-- Additive, isolated from D1/COT and the immutable historical H4 import.
IF SCHEMA_ID('market_h4') IS NULL EXEC('CREATE SCHEMA market_h4');
IF OBJECT_ID('market_h4.LiveReceipts','U') IS NULL
CREATE TABLE market_h4.LiveReceipts(
 ReceiptId char(64) NOT NULL PRIMARY KEY,
 PayloadUtf8 varbinary(max) NOT NULL,
 ReceivedAt datetimeoffset(7) NOT NULL,
 InsertedBars int NOT NULL,
 DuplicateBars int NOT NULL,
 ExcludedBars int NOT NULL,
 Status varchar(24) NOT NULL CHECK(Status IN ('Accepted','Conflict')));
IF OBJECT_ID('market_h4.LiveBars','U') IS NULL
CREATE TABLE market_h4.LiveBars(
 Symbol varchar(32) NOT NULL, StartUnix bigint NOT NULL,
 [Open] decimal(28,10) NOT NULL, [High] decimal(28,10) NOT NULL,
 [Low] decimal(28,10) NOT NULL, [Close] decimal(28,10) NOT NULL,
 Volume decimal(28,10) NULL,
 ReceiptId char(64) NOT NULL REFERENCES market_h4.LiveReceipts(ReceiptId),
 PRIMARY KEY(Symbol,StartUnix),
 CHECK([Low]>0 AND [Open]>0 AND [Close]>0 AND [High]>=[Open] AND [High]>=[Close] AND [Low]<=[Open] AND [Low]<=[Close]),
 CHECK(Volume IS NULL OR Volume>=0));
