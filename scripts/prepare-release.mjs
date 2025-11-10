import { promises as fs } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/prepare-release.mjs <version>");
  process.exit(1);
}

const rootDir = new URL("..", import.meta.url).pathname;

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, data) => {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const updateDependencies = (pkg) => {
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, value] of Object.entries(deps)) {
      if (name.startsWith("@catalyst-auth/")) {
        deps[name] = `^${version}`;
      } else {
        deps[name] = value;
      }
    }
  }
};

const packagesDir = join(rootDir, "packages");
const packageDirs = await fs.readdir(packagesDir);

// Update root package.json
const rootPackagePath = join(rootDir, "package.json");
const rootPackage = await readJson(rootPackagePath);
rootPackage.version = version;
await writeJson(rootPackagePath, rootPackage);

for (const dir of packageDirs) {
  const packageJsonPath = join(packagesDir, dir, "package.json");
  try {
    const pkg = await readJson(packageJsonPath);
    pkg.version = version;
    updateDependencies(pkg);
    await writeJson(packageJsonPath, pkg);
  } catch (error) {
    if ((error).code === "ENOENT") {
      continue;
    }
    throw error;
  }
}

console.log(`Updated package versions to ${version}`);
