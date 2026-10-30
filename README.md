# TAOM Banner Studio

A local Windows banner editor for TAOM. Opens existing module banners, renders their actual symbol artwork, and edits game-compatible banner codes without starting Bannerlord.

## Start

From a fresh checkout, install Node.js 22+, the .NET 10 SDK and Microsoft Edge WebView2, then run:

```powershell
npm ci
dotnet publish desktop-shell/BannerStudio.csproj -c Release -o app -p:PublishSingleFile=true --self-contained false -r win-x64
```

Set the module and game folders in `config.json` before starting. The module assets and installed game are required locally; they are not bundled in this repository. Generated executables, extracted textures, imported atlases, drafts and backups are excluded from Git. The integration tests also use the configured local module and game files.

Double-click **Start-Banner-Editor.cmd**, or open **app/TAOM Banner Studio.exe**.

The Windows app starts its own loopback service and opens an embedded browser window. It uses the existing Node.js installation, .NET 10 Windows desktop runtime and Microsoft Edge WebView2 runtime. These are installed on the development computer. The app does not contact a hosted service.

Browser fallback: run `Start-in-browser.ps1`, or run `npm start` and open <http://127.0.0.1:4318>.

## Source folders

Defaults in `config.json`:

- TAOM: `R:\TAOM\lotraom-assets\v1.5\TAOM`
- Bannerlord: `D:\SteamLibrary\steamapps\common\Mount & Blade II Bannerlord`

Use **Module settings** to change either location. The current checkout's `v1.3` folder does not contain the main TAOM module.

The library includes banner definitions in XML and XSLT, including literal replacement kingdoms and `xsl:attribute` clan overrides. It reads 272 banner definitions in this checkout, with 605 registered symbols, 36 background patterns and 333 palette colours. It shows source definitions; it is not a general XSLT execution engine or a save-game editor.

## Editing

- Select a clan, kingdom or culture from the library. Search uses its name, ID or culture.
- Click a symbol below the preview to replace the selected layer. Shift-click to add a new layer. Clicking a symbol with the background selected also adds a layer.
- Add, duplicate, delete and reorder symbol layers in the right panel. The background always remains at the bottom.
- Drag symbols in the preview, use the numeric transform fields, or scroll over the preview to resize the selected symbol.
- Set primary/outline colours from the merged Native + TAOM palette. Backgrounds have two colours. Toggle an outline, mirror a layer or rotate it.
- Arrow keys move one unit; Shift+arrow moves ten. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes; Ctrl+D duplicates; Delete removes a symbol.
- **Banner code** imports or copies the game's dot-separated code. Unknown source IDs are preserved and flagged in the preview.
- **PNG** saves the current view under the app's `exports/` folder and also offers a browser download, without selection handles or guides. Flat, banner and shield masks are preview/export presentations; they do not change the banner code.

The editor defaults to the full **1528×1528** banner canvas, as used by the game's Banner Builder tableau. **512 guide** marks the nominal central editing area without clipping artwork. Explicit 1024/512 central crops are available in Preview area. Flat, banner and round shield views share the chosen viewport, as does PNG export. Equipment can map the banner differently; these shape previews do not simulate cloth, lighting or each mesh's UV layout.

## Saving

**Save draft** writes a named JSON composition under `drafts/`. Drafts are available from the library's Drafts tab. Recent unsaved edits are also recovered from local browser storage.

**Save to module** updates the selected source banner's `banner_key` or `faction_banner_key`, including XSLT attribute bodies. Before writing, it creates a byte-for-byte backup under `backups/<timestamp>/ModuleData/...`. It checks the source code still matches the loaded value and writes through a temporary file. Other source formatting and attributes are preserved.

New compositions can be saved as drafts or exported as banner codes. To assign one to a clan or kingdom, select that source banner, import the new code, and use Save to module.

The app does not automatically edit faction armour colours, kingdom colour overrides, clan-heraldry configuration, or saved campaigns. The atlas builder creates PSDs, registers new symbol IDs and generates GUI source thumbnails. Compiling materials/textures and packing GUI sprite sheets remain separate stages.

## Build a 4×4 PSD from PNGs

Click **Build atlas**, choose a faction and **Alpha** or **Ornament**, then add PNG files. Use the arrows beside each file to change its slot order and click **Generate PSD atlas**.

- Every new PSD is **2048×2048**, split into sixteen **512×512** cells.
- Transparent margins are trimmed. The visible artwork's bounding rectangle is centred on the exact cell centre, horizontally and vertically.
- Oversized artwork is scaled down proportionally to fit; smaller artwork is never enlarged. Default padding is zero. Optional padding and an outside outline reserve room inside the same 512px cell.
- Odd pixel dimensions receive a half-pixel translation with antialiasing so their visible bounds can be centred exactly using integer PSD layer positions. This does not scale the image up.
- Images fill slots 0–15 from left to right, top to bottom. Image seventeen starts a second PSD. A batch supports up to 128 PNGs (128 MB total, 32 MB per file).
- Faction/category determine the name, for example `taom_banners_gondor_alpha_03.psd` or `taom_banners_rohan_ornaments_01.psd`. The next number is automatic; existing PSDs are never overwritten.
- **Install PSDs, XML entries and GUI thumbnails** installs the PSDs into `AssetSources/BannerIcons/`, adds a group and icon IDs to `ModuleData/banner_icons.xml`, and writes white artwork with transparent backgrounds to `GUI/SpriteParts/ui_taom_bannericons/<icon ID>.png`. These thumbnails are 256×256 and centred. Uncheck this option to save a complete review package without changing the module.
- Each atlas receives an unused group ID and a reserved block of icon IDs. Existing faction/category numbering is followed where available; occupied IDs and filenames, including Native icons and orphan GUI PNGs, are avoided. Each XML icon records the exact material name and slot index 0–15.
- Installation backs up the original XML under the build's `backups/ModuleData/` directory. It refuses stale XML and existing PSD/thumbnail targets, and removes files created by the import if a copy fails before the XML commit. Newly installed symbols appear in the external editor immediately, including artwork whose game material has not yet been compiled.

