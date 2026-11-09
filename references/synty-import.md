# Importing Synty POLYGON assets into s&box

How to prepare Synty POLYGON packs for s&box: which download to use, the unit and axis rules,
`.vmdl` and `.vmat` recipes, collision, and how to measure the results. It was learned on a
project that imported about a dozen POLYGON packs with a scripted importer. Your project's own
rules come first. Check each recipe against the installed engine: the shader and modeldoc
formats below are from engine builds of autumn 2026.

## Contents

1. Getting the files
2. Folder layout and repository
3. Units and axes
4. Models (`.vmdl`)
5. Materials (`.vmat`)
6. Collision
7. Building an importer
8. Measuring and placing Synty assets

## 1. Getting the files

- **Use the Source Files zip for every pack** (`POLYGON_<Pack>_SourceFiles_v<N>.zip`). It holds
  every FBX and texture the Unity package ships, byte for byte. It is the smallest download, and
  its FBX names match SyntyDex ids. (The Unity package renames a few, for example
  `Sappling` to `Sapling`.)
- **Also get the Unity package** when either of these is true:
  - its `MaterialList_*.txt` names many slots with no texture of the same name (roughly more
    than 15). The material recipe for those slots (tint, alpha, emission, metallic, smoothness)
    exists only in the Unity `.mat` YAML. Packs built around one atlas, with 7 to 11 slots, can
    be mapped by hand.
  - you want its demo-scene building compositions, which exist only in the Unity `.unity` or
    `.prefab` files.

  Read the Unity package as text data only (the `.mat`, `.prefab` and `.unity` YAML). Never
  import it, and still take FBX and textures from Source Files.
- **Never use the Unreal download.** It is binary `.uasset`/`.umap` with the same geometry split
  into more pieces.
- **No format has LODs,** so plan triangle budgets with that in mind.
- Folder layouts inside the zips vary between packs and versions, so match files by basename.
  Skip `Unreal/`, `OBJ/`, `Unsupported/` and character folders. Some packs bundle a full copy of
  POLYGON Generic: prefer each pack's own copy of a file over the bundled Generic one, and import
  Generic once, as its own pack.
- The store blocks browser automation (Cloudflare). If you script bulk downloads, give the user
  a script to run in their own signed-in browser. Run it dry first.
- **Licence:** check the Synty EULA (and the subscription terms, for SyntyPass) before you commit
  source assets, especially to a public repository or a published package.

## 2. Folder layout and repository

One folder per pack, all lower case:

```text
Assets/synty/<pack>/fbx/<name>.fbx             render FBX, plus <name>_collision.fbx when Synty ships one
Assets/synty/<pack>/textures/<tex>.png|tga     only the textures the materials use
Assets/synty/<pack>/materials/<slot>.vmat      one per material slot (plus emissive and alternate variants)
Assets/synty/<pack>/models/<name>.vmdl         asset path synty/<pack>/models/<name>.vmdl
```

- Import only what you cite (the models a design or brief names), not whole kits. Whole kits
  and alternate atlases cost hundreds of MB, and a trimmed import of about a dozen packs came to
  roughly 60 MB.
- Set up Git LFS before the first asset commit: `*.fbx`, `*.png`, `*.tga`, `*.jpg`, `*.tif`,
  `*.psd`, `*.blend`. Compiled files (`*.*_c`) stay gitignored.
- Keep `.vmdl` and `.vmat` files with LF line endings and write them only when their bytes
  change, so a re-run produces no diff. A writer that turns everything into CRLF churns every
  file.

## 3. Units and axes

- **Units differ by pack, and the s&box importer ignores the FBX `UnitScaleFactor`.** Most packs
  store raw metres, so use `import_scale = 39.3700787` (inches per metre). POLYGON Generic and a
  few others store raw centimetres, so use `0.393700787`. Some exports carry a 0.01 node scale
  instead, which makes the world values hundredths of a metre.
