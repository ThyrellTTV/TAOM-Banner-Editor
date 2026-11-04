# TAOM Banner Studio

A local Windows banner editor for TAOM and other compatible Bannerlord mods. Opens existing module banners, renders their actual symbol artwork, and edits game-compatible banner codes without starting Bannerlord.

## Start and share

For a packaged Windows x64 release, extract the **whole ZIP** into a writable folder and double-click **Start-Banner-Editor.cmd**. Node.js and .NET are included. Microsoft Edge WebView2 Runtime must be available (normally present on Windows). No developer SDK is needed. The recipient supplies their own Bannerlord installation and mod assets.

On first launch, **Module settings** opens automatically. Choose the source module folder and Bannerlord game folder, then click **Apply & load module**. The initial asset extraction can take a few minutes. Settings are validated before they are saved; an invalid folder leaves the current configuration intact.

The optional installed-module folder lets you mirror clan/kingdom saves to a second copy. Mirroring starts disabled on a fresh installation. Your existing local settings are preserved when updating this checkout.

To create a clean shareable release from a source checkout:

```powershell
.\Package-Banner-Studio.ps1
```

The script builds self-contained Windows x64 desktop/extractor executables, bundles Node.js and production dependencies, and creates a timestamped ZIP under `dist/`. It copies an explicit allowlist: **no local settings, mod/game assets, extracted textures, backups, drafts or atlas builds**. Send that ZIP to other people. Sending your working folder after use would also send its local data.

From source, install Node.js 22+, the .NET 10 SDK and WebView2, then:

```powershell
npm ci
dotnet publish desktop-shell/BannerStudio.csproj -c Release -o app -p:PublishSingleFile=true --self-contained false -r win-x64
dotnet build sprite-packer/SpritePacker.csproj -o tools/sprite-packer
dotnet build texture-encoder/TextureEncoder.csproj -o tools/texture-encoder
.\Start-Banner-Editor.cmd
```

Browser fallback: run `Start-in-browser.ps1`, or `npm start` and open <http://127.0.0.1:4318>. The editor runs a loopback service on this computer.

## Configurable folders and files

Use **Module settings → Files, asset folders and atlas naming** for custom mod layouts. Native file/folder pickers are available in the Windows app; the browser version accepts pasted paths.

| Setting | Default / purpose |
| --- | --- |
| Source module folder | Required; any local module development or installed folder |
| Bannerlord game folder | Required; supplies Native artwork and palette |
| Module display name | Derived from module folder; shown in library/filter labels |
| Installed module folder and mirror toggle | Optional second save destination |
| Module banner registry XML | `ModuleData/banner_icons.xml` |
| Native banner registry XML | `Modules/Native/ModuleData/banner_icons.xml` relative to game |
| Banner definition files/folders | `ModuleData`; one file or recursive folder per line |
| PSD atlas folder | `AssetSources/BannerIcons` |
| Transparent GUI thumbnail folder | `GUI/SpriteParts/ui_<module>_bannericons` |
| Native TPAC folder | `Modules/Native/AssetPackages` relative to game |
| Module TPAC files/folders | `Assets` and `AssetPackages`; folders searched recursively |
| New atlas filename prefix | `<module>_banners`; lowercase letters, digits and underscores |
| Editor data folder | App folder; contains cache, backups, drafts, exports and atlas builds |

Module registry and definition files must remain inside the source module so targeted saves/backups map correctly. Other asset folders can be absolute or relative to the module. Native paths resolve against the game folder. The editor data folder resolves against the app folder. Module/package/definition lists can also be edited in JSON.

Local settings are stored in `config.json` and excluded from Git/packages. `config.example.json` contains a path-free template. Advanced use: `BANNER_STUDIO_CONFIG` selects a different settings file, and `BANNER_STUDIO_PORT` overrides the listening port. Command-line atlas tools accept `--config <file>`. Cache identities and browser edit recovery are scoped to the selected workspace; saves from a stale tab are refused after changing modules.

The editor supports standard Bannerlord `BannerIconData` registries, dot-separated banner codes, XML banner attributes and supported literal/XSLT attribute overrides. It finds materials and their texture dependencies from the registry, without requiring TAOM material names. **Symbol atlases must use the standard 4×4 layout.** It is not a general XSLT execution engine, custom shader renderer or save-game editor. Modules with proprietary banner formats or different atlas layouts need additional support. Both module and Native registries are currently required; use a valid empty module registry for a mod that only uses Native symbols.

## Mod profiles