Each PSD includes a black background, one editable game-mask layer per PNG, hidden layers retaining the placed original colours, and Photoshop guides at the cell boundaries. The composite uses green for fill and red for an optional outline, matching the game's mask convention. Grid lines and centre crosses appear only in the separate review PNG, never in the game texture.

The complete build is retained in `atlas-builds/<batch>/`: PSDs, flattened `.mask.png` atlases, `.preview.png` review grids, byte-for-byte original PNGs under `sources/`, transparent GUI PNGs under `thumbnails/`, proposed `banner_icons.xml`, `banner_icons.additions.xml`, and `manifest.json` recording source-to-ID mapping, group IDs, texture indexes, scale, verified centres, installation paths and XML backup. IDs in a review-only package are proposals; rebuild before installing if module registrations have changed.

Transparent PNGs work directly. For opaque black/white artwork, choose **White artwork on black background** or **Black artwork on white background** under Image and output options. Fully opaque PNGs in transparency mode generate a warning because their entire rectangle becomes the symbol.

The same workflow is available for batches supplied through chat:

```powershell
node .\build-atlas.mjs --faction gondor --type alpha --input 'R:\TAOM\incoming-banners'
node .\build-atlas.mjs --faction rohan --type ornament --input 'R:\TAOM\incoming-ornaments' --no-install
```

Folder input uses natural filename order (`2.png` before `10.png`). Explicit PNG arguments retain their supplied order. Run `npm run atlas -- --help` for padding, outline, mask mode, output directory and atlas-number options. The existing 4096px source PSDs are preserved; newly generated ones use the requested 2048px canvas.

## Artwork and cache

To rebuild existing registered atlases from ID-named PNGs, use the XML-aware workflow below. Input directories are searched in order, so original high-resolution thumbnails can take priority over GUI sprites. It preserves each material name and `texture_index`, including gaps; unused cells are black. It uses the same downscale-only sizing and exact visible-bounds centring as the new-atlas builder.

```powershell
node .\regenerate-atlases.mjs --input 'C:\path\to\original-thumbnails' --input 'R:\TAOM\lotraom-assets\v1.5\TAOM\GUI\SpriteParts\ui_taom_bannericons'
node .\regenerate-atlases.mjs --install-build 'R:\TAOM\TAOM-Banner-Editor\atlas-builds\regenerate-<batch>'
```

The first command stages every registered PSD and checks each saved composite for exact centring, valid mask channels and empty unregistered slots. Review `all-atlases.png` and individual preview grids. The second command verifies that the XML and original PSDs have not changed, saves byte-for-byte backups under the batch's `originals/` directory, then replaces the module PSDs. `regeneration.json` records source paths, hashes, scaling, placement, backup location and installation status. `--install` can build and install in one command. Unregistered PSDs and the source XML are preserved. Game texture compilation remains separate.

Native symbols, materials and background geometry come from the installed game's Native TPAC packages. Native BC7 textures are decoded locally. TAOM's development texture TPAC files contain metadata but no pixels, so the editor reads the merged images in `AssetSources/BannerIcons/*.psd`. Red is the outline mask; green is the fill mask, matching the game shader.

Startup and Reload refresh source XML/XSLT and changed PSD composites. After changing asset registrations/material packages, use Module settings → Rebuild asset cache. Generated data lives under `cache/`. Extraction details are in `logs/extraction.log` after a rebuild.

Some existing source banners reference undefined symbol IDs (`17299`, `17358`, `17104`, `17371`, `17281`) or palette IDs (`124`, `128`, `132`, `144`, `145`). The editor displays warnings for affected banners and preserves those values. No source data was changed to resolve them.

## Development

```powershell
npm ci
npm run extract
npm start
npm test
dotnet publish desktop-shell/BannerStudio.csproj -c Release -o app -p:PublishSingleFile=true --self-contained false -r win-x64
```

Tests round-trip every real XML/XSLT banner, check targeted source replacements, malformed codes and signed values, and verify backups/conflict detection against temporary copies. Atlas tests check asymmetric transparency, odd-dimension centring, proportional downscaling, alpha/outline masks, PSD layer coordinates, overflow into a second atlas and protection of existing files. See `research/banner-format.md` for the rendering findings.

## Dependencies

The vendored TPAC reader derives from TpacTool by szszss and the local Bannerlord Viewport adaptations. Its MIT licence is retained at `third_party/TpacTool/LICENSE`. The extractor also uses BCnEncoder.Net, lz4net and JetBrains.Annotations; the desktop shell uses Microsoft.Web.WebView2. Node dependencies and exact versions are recorded in `package-lock.json`.