- **Choose the scale per file, not per pack.** Compare the FBX's extents (widened to include the
  origin) with the SyntyDex size, and pick the unit with the smallest log error. Record that
  error, and treat a large one as a finding.
- **Axes:** Synty FBX files are Y-up. After import, engine `(x, y, z)` = FBX `(z, x, y)`: engine
  +z is up, +y is the Synty width and +x the Synty depth. Origins are the FBX origins. They are
  often not the base or the centre (a street lamp's pole can sit almost 1 m off its origin).
- Blender world to engine is `(-y, x, z)`, which matters when you profile meshes in Blender.

## 4. Models (`.vmdl`)

Write one `.vmdl` per FBX as modeldoc text:

- `RenderMeshFile` → the FBX, with `import_scale` from section 3 and no origin alignment.
- `PhysicsShapeList` → a `PhysicsMeshFile` (see section 6) at the same scale, with
  `collision_tags = "solid"`.
- `DefaultMaterialGroup` `remaps`: `from = "<fbx material>.vmat"`, `to = "synty/<pack>/materials/<slot>.vmat"`.
- `model_archetype = "static_prop_model"`.
- Some FBX files contain Unreal collision hulls (`UCX_`, `UBX_`, `USP_`, `UCP_` mesh names). Add
  them to the `import_filter` `exception_list` so they stay out of the render and physics meshes.

**Material remaps match by name only.** When one FBX material is shared by meshes that use
different Synty slots (a window frame and its glass, for example), rewrite the FBX to clone that
material under a new name for the second mesh. Otherwise one of the two slots is lost. The
`MaterialList_*.txt` (`Prefab Name` → `Mesh Name` → `Slot`) tells you which mesh uses which slot.

## 5. Materials (`.vmat`)

Use `shaders/complex.shader`, with one `.vmat` per Synty slot.

Where each slot's recipe comes from, in order:
1. the Unity `.mat` YAML;
2. the `MaterialList` maps;
3. the slot's texture hint, as in `Slot: Name (Texture)`;
4. a texture named after the slot itself;
5. a texture of the same name already imported from another pack;
6. a neutral grey, with a note in the import report.

Record where each recipe came from in a comment at the top of the `.vmat`.

- **Colour:** `TextureColor "<texture>"`, or a constant `"[r g b 1]"` when the slot has no
  texture. A Unity tint becomes `g_vColorTint`.
- **Roughness and metal:** Unity `_Smoothness` s → `TextureRoughness` 1 - s; `_Metallic` →
  `g_flMetalness`. Default to rough 0.8, metal 0.
- **Cutout:** if the colour texture's alpha channel has a real share of low values (above
  roughly 0.2 % below 128), set `F_ALPHA_TEST 1`, `TextureTranslucency` = an alpha-only PNG
  extracted from that texture, and `g_flAlphaTestReference "0.500"`. Without this check,
  fences and foliage silently render opaque.
- **Translucent:** Unity `_Surface = 1` → `F_TRANSLUCENT 1`, with `g_flOpacityScale` from the
  tint's alpha.
- **Emissive:** write a second `<slot>_emissive.vmat` with `F_SELF_ILLUM 1`,
  `TextureSelfIllumMask`, `g_flSelfIllumScale "1.0"` and `g_flSelfIllumAlbedoFactor "0.0"`. Use
  it where the lights should glow, and keep the plain one elsewhere.
- **Glass never samples the atlas.** Synty glass slots name the pack atlas as their albedo,
  because their Unity shaders draw glass from tint and smoothness, while the glass UVs span the
  atlas. Sampled as translucent, that renders as an atlas collage. Make glass a flat tinted
  translucent constant instead:
  - clear glass: about (0.62, 0.74, 0.80) at opacity 0.35, roughness 0.1;
  - dark glass: darker, at about opacity 0.6;
  - grunge glass: greyer, at about opacity 0.5;
  - `Opaque` glass slots: opaque.