Your existing configuration becomes the first profile automatically, with its current data folder, drafts and backups retained. Switch profiles using the **Mod profile** selector in the library. In **Module settings**, choose **New profile**, give it a name, configure its folders, and use **Create & load profile**. Leaving Editor data folder blank on a new profile creates a separate `.profiles/<ID>/` data folder. The editor refuses sharing the same data folder between profiles.

Profiles retain their own paths, installed-module mirror setting, caches, drafts, exports, atlas builds and backups. Unsaved banner edits are checked before switching. Profile names can be edited in Module settings. Removing an inactive profile removes its saved catalog entry; its module and data files remain on disk. The active settings stay in `config.json`; the local catalog is `config.profiles.json`. Both and `.profiles/` are excluded from Git and release ZIPs.

## Atlas manager

Click **Atlas manager** to browse registered materials and their sixteen slots. Select a slot to see its icon IDs and the banners that reference them. You can **replace artwork with a PNG**, **centre a slot**, **centre every registered slot**, or **swap artwork between filled slots**. Existing icon IDs and texture indexes are preserved.

To fill an **Unused · add PNG** cell, select it, choose its icon category and upload a PNG. **Build review** proposes a free icon ID and a new `banner_icons.xml` entry at that exact slot. Native IDs, module IDs and existing numeric thumbnail filenames are reserved. The review shows the proposed ID and provides the proposed XML for download; no module files change until installation.

Operations are queued until **Build review**. The review package is created under the active profile's `atlas-builds/manage-<batch>/` folder, outside the source atlas folder. Compare **Registered slots** with **Reviewed result** before choosing **Install reviewed atlas**. Download the reviewed layered PSD independently if desired.

The manager supports 8-bit RGB PSD and PNG atlases up to 4096×4096, with square 4×4 layouts and even-sized cells. It preserves the existing source format and resolution; the new-atlas importer uses the profile's 1K/2K/4K PSD setting. PSD source layers are retained and updated cells are added as editable cover layers. PNG sources get an editable PSD in the review package while installation updates the original PNG, avoiding duplicate engine source assets. Unchanged cells remain pixel-for-pixel identical. Centring uses the artwork currently inside the cell; use the original PNG to replace artwork that was previously clipped across cell boundaries.

Installation verifies the reviewed source/XML/thumbnail snapshots, backs up exact originals in the package's `originals/` folder, and updates the reviewed source plus affected transparent GUI thumbnails. When filling unused cells, it rechecks ID availability and commits the XML registration last. Existing-slot edits leave the XML unchanged. A stale target blocks installation; a failed replacement restores files already written and removes newly created thumbnails. Use **Build game resources** afterwards to compile and deploy the artwork.

## Automatic game resource deployment

In **Atlas manager**, select an atlas and finish installing any queued source edits. Click **Build game resources**. The editor automatically packs all banner thumbnails using the installed TaleWorlds sprite generator library, builds the selected atlas texture and banner material, and generates editable `.tpac` packages and matching `.rdc` runtime texture data. No manual Modding Kit import is needed for the supported format.

The **Game deployment** review shows the exact changed files, sizes and destination folders. **Deploy reviewed resources** updates the development module and the configured installed module, if one is set. This is independent of the clan/kingdom banner-code mirror toggle. Source/target module IDs must match. Existing material/texture GUIDs are retained; new resources receive new IDs. The complete banner thumbnail category is repacked together, while unrelated SpriteData categories are preserved separately for each destination.

Builds live under the active profile's `game-builds/deploy-<batch>/`. Building changes no module files. Deployment verifies input and destination snapshots, saves exact originals under the build's `originals/` folder, writes resource data before XML mappings, and restores written files on failure. The game and Modding Kit must be closed when deploying. Restart Bannerlord afterwards to load the changed resources. The selected atlas and shared banner thumbnail resources are included; other atlases, UI categories, module binaries and campaign files are not rebuilt.

**Supported compiler:** the editable single-resource TPAC v2 / texture metadata v3 / material metadata v0 format verified in **Bannerlord 1.5.6**. The active module must supply compatible existing banner material/texture and GUI sheet templates, a `GUI/<module ID>SpriteData.xml`, and its thumbnail category in `GUI/SpriteParts/Config.xml`. Module folder names must match their SubModule IDs, and source artwork/thumbnail folders must be inside the source module. Installed TaleWorlds editor sprite-generator binaries and .NET Framework 4.8 are required for packing; vendor binaries are resolved from the user's installation and are not redistributed.

The default remains **uncompressed RGBA8 with one mip**, preserving the working output. Compression, resolution and material options are now configurable as described below. Native loader/render tests cover newly generated resources and dimension changes; this is a focused banner compiler, not a general asset importer.

