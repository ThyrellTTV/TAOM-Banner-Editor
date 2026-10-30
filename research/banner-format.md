# Banner format and rendering findings

Inspected locally on 2026-10-30. The implementation uses the installed game and the current `v1.5/TAOM` development assets, rather than assuming that module-folder version numbers identify the installed engine build.

## Primary local evidence

- `bin/Win64_Shipping_Client/TaleWorlds.Core.dll`: `Banner`, `BannerData`, `BannerManager`.
  Inspected SHA-256: `7CAB040EFA5AB77274DC1299E9FA3ADAC0D3A1399DBCAB1F33830300DBDE19BD`.
- `Modules/Native/bin/Win64_Shipping_Client/TaleWorlds.MountAndBlade.View.dll`: `BannerVisual`, `Tableaus.BannerTextureCreator`.
- `Shaders/Sources/pbr_standart_pixel_functions.rsh`: `calculate_gui_color_and_stroke`, `banner_background_color_calculater`.
- Native and TAOM `ModuleData/banner_icons.xml`.
- TAOM `ModuleData/spkingdoms.xslt`, `spclans.xslt`, `taom_spkingdoms.xml`, `characters/clans.xml`, and culture definitions.
- Native `AssetPackages/*.tpac` and TAOM `Assets/BannerIcons` + `AssetSources/BannerIcons`.

Local decompilation working files are ignored by Git. No game binaries are copied into the application.

## Ten values per layer

| Offset | Meaning |
| --- | --- |
| 0 | Background mesh ID for layer zero; symbol ID for later layers |
| 1 | Primary colour palette ID |
| 2 | Secondary/outline colour palette ID |
| 3 | Width |
| 4 | Height |
| 5 | Centre position X |
| 6 | Centre position Y |
| 7 | Draw outline, 0 or 1 |
| 8 | Mirror horizontally, 0 or 1 |
| 9 | Rotation in whole degrees |

Layers concatenate with dots. The game converts degree values into a normalized turn with precision `1/360`. Width, height and position serialize as integers. The full texture measures 1528 units, with centre `(764,764)` and a nominal editable region of 512 units. Rotation maps counterclockwise into the browser's downward Y coordinate system.

`Banner.AddIconData` caps a normal banner at 33 total layers. The inspected deserializer accepts longer existing strings, and some TAOM sources use them. The app preserves imported long banners and warns, while preventing ordinary additions beyond 32 symbols.

The external parser is deliberately stricter about malformed input than the inspected game parser: it rejects incomplete groups instead of silently ignoring trailing fields.

## Icon lookup and texture layout

`banner_icons.xml` associates each symbol ID with a material name and texture index. `BannerVisual.ConvertToMultiMesh` divides the material's diffuse texture into a 4×4 atlas. Cell column is `index % 4`; row is integer division `index / 4`. This is atlas indexing, not a texture-array slice.

The material's slot zero supplies the mask atlas. The renderer crops the registered cell and applies the game shader's colour rules. Texture red encodes stroke, green encodes fill, and alpha multiplies the selected coverage:

```text
coverage = texture.alpha * (drawStroke * texture.red + texture.green)
rgb = outlineColour * texture.red + primaryColour * texture.green
```

Material alpha-test flags and thresholds are honoured. Browser resampling, output resolution and antialiasing may differ from the engine. The local preview is not a claim of pixel-for-pixel GPU equivalence.

TAOM source PSDs supply the merged RGBA bitmap. Their corresponding development TPAC texture assets contain dimensions/format/IDs but no pixel data. A reusable cache avoids decoding all PSDs on every UI request. Every registered symbol currently resolves to artwork; unresolved source *references* are reported separately.

## Backgrounds

The 36 backgrounds are actual meshes, not a list of guessed CSS patterns. Their triangle geometry and vertex colours are exported from Native TPACs. The shader interpolates between the two banner colours using vertex red. `BannerVisual` reverses the mesh factor-colour assignment for backgrounds: vertex-red 1 resolves to banner `ColorId`, and red 0 to `ColorId2`.

The app rasterizes this geometry into a reusable colour-weight mask and applies the banner's scale, translation, mirror and rotation. Backgrounds and icons share the game's logical 1528-unit space.

## View and presentation

The game has two distinct cameras: `CreateDefaultBannerCamera` uses the central third (approximately 509.33 units), whereas `CreateNineGridBannerCamera` covers the full 1528-unit texture. Native `GUI/Prefabs/BannerBuilder/BannerBuilderScreen.xml` explicitly sets `IsNineGrid="true"` on its editing tableau. `BannerTableauWidget` forwards this setting to its texture provider. The earlier implementation incorrectly treated the 512-unit editable area as the universal preview crop.

The external editor now defaults to the complete 1528-unit canvas. The central 512-unit area is an optional dashed guide and does not clip artwork. Explicit central 1024/512 crop views remain available for inspection. Drawing, selection handles, pointer mapping and PNG export share the same viewport transform. Existing banner codes and layer sizes/positions are preserved.

The app's round shield and banner silhouettes are presentation masks, not extracted in-game equipment meshes. `standart.rsh` samples a banner using the equipment mesh's second UV channel when present, or a material-specific scale/offset otherwise. This prevents one flat crop from representing every shield or flag exactly. Shape previews never alter game codes. Cloth simulation and game lighting are outside this 2D editor.

## Source persistence

TAOM mixes three source forms: ordinary XML attributes, literal elements inside XSLT replacement templates, and text inside `xsl:attribute name="banner_key"` within identity-copy templates. All three are indexed and saved in place. The editor preserves unrelated source bytes and backs up the original before writing.

This is source discovery for the current TAOM conventions, not a complete evaluator of arbitrary XSLT transformations or module load order. The app does not read or mutate campaign saves.
