using System.Text.Json;
using BCnEncoder.Encoder;
using BCnEncoder.Shared;

if (args.Length != 1) throw new ArgumentException("Expected an encoding job JSON file.");
string jobFile = Path.GetFullPath(args[0]);
string jobRoot = Path.GetDirectoryName(jobFile)! + Path.DirectorySeparatorChar;
using var document = JsonDocument.Parse(File.ReadAllText(jobFile));
var job = document.RootElement;
CompressionFormat format = job.GetProperty("format").GetString() switch
{
    "bc1" => CompressionFormat.Bc1,
    "bc3" => CompressionFormat.Bc3,
    "bc7" => CompressionFormat.Bc7,
    _ => throw new ArgumentException("Unsupported texture compression format.")
};
CompressionQuality quality = job.GetProperty("quality").GetString() switch
{
    "fast" => CompressionQuality.Fast,
    "balanced" => CompressionQuality.Balanced,
    "best" => CompressionQuality.BestQuality,
    _ => throw new ArgumentException("Unsupported texture compression quality.")
};
foreach (var level in job.GetProperty("levels").EnumerateArray())
{
    string input = Path.GetFullPath(level.GetProperty("input").GetString()!);
    string output = Path.GetFullPath(level.GetProperty("output").GetString()!);
    if (!input.StartsWith(jobRoot, StringComparison.OrdinalIgnoreCase) || !output.StartsWith(jobRoot, StringComparison.OrdinalIgnoreCase))
        throw new ArgumentException("Encoding files must remain inside the job folder.");
    int width = level.GetProperty("width").GetInt32(), height = level.GetProperty("height").GetInt32();
    byte[] rgba = File.ReadAllBytes(input);
    if (width < 1 || height < 1 || width > 4096 || height > 4096 || rgba.Length != checked(width * height * 4))
        throw new ArgumentException("Invalid RGBA texture level.");
    var encoder = new BcEncoder(format);
    encoder.OutputOptions.GenerateMipMaps = false;
    encoder.OutputOptions.Quality = quality;
    byte[][] result = encoder.EncodeToRawBytes(rgba, width, height, PixelFormat.Rgba32);
    File.WriteAllBytes(output, result[0]);
}
