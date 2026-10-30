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
            var port = 4318;
            var configPath=Environment.GetEnvironmentVariable("BANNER_STUDIO_CONFIG")??Path.Combine(root,"config.json");
            if(File.Exists(configPath))try{var config=JsonDocument.Parse(File.ReadAllText(configPath)).RootElement;if(config.TryGetProperty("port",out var configuredPort))if(configuredPort.TryGetInt32(out var number)&&number>=1024&&number<=65535)port=number;}catch(JsonException){}
            if(int.TryParse(Environment.GetEnvironmentVariable("BANNER_STUDIO_PORT")??Environment.GetEnvironmentVariable("TAOM_EDITOR_PORT"),out var overridePort))port=overridePort;
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
                var bundledNode=Path.Combine(root,"runtime","node.exe");
                var node = new ProcessStartInfo(File.Exists(bundledNode)?bundledNode:"node", "server.mjs") { WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
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
            _web.CoreWebView2.WebMessageReceived += (_,e)=>{
                try{
                    if(new Uri(e.Source).GetLeftPart(UriPartial.Authority)!=url)return;
                    var message=JsonDocument.Parse(e.WebMessageAsJson).RootElement;
                    if(message.GetProperty("type").GetString()!="browse-path")return;
                    var field=message.GetProperty("field").GetString();
                    var allowed=new[]{"modulePath","gamePath","installedModulePath","bannerIconsFile","nativeBannerIconsFile","atlasSourceDirectory","thumbnailDirectory","nativeAssetDirectory","dataDirectory"};
                    if(!allowed.Contains(field))return;
                    string? selected=null;
                    if(message.GetProperty("kind").GetString()=="file"){
                        using var picker=new OpenFileDialog{Filter="XML files (*.xml)|*.xml|All files (*.*)|*.*",CheckFileExists=true};
                        if(picker.ShowDialog(this)==DialogResult.OK)selected=picker.FileName;
                    }else{
                        using var picker=new FolderBrowserDialog{Description="Choose "+field,UseDescriptionForTitle=true};
                        if(picker.ShowDialog(this)==DialogResult.OK)selected=picker.SelectedPath;
                    }
                    if(selected!=null)_web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="selected-path",field,path=selected}));
                }catch(Exception error){MessageBox.Show(this,error.Message,"Choose path",MessageBoxButtons.OK,MessageBoxIcon.Information);}
            };
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
