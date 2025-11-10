module.exports = {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        changelogFile: "CHANGELOG.md",
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd: "node scripts/prepare-release.mjs ${nextRelease.version}",
        publishCmd:
          "node scripts/publish-packages.mjs ${nextRelease.version} && node scripts/publish-containers.mjs ${nextRelease.version}",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [],
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json", "packages/**/package.json"],
        message: "chore(release): ${nextRelease.version} [skip ci]",
      },
    ],
  ],
};
