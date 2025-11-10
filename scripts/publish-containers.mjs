import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/publish-containers.mjs <version>");
  process.exit(1);
}

const registry = process.env.CONTAINER_REGISTRY;
const repositoryPrefix = process.env.CONTAINER_REPOSITORY ?? "";
const pushEnabled = process.env.PUBLISH_CONTAINERS === "true";

if (!registry || !pushEnabled) {
  console.log("[containers] Publishing disabled – set CONTAINER_REGISTRY and PUBLISH_CONTAINERS=true to enable");
  process.exit(0);
}

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

const rootDir = new URL("..", import.meta.url).pathname;
const packagesDir = join(rootDir, "packages");
const packageDirs = await fs.readdir(packagesDir);

let built = 0;
for (const dir of packageDirs) {
  const dockerfile = join(packagesDir, dir, "Dockerfile");
  try {
    await fs.access(dockerfile);
  } catch {
    continue;
  }

  const imageName = `${registry}/${repositoryPrefix}${dir}:${version}`;
  console.log(`[containers] Building ${imageName}`);
  await run("docker", ["build", "-t", imageName, join(packagesDir, dir)]);
  console.log(`[containers] Pushing ${imageName}`);
  await run("docker", ["push", imageName]);
  built += 1;
}

if (built === 0) {
  console.log("[containers] No Dockerfiles detected – skipping build");
}