Command-line equivalent (build a review first):

```powershell
node .\compile-game-resources.mjs --material taom_banners_packed_alpha_02
node .\compile-game-resources.mjs --install-build deploy-<batch>
```

Use `--config <file>` for a different profile/configuration. Download the deployment manifest from the review to inspect all file hashes and backups.

## Texture, material and resolution settings

Open **Module settings → Atlas resolution, textures and materials** and click **Apply & load module** to save. These settings persist in `config.json` and each mod profile, and are used by both the app and CLI. Changing compilation options invalidates older deployment reviews; it does not rewrite module assets until a new build is deployed.

| Option | Behavior |
| --- | --- |
| New PSD resolution | 1K, 2K or 4K, giving sixteen 256, 512 or 1024px cells; default 2K |
| Compiled atlas resolution | Keep source resolution, or compile at 1K/2K/4K; each cell is resampled independently and the editable PSD/PNG remains at its original resolution |
| Atlas texture format | RGBA8, BC1/DXT1, BC3/DXT5 or BC7 |
| Thumbnail sheet format | RGBA8, BC3/DXT5 or BC7, preserving alpha; the packer determines sheet sizes and mappings |
| Compression quality | Fast, Balanced or Best; higher quality takes longer |
| Generate atlas mipmaps | Creates the full chain down to 1×1; off by default; GUI sheets stay unmipped |
| Atlas texture flags | Preserve existing flags, or replace them with the given lowercase names |
| Material template | Preserve the existing material, or use a compatible registered module material as the shader/settings template |
| Custom material settings | Blend mode, alpha cutoff (0–1), material flags, shader flags and vertex layout flags |

**Copy template values to custom settings** fills the custom material fields from the selected template. Empty custom flag lists clear those flags. Existing texture/material IDs and diffuse bindings remain stable. New resources receive new IDs. A selected material template supplies its shader and other material values while retaining the destination resource's identity.

RGBA8 uses 4 bytes per pixel; BC1 uses approximately 0.5 and BC3/BC7 approximately 1 before mip overhead. BC compression is lossy. GUI formats retain transparency, while BC1 is offered for opaque banner masks. Building a larger compiled texture preserves placement but cannot recover detail absent from the source. The review and deployment manifest record the actual dimensions, format, mip count and saved settings used for the build.

## Asset validation

Click **Validate assets** for a read-only report covering XML validity, duplicate IDs/groups/colours, invalid slot indexes, unresolved banner symbols/colours, missing materials/textures/sources, empty or off-centre registered cells, transparent GUI thumbnails, and orphan/unregistered assets. Native ID overrides and source-based previews are identified separately. Existing 4096px sources are informational; they are not treated as invalid when the profile uses a smaller resolution for new imports.

Filter by severity or search an ID/material. **Open atlas** jumps to the affected material/slot; **Open banner** opens an affected composition. **Export JSON report** saves the complete report. Validation never repairs or installs anything automatically. Asset-cache fingerprints track registry and TPAC changes, and source previews track PSD/PNG changes, so reloading does not silently reuse an obsolete material cache.

## Editing

- Select a clan, kingdom or culture from the library. Search uses its name, ID or culture.
- Click a symbol below the preview to replace the selected layer. Shift-click to add a new layer. Clicking a symbol with the background selected also adds a layer.
- Add, duplicate, delete and reorder symbol layers in the right panel. The background always remains at the bottom.
- **Ctrl-click** layers to toggle selection; **Shift-click** a layer selects a range. Shift/Ctrl-click symbols on the canvas to toggle them. **Ctrl+A** selects all symbols; Escape keeps the primary selection. The background stays outside a multi-selection.
- Drag, nudge, duplicate, delete, reorder, scale, rotate, mirror, centre or recolour a selected group. Numeric X/Y and size fields show the primary layer and transform the group around it or its shared centre. **Align X / Align Y** align selected centres. Undo/redo restores the group and its selection.
- **Smart snapping** aligns dragged selections to canvas/512 guides and other layer bounds/centres. Choose an optional 8/16/32/64-unit grid. Hold **Alt** while dragging to bypass snapping. Snap tolerance follows the displayed zoom; cyan guides show active targets.
- **Ctrl+mouse wheel** zooms the preview around the pointer without changing any banner values. Hold **Space and drag**, or use the middle mouse button, to pan. The −/+ buttons also zoom; **Fit** or **Ctrl+0** resets the preview. Zoom ranges from 25% to 1600% and resets when switching banners or crop views. This navigation does not change layer sizes, positions, undo history, saves or PNG exports.
- Set primary/outline colours from the merged Native + module palette. Backgrounds have two colours. Toggle an outline, mirror a layer or rotate it.
- Arrow keys move one unit; Shift+arrow moves ten. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes; Ctrl+D duplicates; Delete removes a symbol.
- **Banner code** imports or copies the game's dot-separated code. Unknown source IDs are preserved and flagged in the preview.
- **PNG** saves the current view under the app's `exports/` folder and also offers a browser download, without selection handles or guides. Flat, banner and shield masks are preview/export presentations; they do not change the banner code.

