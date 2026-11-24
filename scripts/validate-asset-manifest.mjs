import { build } from "esbuild";
import { readFile, stat } from "node:fs/promises";

if (process.argv.length < 3) {
  console.error("Usage: node scripts/validate-asset-manifest.mjs <asset.json> [...]");
  process.exit(2);
}
const output = await build({ entryPoints: ["src/shared/asset-manifest.ts"], bundle: true,
  platform: "node", format: "esm", write: false });
const { parseAssetManifest } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
for (const path of process.argv.slice(2)) {
  try {
    if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error("Manifest is too large.");
    const asset = parseAssetManifest(JSON.parse(await readFile(path, "utf8")));
    console.log(`${asset.name}: ${asset.representations.length} representations, ${asset.materials.length} materials, ${asset.textures.length} texture inputs`);
  } catch (error) {
    console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
