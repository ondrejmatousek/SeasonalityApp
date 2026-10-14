using System.Diagnostics;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

static class SqlPublicationChecks
{
    public static async Task RunAsync(MarketDailySqlInbox store,string connection)
    {
        void Check(bool ok,string label){if(!ok)throw new InvalidOperationException(label);}
        var head=await store.ReadPublicationSnapshotAsync()??throw new Exception("Accepted SQL generation required.");
        var directory=Path.GetFullPath(Path.Combine("artifacts","sql-publication-localdb-"+Guid.NewGuid().ToString("N")));
        try
        {
            var context=MarketDailySqlPublication.Export(head,Directory.GetCurrentDirectory(),directory,DateTimeOffset.UtcNow);
            MarketDailySqlPublication.CheckContext(head,context);
            Check(File.ReadAllBytes(Path.Combine(directory,"latest.json")).SequenceEqual(head.DailyUtf8),"Exact original daily bytes exported");
            await File.AppendAllTextAsync(Path.Combine(directory,"latest.json")," ");
            var rejected=false;
            try{MarketDailySqlPublication.CheckContext(head,context);}catch(InvalidDataException){rejected=true;}
            Check(rejected,"Changed staging rejected");await File.WriteAllBytesAsync(Path.Combine(directory,"latest.json"),head.DailyUtf8);
            var called=false;
            await store.WithPublicationFenceAsync(head,async()=>
            {
                called=true;
                await using var c=new SqlConnection(connection);await c.OpenAsync();
                await using var command=new SqlCommand("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'MarketDailyInbox:ShadowCommit',@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0; SELECT @r;",c);
                Check((int)(await command.ExecuteScalarAsync())!<0,"Generation cannot advance during fenced publication");
            });
            Check(called,"Exact SQL generation callback reached");called=false;rejected=false;
            try{await store.WithPublicationFenceAsync(head with {GenerationId=head.GenerationId+1},()=>{called=true;return Task.CompletedTask;});}
            catch(InvalidDataException){rejected=true;}
            Check(rejected&&!called,"Stale context refused before publication side effects");
            try{await store.WithPublicationFenceAsync(head,()=>throw new IOException("Owned simulated publication failure"));}
            catch(IOException){}
            await store.WithPublicationFenceAsync(head,()=>Task.CompletedTask);
            Check((await store.ReadPublicationSnapshotAsync())!.GenerationId==head.GenerationId,"Publication checks never mutate accepted history");
            var start=new ProcessStartInfo("node"){UseShellExecute=false,CreateNoWindow=true};
            start.ArgumentList.Add("-e");
            start.ArgumentList.Add("require('./Tools/market-daily-sql-publication.cjs').prepareSnapshot(process.argv[1]);console.log('PASS: real SQL export -> original 39-source Node admission parity')");
            start.ArgumentList.Add(context);
            using var node=Process.Start(start)!;await node.WaitForExitAsync();Check(node.ExitCode==0,"Node consumes exact real SQL snapshot");
            Console.WriteLine("PASS: real SQL publication export hashes, tamper rejection, latest-generation fencing, competing lock exclusion, failure release and no history/stock/COT/publication mutations.");
        }
        finally
        {
            if(Path.GetDirectoryName(directory)!=Path.GetFullPath("artifacts")||!Path.GetFileName(directory).StartsWith("sql-publication-localdb-"))throw new Exception("Unsafe owned fixture cleanup");
            if(Directory.Exists(directory))Directory.Delete(directory,true);
        }
    }
}