The editor defaults to the full **1528×1528** banner canvas, as used by the game's Banner Builder tableau. **512 guide** marks the nominal central editing area without clipping artwork. Explicit 1024/512 central crops are available in Preview area. Flat, banner and round shield views share the chosen viewport, as does PNG export. Equipment can map the banner differently; these shape previews do not simulate cloth, lighting or each mesh's UV layout.

## Saving

**Save draft** writes a named JSON composition under `drafts/`. Drafts are available from the library's Drafts tab. Recent unsaved edits are also recovered from local browser storage.

**Save to module** updates the selected source banner's `banner_key` or `faction_banner_key`, including XSLT attribute bodies. For **clans and kingdoms**, it also updates that same banner in the configured installed module when mirroring is enabled. The save dialog shows both destination files. Configure **Installed module folder** and **Also save clan and kingdom banners to the installed module** in Module settings (`installedModulePath` and `syncInstalledBanners` in `config.json`). Culture edits remain source-only.

The installed copy can have different surrounding content or an older banner code; only the selected banner attribute is changed. Matching `SubModule.xml` IDs are required. Before writing, the app backs up both originals under `backups/<timestamp>/development/ModuleData/...` and `backups/<timestamp>/installed/ModuleData/...`. It validates both targets, checks for concurrent changes, and prepares temporary files before replacement. If the second write fails, the first is restored. A missing or incompatible installed target stops the save. Turning installed sync off restores development-only saving.

Saving updates module definition files on disk. It does not patch a running game's memory or rewrite banner data already stored in a campaign save.

New compositions can be saved as drafts or exported as banner codes. To assign one to a clan or kingdom, select that source banner, import the new code, and use Save to module.

The app does not automatically edit faction armour colours, kingdom colour overrides, clan-heraldry configuration, or saved campaigns. The atlas builder creates PSDs, registers new symbol IDs and generates GUI source thumbnails. **Build game resources** then compiles the selected atlas and packs/deploys the banner GUI resources through a separate review.

## Build a 4×4 PSD from PNGs

Click **Build atlas**, choose a faction and **Alpha** or **Ornament**, then add PNG files. Use the arrows beside each file to change its slot order and click **Generate PSD atlas**.

- New PSDs use the profile's **1K/2K/4K** setting, split into sixteen **256/512/1024px** cells. The default is 2048×2048 with 512px cells.
- Transparent margins are trimmed. The visible artwork's bounding rectangle is centred on the exact cell centre, horizontally and vertically.
- Oversized artwork is scaled down proportionally to fit; smaller artwork is never enlarged. Default padding is zero. Optional padding and an outside outline reserve room inside the chosen cell size.
- Odd pixel dimensions receive a half-pixel translation with antialiasing so their visible bounds can be centred exactly using integer PSD layer positions. This does not scale the image up.
- Images fill slots 0–15 from left to right, top to bottom. Image seventeen starts a second PSD. A batch supports up to 128 PNGs (128 MB total, 32 MB per file).
- Your configured prefix plus faction/category determine the name, for example `taom_banners_gondor_alpha_03.psd` or `taom_banners_rohan_ornaments_01.psd`. The next number is automatic; existing PSDs are never overwritten.
- **Install PSDs, XML entries and GUI thumbnails** installs PSDs into the configured atlas folder, adds groups and icon IDs to the configured module registry, and writes white artwork with transparent backgrounds to the configured GUI thumbnail folder as `<icon ID>.png`. These thumbnails are 256×256 and centred. Uncheck this option to save a complete review package without changing the module.
- Each atlas receives an unused group ID and a reserved block of icon IDs. Existing faction/category numbering is followed where available; occupied IDs and filenames, including Native icons and orphan GUI PNGs, are avoided. Each XML icon records the exact material name and slot index 0–15.
- Installation backs up the original XML under the build's `backups/` directory, preserving its module-relative path. It refuses stale XML and existing PSD/thumbnail targets, and removes files created by the import if a copy fails before the XML commit. Newly installed symbols appear in the external editor immediately, including artwork whose game material has not yet been compiled.

