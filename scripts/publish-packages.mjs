import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const version = process.argv[2];
const dryRun = process.env.SEMANTIC_RELEASE_DRYRUN === "true";

if (!version) {
  console.error("Usage: node scripts/publish-packages.mjs <version>");
  process.exit(1);
}

if (dryRun) {
  console.log("[publish] Dry run detected – skipping npm publish");
  process.exit(0);
}

const rootDir = new URL("..", import.meta.url).pathname;
const packagesDir = join(rootDir, "packages");
const packageDirs = await fs.readdir(packagesDir);

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });

for (const dir of packageDirs) {
  const pkgPath = join(packagesDir, dir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  } catch (error) {
    if ((error).code === "ENOENT") {
      continue;
    }
    throw error;
  }

  if (pkg.private) {
    continue;
  }

  console.log(`[publish] Publishing ${pkg.name}@${version}`);
  await run("pnpm", ["publish", "--filter", pkg.name, "--access", "public", "--no-git-checks"]);
}
