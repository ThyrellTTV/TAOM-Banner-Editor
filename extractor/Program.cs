using System.IO;
using System.Text.Json;
using System.Xml.Linq;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TpacTool.Lib;
using Material = TpacTool.Lib.Material;

class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        var configPath = Path.GetFullPath(args.Length > 0 ? args[0] : "config.json");
        var root = Path.GetDirectoryName(configPath)!;
        var config = JsonDocument.Parse(File.ReadAllText(configPath)).RootElement;
        var module = config.GetProperty("modulePath").GetString()!;
        var game = config.GetProperty("gamePath").GetString()!;
        string Setting(string key,string fallback) => config.TryGetProperty(key,out var value) && value.ValueKind==JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()) ? value.GetString()! : fallback;
        string Resolve(string folder,string file) => Path.GetFullPath(Path.Combine(folder,file));
        var dataRoot=Resolve(root,Setting("dataDirectory","."));
        var cache = Path.Combine(dataRoot, "cache");
        Directory.CreateDirectory(Path.Combine(cache, "textures"));
        var textures = new Dictionary<string, object>();
        var materials = new Dictionary<string, object>();
        var meshes = new Dictionary<string, object>();
        var errors = new List<string>();
        var files = new List<string>();
        var registryFiles=new[]{Resolve(game,Setting("nativeBannerIconsFile","Modules/Native/ModuleData/banner_icons.xml")),Resolve(module,Setting("bannerIconsFile","ModuleData/banner_icons.xml"))};
        var materialNames=new HashSet<string>();var backgroundNames=new HashSet<string>();
        foreach(var registry in registryFiles){var doc=XDocument.Load(registry);foreach(var icon in doc.Descendants("Icon")){var name=(string)icon.Attribute("material_name");if(name!=null)materialNames.Add(name);}foreach(var bg in doc.Descendants("Background")){var name=(string)bg.Attribute("mesh_name");if(name!=null)backgroundNames.Add(name);}}
        var native = Resolve(game,Setting("nativeAssetDirectory","Modules/Native/AssetPackages"));
        if (Directory.Exists(native)) files.AddRange(Directory.GetFiles(native, "*.tpac"));
        var packagePaths=config.TryGetProperty("assetPackagePaths",out var paths)?paths.EnumerateArray().Select(p=>p.GetString()!).ToArray():new[]{"Assets","AssetPackages"};
        foreach(var folder in packagePaths){var location=Resolve(module,folder);if(Directory.Exists(location))files.AddRange(Directory.GetFiles(location,"*.tpac",SearchOption.AllDirectories));else if(File.Exists(location))files.Add(location);}
        files=files.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        // Resolve texture dependencies by GUID; other mods need not use the same
        // naming convention for their materials and diffuse textures.
        var indexes=new Dictionary<string,AssetPackage>();var requiredTextures=new HashSet<Guid>();
        foreach(var file in files){try{indexes[file]=new AssetPackage(file,true,false,indexOnly:true);var mats=new AssetPackage(file,true,false,assetFilter:(type,name)=>type==Material.TYPE_GUID&&materialNames.Contains(name));foreach(var material in mats.Items.OfType<Material>())foreach(var slot in material.Textures.Values)requiredTextures.Add(slot.Guid);}catch(Exception e){errors.Add(Path.GetFileName(file)+": "+e.Message);}}
        var textureNames=indexes.Values.SelectMany(p=>p.Items).Where(item=>item.Type==Texture.TYPE_GUID&&requiredTextures.Contains(item.Guid)).Select(item=>item.Name).ToHashSet();
        foreach (var file in files)
        {
            Console.WriteLine("Reading " + Path.GetFileName(file));
            try
            {
                var index = indexes[file];
                File.WriteAllText(Path.Combine(cache, "index-" + Path.GetFileName(file) + ".json"), JsonSerializer.Serialize(index.Items.Select(i => new { i.Name, i.Type, i.Guid })));
                var package = new AssetPackage(file, true, false, assetFilter: (type, name) =>
                    (type == Texture.TYPE_GUID && textureNames.Contains(name)) || (type==Material.TYPE_GUID&&materialNames.Contains(name)) ||
                    (type == Metamesh.TYPE_GUID && backgroundNames.Contains(name)));
                if (Path.GetFileName(file).Equals("Banner.tpac", StringComparison.OrdinalIgnoreCase))
                    File.WriteAllText(Path.Combine(cache, "native-index.json"), JsonSerializer.Serialize(package.Items.Select(i => new { i.Name, type = i.GetType().Name, i.Guid })));
                foreach (var item in package.Items)
                {
                    try
                    {
                        if (item is Texture texture)
                        {
                            var images = new List<string>();
                            for (int layer = 0; texture.HasPixelData && layer < texture.ArrayCount; layer++)
                            {
                                var name = $"{Setting("cacheNamespace","default")}_{texture.Guid:N}_{layer}.png";
                                var output = Path.Combine(cache, "textures", name);
                                if (!File.Exists(output) || File.GetLastWriteTimeUtc(output) < File.GetLastWriteTimeUtc(file))
                                {
                                    var width = checked((int)texture.Width);
                                    var height = checked((int)texture.Height);
                                    var bitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Bgra32, null);
                                    bitmap.Lock();
                                    try
                                    {
                                        var writer = new TextureUtil.ARGB32Writer(bitmap.BackBuffer, width, height, bitmap.BackBufferStride);
                                        var raw = texture.TexturePixels.Data.RawImage[layer][0];
                                        if (texture.Format == TextureFormat.BC7)
                                        {
                                            var decoded = new BCnEncoder.Decoder.BcDecoder().DecodeRaw(raw, width, height, BCnEncoder.Shared.CompressionFormat.Bc7);
                                            var bgra = decoded.SelectMany(p => new byte[] { p.b, p.g, p.r, p.a }).ToArray();
                                            System.Runtime.InteropServices.Marshal.Copy(bgra, 0, bitmap.BackBuffer, bgra.Length);
                                        }
                                        else TextureUtil.DecodeTextureDataToWriter(raw, width, height, texture.Format, writer);
                                        bitmap.AddDirtyRect(new Int32Rect(0, 0, width, height));
                                    }
                                    finally { bitmap.Unlock(); }
                                    var encoder = new PngBitmapEncoder();
                                    encoder.Frames.Add(BitmapFrame.Create(bitmap));
                                    using var stream = File.Create(output);
                                    encoder.Save(stream);
                                }
                                images.Add("/cache/textures/" + name);
                            }
                            textures[texture.Guid.ToString()] = new { name = texture.Name, width = texture.Width, height = texture.Height, format = texture.Format.ToString(), images };
                        }
                        else if (item is Material material)
                        {
                            materials[material.Name] = new { guid = material.Guid, slots = material.Textures.ToDictionary(p => p.Key.ToString(), p => p.Value.Guid.ToString()), flags = material.ShaderMaterialFlags, alphaTest = material.AlphaTest, blendMode = material.BlendMode };
                        }
                        else if (item is Metamesh model && backgroundNames.Contains(model.Name))
                        {
                            meshes[model.Name] = model.Meshes.Where(m => m.Lod == 0).Select(m =>
                            {
                                var data = m.VertexStream.Data;
                                var positions = data.Positions.Length > 0 ? data.Positions.Select(p => new float[] { p.X, p.Y, p.Z }).ToArray() : data.CompressedPositions.Select(p => new float[] { (float)p.X, (float)p.Y, (float)p.Z }).ToArray();
                                return new { positions, indices = data.Indices, colors = data.Colors1.Select(c => new int[] { c.R, c.G, c.B, c.A }).ToArray() };
                            }).ToArray();
                        }
                    }
                    catch (Exception e) { errors.Add(item.Name + ": " + e.Message); }
                }
            }
            catch (Exception e) { errors.Add(file + ": " + e.Message); }
        }
        var manifest = new { modulePath = module, gamePath = game, generatedAt = DateTime.UtcNow, textures, materials, meshes, errors, files = files.Select(f => new { path = f, modified = File.GetLastWriteTimeUtc(f) }) };
        File.WriteAllText(Path.Combine(cache, "assets.json"), JsonSerializer.Serialize(manifest));
        Console.WriteLine($"Extracted {textures.Count} textures, {materials.Count} materials, {meshes.Count} backgrounds. {errors.Count} errors.");
        foreach (var error in errors) Console.Error.WriteLine(error);
        return textures.Count > 0 && meshes.Count > 0 ? 0 : 1;
    }
}
