using System;
using System.IO;
using System.Reflection;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Expected editor binary folder and isolated Modules root.");
        string binaries = Path.GetFullPath(args[0]);
        string modules = Path.GetFullPath(args[1]);
        if (!File.Exists(Path.Combine(modules, ".banner-studio-staging")) || Path.GetFileName(modules) != "Modules")
            throw new InvalidOperationException("Sprite packing is only allowed in an explicitly marked staging Modules folder.");
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs request)
        {
            string file = Path.Combine(binaries, new AssemblyName(request.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
        Assembly library = Assembly.LoadFrom(Path.Combine(binaries, "TaleWorlds.TwoDimension.SpriteSheetGenerator.Library.dll"));
        Type configType = library.GetType("TaleWorlds.TwoDimension.SpriteSheetGenerator.Library.SpriteEditorDomainConfiguration", true);
        object config = Activator.CreateInstance(configType);
        configType.GetField("SourceDirectoryPath").SetValue(config, modules);
        foreach (string fieldName in new[] { "OutputType", "CollectionType" })
        {
            FieldInfo field = configType.GetField(fieldName);
            field.SetValue(config, Enum.Parse(field.FieldType, fieldName == "OutputType" ? "Engine" : "AllAvailableModules"));
        }
        object result = library.GetType("TaleWorlds.TwoDimension.SpriteSheetGenerator.Library.SpriteEditorDomain", true).GetMethod("Start").Invoke(null, new[] { config });
        return (bool)result ? 0 : 1;
    }
}
