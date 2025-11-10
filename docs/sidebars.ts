import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "category",
      label: "Quickstart",
      collapsible: false,
      items: ["quickstart/index"],
    },
    {
      type: "category",
      label: "Setup",
      collapsible: false,
      items: ["setup/platform", "setup/forward-auth", "setup/webhooks"],
    },
    {
      type: "category",
      label: "Operations",
      collapsible: false,
      items: ["runbooks/operations", "runbooks/backup-restore"],
    },
    {
      type: "category",
      label: "Security",
      collapsible: false,
      items: ["security/posture"],
    },
    {
      type: "category",
      label: "Architecture",
      collapsible: false,
      items: ["architecture/overview"],
    },
  ],
};

export default sidebars;
