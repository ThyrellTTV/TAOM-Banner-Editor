using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new StudioWindow());
    }
}

internal sealed class StudioWindow : Form
{
    private Process? _server;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(25,29,33) };
    private readonly Label _loading = new() { Dock = DockStyle.Fill, Text = "Preparing TAOM Banner Studio…", TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(209,174,117), BackColor = Color.FromArgb(25,29,33), Font = new Font("Segoe UI",16) };
    internal StudioWindow()
    {
        Text = "TAOM · Banner Studio";
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        MinimumSize = new Size(1080,760);
        Size = new Size(1520,1000);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(25,29,33);
        Controls.Add(_web); Controls.Add(_loading);
        Shown += async (_,_) => await StartAsync();
        FormClosed += (_,_) => { if(_server is {HasExited:false}) _server.Kill(entireProcessTree:true); _server?.Dispose(); };
    }
    private async Task StartAsync()
    {
        try
        {
            var folder = new DirectoryInfo(AppContext.BaseDirectory);
            while(folder != null && !File.Exists(Path.Combine(folder.FullName,"server.mjs"))) folder = folder.Parent;
            if(folder == null) throw new Exception("Could not find server.mjs beside the application folder.");
            var root = folder.FullName;
            var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(root,"config.json"))).RootElement;
            var port = config.GetProperty("port").GetInt32();
            var url = $"http://127.0.0.1:{port}";
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            async Task<bool> Ready()
            {
                try { var json = JsonDocument.Parse(await client.GetStringAsync(url+"/api/health")); return json.RootElement.GetProperty("app").GetString()=="taom-banner-editor"; }
                catch { return false; }
            }
            if(!await Ready())
            {
                Directory.CreateDirectory(Path.Combine(root,"logs"));
                var node = new ProcessStartInfo("node", "server.mjs") { WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
                _server = Process.Start(node) ?? throw new Exception("Could not start Node.js.");
                var logPath = Path.Combine(root,"logs","desktop-server.log");
                var logLock = new object();
                void Log(string? line) { if(line!=null) lock(logLock) File.AppendAllText(logPath,line+Environment.NewLine); }
                _server.OutputDataReceived += (_,e)=>Log(e.Data); _server.ErrorDataReceived += (_,e)=>Log(e.Data);
                _server.BeginOutputReadLine(); _server.BeginErrorReadLine();
                var ready = false;
                for(var i=0;i<120;i++)
                {
                    if(_server.HasExited) throw new Exception("The local editor service stopped. See logs/desktop-server.log.");
                    if(await Ready()) { ready=true;break; }
                    await Task.Delay(500);
                }
                if(!ready) throw new Exception("The editor is taking too long to start. See logs/desktop-server.log.");
            }
            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TAOMBannerStudio","WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null,userData);
            await _web.EnsureCoreWebView2Async(environment);
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            _web.Source = new Uri(url);
            _loading.Visible=false;
        }
        catch(Exception error)
        {
            _loading.Text = "Could not start Banner Studio.\n\n"+error.Message+"\n\nInstall Node.js 22+ and the .NET 10 desktop runtime if needed.";
            _loading.Padding = new Padding(50);
        }
    }
}
