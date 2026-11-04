# Next stage: game deployment and emblem generation

Inspected and implemented 2026-10-30. Automatic banner resource compilation and reviewed deployment are implemented for Bannerlord 1.5.6. AI generation remains a future stage.

## Current boundary

The editor builds/reviews atlas sources, preserves existing registrations when editing, registers new imports and unused slots, and writes transparent source thumbnails. It can preview PSD and PNG artwork independently of the game. A successful editor preview does not prove that the game has imported/compiled those sources. Clan/kingdom banner-code mirroring already exists; atlas deployment is a separate operation.

TaleWorlds documents a two-stage GUI workflow: run its sprite generator, then import generated sheets through the Modding Kit resource browser to create game resource packages. The official guide also explains sprite category loading. [Official UI sprite workflow](https://moddocs.bannerlord.com/asset-management/generating_and_loading_ui_sprite_sheets/).

## Installed sprite generator

The configured Bannerlord installation contains `bin/Win64_Shipping_wEditor/TaleWorlds.TwoDimension.SpriteSheetGenerator.exe` and `TaleWorlds.TwoDimension.SpriteSheetGenerator.Library.dll`.

Static inspection of the installed executable's `Program` and the library's `SpriteEditorDomain` identified:

- `SourceDirectory=<absolute path>` selects the input root.
- `CollectionType=AllAvailableModules` enumerates module directories below that root; `SingleModule` uses a different folder convention, so its help text should not be treated as proof of the same layout.
- `OutputType=Engine` selects engine output, with `Standalone` as the other mode.
- The recognised help switches are `help`, `-help` and `-h`; `--help` is not recognised in this binary. Default invocation processes the installation's modules.
- The executable ends with `Console.ReadKey()`. The public library entry point `SpriteEditorDomain.Start(configuration)` returns a success flag and is the better candidate for an unattended helper.

No generator was run against the live module during this investigation. No proprietary decompiled source is included in the repository or release package.

### Verified isolated generation

The next experiment was completed against the locally installed generator library on 2026-10-30:

- Copied all **375** source banner thumbnails and only their category packing configuration into a private `Modules/TAOM/GUI/SpriteParts/ui_taom_bannericons/` tree.
- Invoked `SpriteEditorDomain.Start` through a small .NET Framework bridge resolving assemblies from the configured game installation. No vendor DLLs were copied into the application or proposed release.
- Generated **two 4096×4096 RGBA sheets** and their `TAOMSpriteData.xml` mapping without launching Bannerlord and without the executable's `ReadKey` pause.
- Decoded both sheets and checked all **375 sprite rectangles pixel-for-pixel against the copied PNGs**, including transparency. Checked each generic sprite binding and sheet size.
- Built a review-only merge into the existing SpriteData, retaining `AlwaysLoad` and preserving the original XML blocks for `ui_custom_fonts`, `ui_loading`, `ui_taom`, and `ui_taom_career_system`.
- Verified **758 live input snapshots** across the development and installed modules after the run; none changed. No module writes or game deployment were performed.

The local experiment and logs live under `.tools/deployment-probe/20261030-200840/`; the shareable findings and review outputs are under `exports/game-deployment-investigation-20261030/`. These generated folders are ignored by Git and excluded from release packages.

Important implementation details found in the installed library:

- Engine output **empties the entire staged `AssetSources/GauntletUI` folder** before saving. Never point a banner-only generation job at the live module; that would remove other categories' generated source sheets.
- Its public `Start` method returns `true` after the jobs complete even when an individual domain's `Tick` has caught an exception. Exit status alone is insufficient. A production bridge must validate the expected XML, sheet count, dimensions, names, transparency and sprite contents before reporting success.
- A category-only generated SpriteData contains only that category. Installation must merge its category, sprite parts and sprite bindings into the complete existing mapping; replacing the entire XML would discard unrelated UI registrations.

## Texture and material compilation

Inspection of the managed engine APIs did not expose a complete unattended asset import/save command. Instead, `resource-compiler.mjs` now builds the focused banner resource formats directly, using the module's editable resource templates and a lossless binary reader/writer. No native import UI is required. It preserves existing GUIDs and opaque metadata fields, recomputes XXHash64 checksums for metadata/source/data segments, updates source information and dimensions, and emits matching runtime texture records in the profile's chosen format.

The current development and installed TAOM copies each have packages for all **24 registered atlas materials**, plus two banner thumbnail sheet textures. All 24 atlas texture packages, 24 material packages and their matched texture runtime caches are byte-identical between the two copies at inspection time. This proves the copies agree; it does **not** establish that compiled pixels match any future source edit.

TAOM's texture `.tpac` files here are small metadata packages. Actual texture data is stored in `RuntimeDataCache/*.rdc`. The probe matched **all 52 inspected texture packages** (26 per module) to a single-record RDC by its owner GUID in the cache header. The RDC filename is the TPAC **package GUID**, distinct from the texture asset GUID. Deploying only the `.tpac` therefore misses required texture data. The compiler supports this single-texture cache layout; it is not a general RDC importer.

TaleWorlds' [custom banner guide](https://moddocs.bannerlord.com/asset-management/creating_custom_banner_icons/) specifies texture import and a material using the `gui_color_and_stroke` shader with that texture in the diffuse slot. New materials need those settings; replacing an existing texture should retain existing material/texture identity and import settings.

Native validation completed using a disposable module with only Native/SandBoxCore/CustomBattle dependencies. Bannerlord loaded a newly generated texture, material and diffuse binding with the `gui_color_and_stroke` shader. A generated GUI sprite rendered successfully. A second run loaded a newly compiled **2048×2048** texture from a **4096×4096** template, confirming dimension/source information updates. The test helper's `Texture.GetPixelData` readback did not provide a trustworthy RGBA comparison, so it is not used as evidence of pixel fidelity; source/payload byte comparisons and actual engine rendering provide the checks instead.

The application then compiled a real registered atlas and all 375 thumbnails through its new deployment screen, producing three texture TPAC/RDC pairs, the banner material and merged sprite mappings. Deployment to two isolated module copies completed successfully with backups. Unit tests cover integrity, dimensions, ID retention, new diffuse references, category preservation, stale targets, a running game and transactional rollback.

The default remains **uncompressed RGBA8 with one mip**: 16 MiB for a 2048² texture and 64 MiB for a 4096² texture. Version 0.5 adds per-profile 1K/2K/4K output, BC1/BC3/BC7 encoding, optional full atlas mip chains, texture flags, a material template and custom material flags/blend/alpha cutoff. GUI sheets support RGBA8/BC3/BC7 and retain their generated dimensions, mappings and transparency. Compiled resolution changes resample each cell separately without changing editable source dimensions. BC compression is lossy. It requires metadata/resource formats verified in **1.5.6** and compatible editable banner/GUI templates already in the module; other game versions and arbitrary assets are rejected rather than silently converted.

The configured-settings integration run saved/reopened the profile, then built and deployed to two isolated module copies. Independent binary inspection confirmed a 1024² BC7 atlas with eleven mip levels from a 4096² source, the requested texture flags and material alpha cutoff of 0.6, plus BC3 GUI sheets. A disposable native module loaded that atlas/material successfully and rendered the existing Gondor emblem and newly added horse from the compressed GUI sheets. The 57-test suite also covers 1K/4K PSD centring, profile persistence, cell resampling, GPU block sizes and material field preservation.

## Implemented deployment workflow

1. **Prepare and review:** select the active profile and edited atlases; snapshot registry, source artwork, thumbnail inputs, existing SpriteData and compiled targets. Generate the banner category in isolation and merge its mapping while preserving unrelated categories.
2. **Compile:** automatically generate texture/material TPAC files and runtime RDC payloads for the selected atlas and packed GUI sheets. Retain GUIDs/settings for existing resources; use a compatible module banner material template for new ones. Keep the module name and relative source paths consistent with the engine's `$BASE/Modules/<module>/...` references.
3. **Verify:** resolve every registered material and its texture, match texture runtime data, confirm thumbnail mappings, and verify compiled outputs belong to the reviewed source build. Compiled package presence alone is not proof of freshness. Record hashes and a complete manifest.
4. **Deploy:** show the exact changed files and destination module. Copy only the selected atlas material/texture packages, associated RDC records, transparent thumbnail sources, regenerated banner GUI resources and merged registries. Back up originals, refuse stale targets and restore the entire affected set on failure. Do not replace the whole TAOM folder or include unrelated UI, binaries, scenes or campaign files.
5. **Game check:** require the game/editor to be closed during resource replacement, then check the new icon in the banner picker and on a banner/shield after restart. Engine messages explicitly identify external RDC changes as requiring restart. Deployment status describes the verified file transaction; visual checks in each mod remain a separate validation after restart.

The **Game deployment** review opens from **Atlas manager → Build game resources** after queued source edits have been installed. **Deploy reviewed resources** applies the reviewed file set to the development module and configured installed module, preserving unrelated UI categories independently in each copy. `compile-game-resources.mjs` provides the same workflow from the CLI. The profile's configured paths and matching `SubModule.xml` IDs provide the destinations; existing banner-code mirroring remains unchanged. No paid generation requests, game DLLs or proprietary decompiled implementation are included in the application.

## AI-assisted creation

The asset side is ready for a provider-independent flow:

1. Enter a description and optional reference image, faction/style and alpha/ornament category.
2. Generate a transparent monochrome emblem as a PNG, keeping the original output available for review.
3. Use the existing mask reader, proportional downscaling and exact centring to prepare it.
4. Preview it on the banner, then queue it as an atlas-slot replacement or a new registered import.
5. Install only after the user reviews the result; compilation uses the deployment stages above.

The remaining AI component is an image-generation provider adapter with cancellation, error reporting, generation metadata and a local credential store separate from mod profiles and shareable packages. No generation endpoint, paid request or credential has been added in this version. A first proof can use an externally generated PNG through the already working atlas manager/importer before embedding a provider.
