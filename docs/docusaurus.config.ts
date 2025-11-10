import type { Config } from "@docusaurus/types";
import type { Preset } from "@docusaurus/preset-classic";

const config: Config = {
  title: "Catalyst Auth",
  tagline: "Unified identity, policy, and webhook infrastructure",
  favicon: "img/favicon.ico",

  url: "https://catalyst-auth.local",
  baseUrl: "/",
  organizationName: "catalyst-auth",
  projectName: "catalyst-auth",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: require.resolve("./sidebars.ts"),
          editUrl: "https://github.com/catalyst-auth/catalyst-auth/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      } satisfies Preset.Options,
    ],
  ],
};

export default config;