- **Mirrors** are opaque pale blue-grey, about (0.74, 0.80, 0.85), metalness about 0.35,
  roughness 0.12. A fully metallic mirror has no diffuse term and renders black wherever the
  room's probe has little to reflect. There is no planar reflection.
- Triplanar Unity shaders can be approximated with their base texture. Say so in the provenance
  comment.
- **Alternate atlases** (`<atlas>_01_B`, `_01_C` and so on) are colour variants that share the
  UVs. Import them only when they're used.

## 6. Collision

- Use Synty's own `<name>_Collision.fbx` when the pack ships one. Otherwise use the render mesh
  as the physics mesh, and record which you used for each model.
- **Collision can differ from the render mesh:** hulls can have floors or ledges the render mesh
  lacks, and large assemblies can have partial collision. Let in-engine traces decide what a
  player can stand on, and let the physical player prove what a player can walk on.

## 7. Building an importer

A scripted importer paid for itself quickly. What worked:
- Read straight from the zips, and extract only the files you cite.
- Write files only when their bytes change, so re-runs are cheap and produce no diff.
- Write the `.vmdl` and `.vmat` files offline. The editor isn't needed for that.
- Ask the running editor to compile them in batches through `scripts/editor.js`, under the
  editor lock.
- Read the bounds back from the compiled `.vmdl_c` files and write a manifest: id, model path,
  unit and its error, materials, collision source, and notes.
- Give the importer its own lock. Make deleting stale files an explicit `--prune` that is
  refused on filtered runs. A filtered run must never drop other packs' manifest rows: compare
  changes per id.
- Needs: zip reading, a minimal FBX parser (materials, mesh names, bounds, rewriting material
  names), and an image library for alpha detection. Fail loudly if the image library is
  missing, rather than treating every material as opaque.
- Keep the SyntyDex index (every POLYGON asset with sizes and triangle counts) as a
  generated, gitignored file, with the script that rebuilds it.
- Check the first model of each pack in the editor (a thumbnail or a placed shot) before
  importing the rest.

## 8. Measuring and placing Synty assets

- **Kit pieces and catalogues mislead.**
  - A "storey" stair can be half of a dog-leg.
  - A catalogue size can describe an assembly whose FBX is only one part, such as a crane mast
    whose top is a separate file in the zip.
  - Names don't tell you scale: a "chain anchor" can be a 0.4 m fitting.

  Measure every load-bearing assumption from the compiled bounds and the source mesh.
- **Bounds give the extent, not a usable surface.** Check source-mesh planes for tops, and face
  normals, spans and UVs for undersides. A roof's bounds can hide a missing ceiling.
- **Measure the bottoms of composed meshes, not their pivots.** Measure a prop's axes from its
  compiled bounds, because a long prop's length can lie along local Y.
- **Use Blender in background mode** (`blender --background --python`) to profile meshes without
  the editor lock: footprints at several heights, BVH ray-cast heightmaps of roofs and decks, and
  clear spans of large assemblies.
- **An n-gon with duplicated corner vertices can fail to render in s&box** even when Blender
  shows it closed and facing outward. Profile vertex counts and duplicate corners before
  blaming normals or scale.
- **Recolouring:** renderer tint is a linear multiply clamped to 1, so a red asset can't be
  tinted blue, yellow or white. Use `ModelRenderer.MaterialOverride` with one of the pack's
  alternate atlases. `MaterialOverride` replaces every slot, glass included, which makes windows
  opaque. To keep the glass, override the body slot only, or bake UV offsets into separate
  models.
- **Cross-pack atlases on vehicles give unpredictable colours.** Read each model's material
  remaps first, and treat only the same atlas's numbered `_A`/`_B`/`_C` siblings as colour
  variants.
- Stopped-editor `ModelRenderer.Bounds` are world bounds. Subtract the parent's offset before
  comparing them with local measurements.
