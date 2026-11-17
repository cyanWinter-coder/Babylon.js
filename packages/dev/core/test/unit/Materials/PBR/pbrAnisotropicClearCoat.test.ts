import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
// PBRMaterial serialization depends on the ColorCurves parser side effect.
import "core/Materials/colorCurves";
import { NullEngine } from "core/Engines/nullEngine";
import { Logger } from "core/Misc/logger";
import { PBRMaterial } from "core/Materials/PBR/pbrMaterial";
import { PBRMaterialDefines } from "core/Materials/PBR/pbrBaseMaterial";
import { type MaterialAnisotropicDefines } from "core/Materials/PBR/pbrAnisotropicConfiguration";
import { type MaterialClearCoatDefines } from "core/Materials/PBR/pbrClearCoatConfiguration";
import { EffectFallbacks } from "core/Materials/effectFallbacks";
import { type Effect } from "core/Materials/effect";
import { MaterialFlags } from "core/Materials/materialFlags";
import { Texture } from "core/Materials/Textures/texture";
import { Vector2 } from "core/Maths/math.vector";
import { MeshBuilder } from "core/Meshes/meshBuilder";
import { Scene } from "core/scene";

const glslAnisotropic = readFileSync(new URL("../../../../src/Shaders/ShadersInclude/pbrBlockAnisotropic.fx", import.meta.url), "utf8");
const wgslAnisotropic = readFileSync(new URL("../../../../src/ShadersWGSL/ShadersInclude/pbrBlockAnisotropic.fx", import.meta.url), "utf8");
const glslClearCoat = readFileSync(new URL("../../../../src/Shaders/ShadersInclude/pbrBlockClearcoat.fx", import.meta.url), "utf8");
const wgslClearCoat = readFileSync(new URL("../../../../src/ShadersWGSL/ShadersInclude/pbrBlockClearcoat.fx", import.meta.url), "utf8");
const glslFinalLighting = readFileSync(new URL("../../../../src/Shaders/ShadersInclude/pbrBlockFinalLitComponents.fx", import.meta.url), "utf8");
const glslReflectance = readFileSync(new URL("../../../../src/Shaders/ShadersInclude/pbrBlockReflectance.fx", import.meta.url), "utf8");
const glslDirectLighting = readFileSync(new URL("../../../../src/Shaders/ShadersInclude/lightFragment.fx", import.meta.url), "utf8");

