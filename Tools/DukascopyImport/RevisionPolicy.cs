// Provider corrections are audit evidence. Published bars retain their first observation.
internal static class RevisionPolicy
{
    public const string Schema = """
            IF SCHEMA_ID('dukascopy') IS NULL EXEC('CREATE SCHEMA dukascopy');
            IF OBJECT_ID('dukascopy.Collections','U') IS NULL CREATE TABLE dukascopy.Collections(
                Id char(64) PRIMARY KEY,ObservedAt datetimeoffset NOT NULL,ReceivedAt datetimeoffset NOT NULL DEFAULT SYSUTCDATETIME(),CollectionUtf8 varbinary(max) NOT NULL);
            IF OBJECT_ID('dukascopy.Sources','U') IS NULL CREATE TABLE dukascopy.Sources(
                Sha256 char(64) PRIMARY KEY,PayloadUtf8 varbinary(max) NOT NULL);
            IF OBJECT_ID('dukascopy.Bars','U') IS NULL CREATE TABLE dukascopy.Bars(
                Symbol varchar(16) NOT NULL,Interval varchar(2) NOT NULL CHECK(Interval IN('H4','D1')),StartUnix bigint NOT NULL,
                [Open] decimal(28,10) NOT NULL,[High] decimal(28,10) NOT NULL,[Low] decimal(28,10) NOT NULL,[Close] decimal(28,10) NOT NULL,Volume decimal(28,10) NOT NULL,
                CollectionId char(64) NOT NULL REFERENCES dukascopy.Collections(Id),PRIMARY KEY(Symbol,Interval,StartUnix));
            IF OBJECT_ID('dukascopy.Revisions','U') IS NULL CREATE TABLE dukascopy.Revisions(
                CollectionId char(64) NOT NULL REFERENCES dukascopy.Collections(Id),
                Symbol varchar(16) NOT NULL,Interval varchar(2) NOT NULL,StartUnix bigint NOT NULL,
                OriginalCollectionId char(64) NOT NULL REFERENCES dukascopy.Collections(Id),
                OriginalOpen decimal(28,10) NOT NULL,OriginalHigh decimal(28,10) NOT NULL,OriginalLow decimal(28,10) NOT NULL,OriginalClose decimal(28,10) NOT NULL,OriginalVolume decimal(28,10) NOT NULL,
                RevisedOpen decimal(28,10) NOT NULL,RevisedHigh decimal(28,10) NOT NULL,RevisedLow decimal(28,10) NOT NULL,RevisedClose decimal(28,10) NOT NULL,RevisedVolume decimal(28,10) NOT NULL,
                RecordedAt datetimeoffset NOT NULL DEFAULT SYSUTCDATETIME(),
                PRIMARY KEY(CollectionId,Symbol,Interval,StartUnix),
                FOREIGN KEY(Symbol,Interval,StartUnix) REFERENCES dukascopy.Bars(Symbol,Interval,StartUnix));
            CREATE TABLE #Incoming(Symbol varchar(16),Interval varchar(2),StartUnix bigint,[Open] decimal(28,10),[High] decimal(28,10),[Low] decimal(28,10),[Close] decimal(28,10),Volume decimal(28,10),PRIMARY KEY(Symbol,Interval,StartUnix));

        """;
    public const string Commit = """
            DECLARE @lock int;
            EXEC @lock=sys.sp_getapplock @Resource='Dukascopy:Commit',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
            IF @lock<0 THROW 50001,'Dukascopy writer lock unavailable',1;
            IF NOT EXISTS(SELECT 1 FROM dukascopy.Collections WHERE Id=@id)
                INSERT dukascopy.Collections(Id,ObservedAt,CollectionUtf8) VALUES(@id,@observed,@bytes);
            DECLARE @observedRevisions int,@recordedRevisions int,@insertedBars int;
            SELECT @observedRevisions=COUNT(*) FROM #Incoming i
                JOIN dukascopy.Bars b ON b.Symbol=i.Symbol AND b.Interval=i.Interval AND b.StartUnix=i.StartUnix
                WHERE b.[Open]<>i.[Open] OR b.[High]<>i.[High] OR b.[Low]<>i.[Low] OR b.[Close]<>i.[Close];
            INSERT dukascopy.Revisions(CollectionId,Symbol,Interval,StartUnix,OriginalCollectionId,
                OriginalOpen,OriginalHigh,OriginalLow,OriginalClose,OriginalVolume,
                RevisedOpen,RevisedHigh,RevisedLow,RevisedClose,RevisedVolume)
            SELECT @id,b.Symbol,b.Interval,b.StartUnix,b.CollectionId,
                b.[Open],b.[High],b.[Low],b.[Close],b.Volume,i.[Open],i.[High],i.[Low],i.[Close],i.Volume
            FROM #Incoming i JOIN dukascopy.Bars b ON b.Symbol=i.Symbol AND b.Interval=i.Interval AND b.StartUnix=i.StartUnix
            WHERE (b.[Open]<>i.[Open] OR b.[High]<>i.[High] OR b.[Low]<>i.[Low] OR b.[Close]<>i.[Close])
                AND NOT EXISTS(SELECT 1 FROM dukascopy.Revisions r WHERE r.CollectionId=@id AND r.Symbol=i.Symbol AND r.Interval=i.Interval AND r.StartUnix=i.StartUnix);
            SET @recordedRevisions=@@ROWCOUNT;
            INSERT dukascopy.Bars SELECT i.*,@id FROM #Incoming i WHERE NOT EXISTS(
                SELECT 1 FROM dukascopy.Bars b WHERE b.Symbol=i.Symbol AND b.Interval=i.Interval AND b.StartUnix=i.StartUnix);
            SET @insertedBars=@@ROWCOUNT;
            SELECT @insertedBars,@observedRevisions,@recordedRevisions;

        """;
}
