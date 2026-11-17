import { expect, test } from "@playwright/test";
import { getGlobalConfig } from "@tools/test-tools";
import { evaluateInitEngineForVisualization } from "../playwright/visualizationPlaywright.utils";

test("PBR anisotropy and clear coat keep textured highlights bounded", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "The reference image is captured with the Chromium WebGL2 implementation.");

    const config = getGlobalConfig();
    await page.setViewportSize({ width: 600, height: 400 });
    await page.goto(config.baseUrl + "/empty.html", { timeout: 0 });
    await page.waitForSelector("#babylon-canvas");
    await page.waitForFunction(() => window.BABYLON?.Tools);

    await page.evaluate(evaluateInitEngineForVisualization, {
        engineName: "webgl2",
        useLargeWorldRendering: false,
        useReverseDepthBuffer: "false",
        useNonCompatibilityMode: "false",
        baseUrl: config.baseUrl,
    });

    const stats = await page.evaluate(async () => {
        const B = window.BABYLON;
        const engine = window.engine;
        if (!engine) {
            throw new Error("PBR anisotropic clear-coat regression requires an initialized WebGL2 engine.");
        }
        engine.setSize(600, 400);

        const scene = new B.Scene(engine);
        scene.clearColor = new B.Color4(0.015, 0.018, 0.025, 1);
        scene.imageProcessingConfiguration.toneMappingEnabled = false;

        const camera = new B.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.35, 7.5, new B.Vector3(0, 0, 0), scene);
        camera.minZ = 0.1;
        camera.setTarget(B.Vector3.Zero());

        const key = new B.DirectionalLight("key", new B.Vector3(-0.8, -0.55, -1), scene);
        key.diffuse = new B.Color3(1, 0.93, 0.82);
        key.intensity = 0.9;
        key.specular = B.Color3.White();

        const fill = new B.DirectionalLight("fill", new B.Vector3(1, -0.25, -0.45), scene);
        fill.diffuse = new B.Color3(0.55, 0.72, 1);
        fill.intensity = 0.65;
        fill.specular = new B.Color3(0.75, 0.85, 1);

        const ambient = new B.HemisphericLight("ambient", new B.Vector3(0, 1, 0), scene);
        ambient.diffuse = new B.Color3(0.4, 0.5, 0.7);
        ambient.groundColor = new B.Color3(0.02, 0.02, 0.03);
        ambient.intensity = 0.35;

        const anisotropyPixels = new Uint8Array(4 * 4 * 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const index = (y * 4 + x) * 4;
                anisotropyPixels[index] = x < 2 ? 208 : 48;
                anisotropyPixels[index + 1] = 128;
                anisotropyPixels[index + 2] = 230;
                anisotropyPixels[index + 3] = 255;
            }
        }
        const anisotropyTexture = B.RawTexture.CreateRGBATexture(anisotropyPixels, 4, 4, scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
        anisotropyTexture.name = "anisotropy-map";
        anisotropyTexture.wrapU = B.Texture.CLAMP_ADDRESSMODE;
        anisotropyTexture.wrapV = B.Texture.CLAMP_ADDRESSMODE;

        const clearCoatPixels = new Uint8Array(4 * 4 * 4);
        for (let index = 0; index < clearCoatPixels.length; index += 4) {
            clearCoatPixels[index] = 225;
            clearCoatPixels[index + 1] = 30;
            clearCoatPixels[index + 2] = 255;
            clearCoatPixels[index + 3] = 255;
        }
        const clearCoatTexture = B.RawTexture.CreateRGBATexture(clearCoatPixels, 4, 4, scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
        clearCoatTexture.name = "clear-coat-map";
        clearCoatTexture.wrapU = B.Texture.CLAMP_ADDRESSMODE;
        clearCoatTexture.wrapV = B.Texture.CLAMP_ADDRESSMODE;

        const createMaterial = (name: string, angle: number) => {
            const material = new B.PBRMaterial(name, scene);
            material.albedoColor = new B.Color3(0.22, 0.36, 0.64);
            material.metallic = 0.55;
            material.roughness = 0.18;
            material.anisotropy.isEnabled = true;
            material.anisotropy.texture = anisotropyTexture;
            material.anisotropy.angle = angle;
            material.anisotropy.intensity = 0.9;
            material.clearCoat.texture = clearCoatTexture;
            material.clearCoat.useRoughnessFromMainTexture = true;
            material.clearCoat.intensity = 0.85;
            material.clearCoat.roughness = 0.05;
            material.clearCoat.indexOfRefraction = 1.5;
            return material;
        };

        const left = B.MeshBuilder.CreateSphere("left", { diameter: 2.5, segments: 64 }, scene);
        left.position.x = -1.55;
        const leftMaterial = createMaterial("left-material", 0);
        left.material = leftMaterial;

        const right = B.MeshBuilder.CreateSphere("right", { diameter: 2.5, segments: 64 }, scene);
        right.position.x = 1.55;
        const rightMaterial = createMaterial("right-material", Math.PI / 2);
        right.material = rightMaterial;

        const readEnergy = async () => {
            engine.beginFrame();
            scene.render();
            engine.endFrame();

            const pixels = await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
            let maximum = 0;
            let clipped = 0;
            let sum = 0;
            for (let index = 0; index < pixels.byteLength; index += 4) {
                const value = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
                maximum = Math.max(maximum, value);
                clipped += value >= 254 ? 1 : 0;
                sum += pixels[index] + pixels[index + 1] + pixels[index + 2];
            }
            return {
                maximum,
                clippedRatio: clipped / (pixels.byteLength / 4),
                average: sum / (pixels.byteLength / 4) / 3,
            };
        };

        await scene.whenReadyAsync();
        await readEnergy();

        for (const material of [leftMaterial, rightMaterial]) {
            material.clearCoat.isEnabled = false;
        }
        await scene.whenReadyAsync();
        const base = await readEnergy();

        for (const material of [leftMaterial, rightMaterial]) {
            material.clearCoat.isEnabled = true;
        }
        await scene.whenReadyAsync();
        const clearCoat = await readEnergy();
        await readEnergy();

        engine.beginFrame();
        scene.render();
        engine.endFrame();

        return { base, clearCoat };
    });

    expect(stats.base.clippedRatio).toBeLessThan(0.01);
    expect(stats.clearCoat.clippedRatio).toBeLessThan(0.01);
    expect(stats.clearCoat.maximum).toBeLessThanOrEqual(255);
    expect(Math.abs(stats.clearCoat.average - stats.base.average) / Math.max(stats.base.average, 1)).toBeLessThan(0.1);

    await expect(page).toHaveScreenshot("pbr-anisotropic-clearcoat.png", {
        timeout: 10000,
        threshold: 0.025,
        maxDiffPixelRatio: 0.01,
    });
});