describe("PBR anisotropic clear coat integration", () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine({
            renderHeight: 256,
            renderWidth: 256,
            textureSize: 256,
        });
        scene = new Scene(engine);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        scene.dispose();
        engine.dispose();
    });

    it("enables both texture-backed lobes in the same shader variant", () => {
        const material = new PBRMaterial("combined", scene);
        const mesh = MeshBuilder.CreateSphere("sphere", {}, scene);
        const anisotropyTexture = new Texture(null, scene);
        const clearCoatTexture = new Texture(null, scene);
        const clearCoatRoughnessTexture = new Texture(null, scene);

        material.anisotropy.isEnabled = true;
        material.anisotropy.texture = anisotropyTexture;
        material.anisotropy.direction = new Vector2(0.6, 0.8);
        material.anisotropy.intensity = 0.75;
        material.clearCoat.isEnabled = true;
        material.clearCoat.texture = clearCoatTexture;
        material.clearCoat.textureRoughness = clearCoatRoughnessTexture;
        material.clearCoat.useRoughnessFromMainTexture = false;

        const defines = new PBRMaterialDefines();
        const anisotropyDefines = defines as unknown as MaterialAnisotropicDefines;
        const clearCoatDefines = defines as unknown as MaterialClearCoatDefines;
        material.anisotropy.prepareDefinesBeforeAttributes(anisotropyDefines, scene, mesh);
        material.clearCoat.prepareDefinesBeforeAttributes(clearCoatDefines, scene);

        expect(defines.ANISOTROPIC).toBe(true);
        expect(defines.ANISOTROPIC_TEXTURE).toBe(true);
        expect(defines.CLEARCOAT).toBe(true);
        expect(defines.CLEARCOAT_TEXTURE).toBe(true);
        expect(defines.CLEARCOAT_TEXTURE_ROUGHNESS).toBe(true);
        expect(defines.CLEARCOAT_USE_ROUGHNESS_FROM_MAINTEXTURE).toBe(false);
    });

    it("falls back from clear coat and anisotropy independently", () => {
        const defines = {
            CLEARCOAT_BUMP: true,
            CLEARCOAT_TINT: true,
            CLEARCOAT: true,
            ANISOTROPIC: true,
        };
        const fallbacks = new EffectFallbacks();
        let rank = 0;
        rank = new PBRMaterial("coat", scene).clearCoat.addFallbacks(defines as MaterialClearCoatDefines, fallbacks, rank);
        rank = new PBRMaterial("anisotropy", scene).anisotropy.addFallbacks(defines as MaterialAnisotropicDefines, fallbacks, rank);

        let shaderDefines = "#define CLEARCOAT_BUMP\n#define CLEARCOAT_TINT\n#define CLEARCOAT\n#define ANISOTROPIC";
        shaderDefines = fallbacks.reduce(shaderDefines, {} as Effect);
        shaderDefines = fallbacks.reduce(shaderDefines, {} as Effect);
        shaderDefines = fallbacks.reduce(shaderDefines, {} as Effect);
        shaderDefines = fallbacks.reduce(shaderDefines, {} as Effect);

        expect(rank).toBe(4);
        expect(shaderDefines).not.toContain("CLEARCOAT_BUMP");
        expect(shaderDefines).not.toContain("CLEARCOAT_TINT");
        expect(shaderDefines).not.toContain("#define CLEARCOAT\n");
        expect(shaderDefines).not.toContain("ANISOTROPIC");
    });

    it("decodes anisotropy direction and strength from the documented texture channels", () => {
        for (const shader of [glslAnisotropic, wgslAnisotropic]) {
            expect(shader).toMatch(/(?:anisotropyMapData\.rg|amd)[^;\n]*\* 2\.0 - 1\.0/);
            expect(shader).toMatch(/anisotropy[^;\n]*\* anisotropyMapData\.b/);
            expect(shader).toContain("clamp(anisotropy * anisotropyMapData.b, -1.0, 1.0)");
            expect(shader).toMatch(/anisotropyDirectionLengthSquared > 1e-8/);
        }

        expect(glslAnisotropic).toContain("float anisotropy = clamp(vAnisotropy.b, -1.0, 1.0)");
        expect(wgslAnisotropic).toContain("var anisotropy: f32 = clamp(vAnisotropy.b, -1.0, 1.0)");
    });

    it("keeps clear coat and anisotropic base energy bounded", () => {
        const ior = 1.5;
        const iorMinusOne = 1 - ior;
        const iorPlusOne = 1 + ior;
        const f0 = Math.pow(-iorMinusOne / iorPlusOne, 2);

        for (const ndotv of [0.001, 0.1, 0.5, 0.9, 1]) {
            for (const intensity of [0, 0.5, 1, 2]) {
                const fresnel = f0 + (1 - f0) * Math.pow(1 - ndotv, 5);
                const coat = Math.min(1, Math.max(0, fresnel * Math.min(1, Math.max(0, intensity))));
                const base = 1 - coat;
                expect(Number.isFinite(coat)).toBe(true);
                expect(coat + base).toBeCloseTo(1, 12);
            }
        }

        expect(glslClearCoat).toMatch(/clearCoatIntensity = saturate\(clearCoatIntensity\)/);
        expect(wgslClearCoat).toMatch(/clearCoatIntensity = saturate\(clearCoatIntensity\)/);
        expect(glslClearCoat).toMatch(/fresnelIBLClearCoat = saturate\(fresnelIBLClearCoat \* clearCoatIntensity\)/);
        expect(wgslClearCoat).toMatch(/fresnelIBLClearCoat = saturate\(fresnelIBLClearCoat \* clearCoatIntensity\)/);
        expect(glslFinalLighting).toContain("finalIrradiance *= clearcoatOut.conservationFactor");
        expect(glslReflectance).toContain("colorSpecularEnvironmentReflectance *= clearcoatOut.conservationFactor");
        expect(glslFinalLighting).toContain("finalClearCoatScaled *= clearcoatOut.energyConservationFactorClearCoat");
        expect(glslDirectLighting).toContain("info.specular *= info.clearCoat.w");
    });

    it("round-trips anisotropic and clear coat parameters through serialization and cloning", () => {
        const material = new PBRMaterial("roundtrip", scene);
        material.anisotropy.isEnabled = true;
        material.anisotropy.intensity = 0.65;
        material.anisotropy.direction = new Vector2(-0.28, 0.96);
        material.anisotropy.legacy = true;
        material.anisotropy.texture = new Texture("anisotropy.png", scene);
        material.anisotropy.texture.level = 0.7;

        material.clearCoat.isEnabled = true;
        material.clearCoat.intensity = 0.85;
        material.clearCoat.roughness = 0.12;
        material.clearCoat.indexOfRefraction = 1.42;
        material.clearCoat.remapF0OnInterfaceChange = false;
        material.clearCoat.texture = new Texture("clearCoat.png", scene);
        material.clearCoat.texture.level = 0.8;
        material.clearCoat.textureRoughness = new Texture("clearCoatRoughness.png", scene);
        material.clearCoat.useRoughnessFromMainTexture = false;
        material.clearCoat.isTintEnabled = true;
        material.clearCoat.tintColor.set(0.7, 0.8, 0.9);
        material.clearCoat.tintColorAtDistance = 0.4;
        material.clearCoat.tintThickness = 0.25;

        const serialized = material.serialize();
        expect(serialized.plugins.PBRAnisotropicConfiguration.intensity).toBe(0.65);
        expect(serialized.plugins.PBRClearCoatConfiguration.intensity).toBe(0.85);

        const parsed = PBRMaterial.Parse(serialized, scene, "");
        const clone = material.clone("clone");

        for (const candidate of [parsed, clone]) {
            expect(candidate.anisotropy.isEnabled).toBe(true);
            expect(candidate.anisotropy.intensity).toBe(0.65);
            expect(candidate.anisotropy.direction.x).toBeCloseTo(-0.28);
            expect(candidate.anisotropy.direction.y).toBeCloseTo(0.96);
            expect(candidate.anisotropy.legacy).toBe(true);
            expect(candidate.anisotropy.texture?.name).toBe("anisotropy.png");
            expect(candidate.anisotropy.texture?.level).toBe(0.7);

            expect(candidate.clearCoat.isEnabled).toBe(true);
            expect(candidate.clearCoat.intensity).toBe(0.85);
            expect(candidate.clearCoat.roughness).toBe(0.12);
            expect(candidate.clearCoat.indexOfRefraction).toBe(1.42);
            expect(candidate.clearCoat.remapF0OnInterfaceChange).toBe(false);
            expect(candidate.clearCoat.useRoughnessFromMainTexture).toBe(false);
            expect(candidate.clearCoat.texture?.name).toBe("clearCoat.png");
            expect(candidate.clearCoat.texture?.level).toBe(0.8);
            expect(candidate.clearCoat.textureRoughness?.name).toBe("clearCoatRoughness.png");
            expect(candidate.clearCoat.isTintEnabled).toBe(true);
            expect(candidate.clearCoat.tintColor.r).toBeCloseTo(0.7);
            expect(candidate.clearCoat.tintColor.g).toBeCloseTo(0.8);
            expect(candidate.clearCoat.tintColor.b).toBeCloseTo(0.9);
            expect(candidate.clearCoat.tintColorAtDistance).toBe(0.4);
            expect(candidate.clearCoat.tintThickness).toBe(0.25);
        }
    });

    it("rejects malformed parsed inputs without leaking NaNs into the material", () => {
        const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => {});
        const material = new PBRMaterial("malformed", scene);

        material.anisotropy.parse({ intensity: Number.POSITIVE_INFINITY, direction: [Number.NaN, 0], legacy: false }, scene, "");
        material.clearCoat.parse(
            {
                intensity: Number.NaN,
                roughness: Number.POSITIVE_INFINITY,
                indexOfRefraction: 0,
                tintColor: [Number.NaN, 0, 0],
                tintColorAtDistance: Number.POSITIVE_INFINITY,
                tintThickness: Number.NaN,
            },
            scene,
            ""
        );

        expect(material.anisotropy.intensity).toBe(1);
        expect(material.anisotropy.direction.x).toBe(1);
        expect(material.anisotropy.direction.y).toBe(0);
        expect(material.clearCoat.intensity).toBe(1);
        expect(material.clearCoat.roughness).toBe(0);
        expect(material.clearCoat.indexOfRefraction).toBe(1.5);
        expect(material.clearCoat.tintColor.r).toBe(1);
        expect(material.clearCoat.tintColor.g).toBe(1);
        expect(material.clearCoat.tintColor.b).toBe(1);
        expect(material.clearCoat.tintColorAtDistance).toBe(1);
        expect(material.clearCoat.tintThickness).toBe(1);
        expect(warn).toHaveBeenCalledTimes(8);
        expect(warn.mock.calls.every(([message]) => /PBR(?:Anisotropic|ClearCoat)Configuration\.parse:/.test(message))).toBe(true);
    });

    it("keeps texture enable flags as a usable fallback path", () => {
        const material = new PBRMaterial("fallback", scene);
        const mesh = MeshBuilder.CreateSphere("sphere", {}, scene);
        material.anisotropy.isEnabled = true;
        material.anisotropy.texture = new Texture(null, scene);
        material.clearCoat.isEnabled = true;
        material.clearCoat.texture = new Texture(null, scene);

        vi.spyOn(MaterialFlags, "AnisotropicTextureEnabled", "get").mockReturnValue(false);
        vi.spyOn(MaterialFlags, "ClearCoatTextureEnabled", "get").mockReturnValue(false);

        const defines = new PBRMaterialDefines();
        material.anisotropy.prepareDefinesBeforeAttributes(defines as unknown as MaterialAnisotropicDefines, scene, mesh);
        material.clearCoat.prepareDefinesBeforeAttributes(defines as unknown as MaterialClearCoatDefines, scene);

        expect(defines.ANISOTROPIC).toBe(true);
        expect(defines.ANISOTROPIC_TEXTURE).toBe(false);
        expect(defines.CLEARCOAT).toBe(true);
        expect(defines.CLEARCOAT_TEXTURE).toBe(false);
    });
});
