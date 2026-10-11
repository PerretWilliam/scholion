// Downloads the pinned llama.cpp release for this platform into src-tauri/resources/llama/,
// keeping only llama-server, the shared libraries it loads, and the licenses.
// Usage: node scripts/fetch-llama.mjs [target]   (target defaults to the host, e.g. darwin-arm64)
// Pins live in docs/architecture.md: update both together.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASE = "b11552";
const ASSETS = {
  "darwin-arm64": [
    "macos-arm64.tar.gz",
    "f4b33fe40d098033fb1a19a8a4a84383c4ca84c37b6a60d9f9a253f349b48c07",
  ],
  "darwin-x64": [
    "macos-x64.tar.gz",
    "b7977620cf5c30b8905caa45d7dbcc08766b5d4a94b3cde66ecf0323a495096f",
  ],
  // Vulkan builds load the CPU backends dynamically, so they also run without a GPU.
  "win32-x64": [
    "win-vulkan-x64.zip",
    "83dc16325b532ba603034719e8377e28ca5093c5d4370141a6522f1a0250386c",
  ],
  "linux-x64": [
    "ubuntu-vulkan-x64.tar.gz",
    "c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997",
  ],
};

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const asset = ASSETS[target];
if (!asset) {
  console.error(`No llama.cpp build for ${target}. Known: ${Object.keys(ASSETS).join(", ")}`);
  process.exit(1);
}
const [suffix, sha256] = asset;
const name = `llama-${RELEASE}-bin-${suffix}`;
const outDir = path.join(import.meta.dirname, "..", "src-tauri", "resources", "llama");
const stamp = path.join(outDir, "VERSION");

if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === name) {
  console.log(`${name} already in place.`);
  process.exit(0);
}

const url = `https://github.com/ggml-org/llama.cpp/releases/download/${RELEASE}/${name}`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== sha256) throw new Error(`Checksum mismatch for ${name}: got ${actual}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "llama-"));
try {
  const archivePath = path.join(work, name);
  const extracted = path.join(work, "x");
  fs.writeFileSync(archivePath, archive);
  fs.mkdirSync(extracted);
  // bsdtar (macOS, Windows 10+) also reads zip files.
  execFileSync("tar", ["-xf", archivePath, "-C", extracted]);
  const server = fs
    .readdirSync(extracted, { recursive: true })
    .find((f) => /^llama-server(\.exe)?$/.test(path.basename(f)));
  if (!server) throw new Error(`llama-server not found in ${name}`);
  const srcDir = path.join(extracted, path.dirname(server));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of selectFiles(srcDir)) {
    // Symlinks become regular files, so the bundler never sees a link.
    const dest = path.join(outDir, file);
    fs.copyFileSync(fs.realpathSync(path.join(srcDir, file)), dest);
    fs.chmodSync(dest, 0o755);
  }
  fs.writeFileSync(stamp, `${name}\n`);
  console.log(`Installed ${name} into ${path.relative(process.cwd(), outDir)}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

/**
 * llama-server, the licenses, and every shared library under the name the loader asks for:
 * the major-version link (`libllama.0.dylib`, `libllama.so.0`) or the plain file
 * (`libggml-vulkan.so`, `ggml.dll`). Other tools and their `-impl` libraries are dropped.
 */
function selectFiles(dir) {
  const files = fs.readdirSync(dir);
  const isLink = (f) => fs.lstatSync(path.join(dir, f)).isSymbolicLink();
  const linkTargets = new Set(
    files.filter(isLink).map((f) => path.basename(fs.readlinkSync(path.join(dir, f)))),
  );
  return files.filter((f) => {
    if (/^llama-server(\.exe)?$/.test(f) || f.startsWith("LICENSE")) return true;
    if (/^(lib)?llama-(?!server-impl)[\w-]+-impl\./.test(f)) return false;
    if (isLink(f)) return /^[^.]+\.(0\.dylib|so\.0)$/.test(f);
    return /\.(dll|dylib|so)$/.test(f) && !linkTargets.has(f);
  });
}
