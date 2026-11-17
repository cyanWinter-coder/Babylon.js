# PBR Anisotropy and Clear Coat

`PBRMaterial` exposes both features through material plugins:

- `material.anisotropy`: anisotropic base-layer specular highlight.
- `material.clearCoat`: physically based clear coat over the base layer.

Both configurations are serialized, cloned, included in active texture/animation tracking, and can be used together.

## API

```ts
const material = new PBRMaterial("coated-anisotropic", scene);

material.anisotropy.isEnabled = true;
material.anisotropy.direction.set(1, 0);
material.anisotropy.intensity = 0.8;
material.anisotropy.texture = anisotropyTexture;
material.anisotropy.legacy = false;

material.clearCoat.isEnabled = true;
material.clearCoat.intensity = 0.85;
material.clearCoat.roughness = 0.08;
material.clearCoat.indexOfRefraction = 1.5;
material.clearCoat.remapF0OnInterfaceChange = true;
material.clearCoat.texture = clearCoatTexture;
material.clearCoat.useRoughnessFromMainTexture = true;
```

Set `anisotropy.angle` to drive the scalar direction from an angle in radians. When a tangent vertex buffer is unavailable, the shader derives a cotangent frame from `MAINUV1`; a mesh must therefore have valid UV derivatives for tangent-space anisotropy.

## Texture Channels

Anisotropy texture:

- `R`: direction X, decoded from `[0, 1]` to `[-1, 1]`.
- `G`: direction Y, decoded from `[0, 1]` to `[-1, 1]`.
- `B`: strength multiplier, sampled linearly and multiplied by `anisotropy.intensity`.
- `A`: unused.

Clear coat texture:

- `R`: clear coat intensity multiplier.
- `G`: clear coat roughness multiplier when `useRoughnessFromMainTexture` is `true`.
- `A`: unused by the coat parameters.

When `useRoughnessFromMainTexture` is `false`, `textureRoughness.G` supplies roughness instead. `clearCoat.tintTexture` uses RGB for tint color and A for thickness.

Zero-length direction vectors in the anisotropy map fall back to the scalar direction. Non-finite strength values are clamped before the BRDF is evaluated.

## Energy Conservation

Direct lighting evaluates the clear coat and base lobes separately. The clear coat returns `1 - Fcoat` and that factor scales the base diffuse and specular contributions for the same light.

Image-based lighting uses two separate paths:

- `clearcoatOut.conservationFactor` scales base irradiance and base environment specular.
- `clearcoatOut.energyConservationFactorClearCoat` applies multiscatter compensation to the coat reflection.

Coat intensity and roughness are saturated after texture sampling. The coat Fresnel transmission is also saturated so a texture, a scalar override, or a malformed serialized value cannot make the base layer receive negative energy. The anisotropy strength is clamped to `[-1, 1]`, and its direction is normalized with a safe fallback before constructing the tangent frame.

## Shader Variants and Fallbacks

The main defines are:

- `ANISOTROPIC`: enable the anisotropic base-layer path.
- `ANISOTROPIC_TEXTURE`: sample the anisotropy direction/strength map.
- `ANISOTROPIC_LEGACY`: use the pre-6.4 anisotropy remapping.
- `CLEARCOAT`: enable the clear coat lobe.
- `CLEARCOAT_TEXTURE`, `CLEARCOAT_TEXTURE_ROUGHNESS`, `CLEARCOAT_TINT`, `CLEARCOAT_TINT_TEXTURE`, `CLEARCOAT_BUMP`: coat texture variants.

The GLSL and WGSL implementations are kept in sync. Fallbacks are registered independently: `CLEARCOAT_BUMP`, `CLEARCOAT_TINT`, `CLEARCOAT`, then `ANISOTROPIC`. Disabling `MaterialFlags.AnisotropicTextureEnabled` or `MaterialFlags.ClearCoatTextureEnabled` keeps the corresponding lobe active with scalar values and drops only the texture define.

## Parsing and Errors

Serialization remains backward compatible with the previous `clearCoat` and `anisotropy` objects. During parse, invalid inputs are replaced with documented defaults and a warning identifies the configuration, property, received value, material name, and fallback:

- A non-finite anisotropy intensity resets to `1`.
- A zero or non-finite anisotropy direction resets to `(1, 0)`.
- Non-finite coat intensity/roughness resets to `1`/`0`.
- A non-positive or non-finite coat IOR resets to `1.5`.
- A non-finite tint color, distance, or thickness resets to white, `1`, and `1`.

Parsing does not catch exceptions thrown by texture loading or custom plugins.

## Tests

Run the PBR unit suite:

```bash
npx vitest run --project=unit packages/dev/core/test/unit/Materials/PBR
```

Run the local screenshot and energy regression after building and serving the Babylon test server:

```bash
npx playwright test -c ./playwright.config.ts --project=integration packages/tools/tests/test/integration/pbrAnisotropicClearCoat.test.ts
```

Update the baseline intentionally with:

```bash
npx playwright test -c ./playwright.config.ts --project=integration packages/tools/tests/test/integration/pbrAnisotropicClearCoat.test.ts --update-snapshots
```

The unit tests cover texture channels, combined defines, independent fallbacks, parameter bounds, malformed input, and serialize/clone/parse round trips. The Playwright test compares the rendered material reference and checks clipped-pixel ratio and average output energy before and after enabling the coat.
The checked-in screenshot baseline is captured with Chromium WebGL2; other browsers skip the image comparison while still running the unit coverage.

## Performance

The combined path adds no render pass and no extra draw call. It samples at most one anisotropy texture and one clear-coat texture, and the added clamps/normalization run once per shaded pixel. The target is no more than a 10% frame-time increase for the reference material scene; validate on target hardware because texture bandwidth, anisotropy filtering, and shader compilation differ by engine.

## Known Limitations

- Classic `PBRMaterial` clear coat is isotropic. Anisotropic coat lobes are available through `OpenPBRMaterial`.
- Cotangent-frame anisotropy without tangents depends on stable UV derivatives and may show artifacts on meshes with degenerate UVs.
- The clear coat texture uses the glTF channel layout (`R` intensity, `G` roughness); other layouts require preprocessing or a material plugin.
- Texture flags are global. Disabling an anisotropy or clear-coat texture flag affects every material using that channel.