Each PSD includes a black background, one editable game-mask layer per PNG, hidden layers retaining the placed original colours, and Photoshop guides at the cell boundaries. The composite uses green for fill and red for an optional outline, matching the game's mask convention. Grid lines and centre crosses appear only in the separate review PNG, never in the game texture.

The complete build is retained in `atlas-builds/<batch>/`: PSDs, flattened `.mask.png` atlases, `.preview.png` review grids, byte-for-byte original PNGs under `sources/`, transparent GUI PNGs under `thumbnails/`, proposed `banner_icons.xml`, `banner_icons.additions.xml`, and `manifest.json` recording source-to-ID mapping, group IDs, texture indexes, scale, verified centres, installation paths and XML backup. IDs in a review-only package are proposals; rebuild before installing if module registrations have changed.

Transparent PNGs work directly. For opaque black/white artwork, choose **White artwork on black background** or **Black artwork on white background** under Image and output options. Fully opaque PNGs in transparency mode generate a warning because their entire rectangle becomes the symbol.

The same workflow is available for batches supplied through chat:

```powershell
node .\build-atlas.mjs --faction gondor --type alpha --input 'C:\incoming-banners'
node .\build-atlas.mjs --faction rohan --type ornament --input 'C:\incoming-ornaments' --no-install
```

Folder input uses natural filename order (`2.png` before `10.png`). Explicit PNG arguments retain their supplied order. Run `npm run atlas -- --help` for padding, outline, mask mode, output directory and atlas-number options. Existing source PSDs are preserved; newly generated ones use the profile's configured canvas size.

## Artwork and cache

To rebuild existing registered atlases from ID-named PNGs, use the XML-aware workflow below. Input directories are searched in order, so original high-resolution thumbnails can take priority over GUI sprites. It preserves each material name and `texture_index`, including gaps; unused cells are black. It uses the same downscale-only sizing and exact visible-bounds centring as the new-atlas builder.

```powershell
node .\regenerate-atlases.mjs --input 'C:\path\to\original-thumbnails' --input 'C:\MyMod\GUI\SpriteParts\ui_mymod_bannericons'
node .\regenerate-atlases.mjs --install-build 'C:\BannerStudio\atlas-builds\regenerate-<batch>'
```

The first command stages every registered PSD and checks each saved composite for exact centring, valid mask channels and empty unregistered slots. Review `all-atlases.png` and individual preview grids. The second command verifies that the XML and original PSDs have not changed, saves byte-for-byte backups under the batch's `originals/` directory, then replaces the module PSDs. `regeneration.json` records source paths, hashes, scaling, placement, backup location and installation status. `--install` can build and install in one command. Unregistered PSDs and the source XML are preserved. Game texture compilation remains separate.

Native symbols, materials and background geometry come from the installed game's Native TPAC packages. Native BC7 textures are decoded locally. Module artwork can preview directly from registered PSD or PNG atlases, including packed PNG sources. Local source artwork takes precedence over an older compiled preview when present. Red is the outline mask; green is the fill mask, matching the game shader.

Startup and Reload refresh source XML/XSLT and changed PSD composites. After changing asset registrations/material packages, use Module settings → Rebuild asset cache. Generated data lives under `cache/`. Extraction details are in `logs/extraction.log` after a rebuild.

Some module definitions can reference symbols or palette colours missing from their configured registries. Validation lists the affected banners, while the editor preserves their original values. No source data is silently substituted.

## Development

```powershell
npm ci
npm run extract
npm start
npm test
dotnet publish desktop-shell/BannerStudio.csproj -c Release -o app -p:PublishSingleFile=true --self-contained false -r win-x64
```

Tests cover fresh setup, custom mod folders/registries/prefixes, transparent thumbnail installation, settings validation and stale-workspace rejection. When a valid local configuration exists, integration tests also round-trip its real XML/XSLT banners, check targeted source replacements, malformed codes and signed values, and verify backups/conflict detection against temporary copies. Atlas tests check asymmetric transparency, odd-dimension centring, proportional downscaling, alpha/outline masks, PSD layer coordinates, overflow into a second atlas and protection of existing files. See `research/banner-format.md` for the rendering findings.

## Dependencies

The vendored TPAC reader derives from TpacTool by szszss and the local Bannerlord Viewport adaptations. Its MIT licence is retained at `third_party/TpacTool/LICENSE`. The extractor also uses BCnEncoder.Net, lz4net and JetBrains.Annotations; the desktop shell uses Microsoft.Web.WebView2. Node dependencies and exact versions are recorded in `package-lock.json`.
