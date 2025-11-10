import clsx from "clsx";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

import styles from "./index.module.css";

const features = [
  {
    title: "Start fast",
    description:
      "Walk through environment setup, infrastructure dependencies, and local development flows in minutes.",
    to: "/docs/quickstart",
  },
  {
    title: "Operate with confidence",
    description:
      "Runbooks cover day-2 operations, alert response, and end-to-end backup/restore scenarios.",
    to: "/docs/runbooks/operations",
  },
  {
    title: "Understand the platform",
    description:
      "Review architecture notes, component diagrams, and our security posture documentation.",
    to: "/docs/architecture/overview",
  },
];

export default function Home(): JSX.Element {
  return (
    <Layout
      title="Catalyst Auth documentation"
      description="Guides, runbooks, and architecture notes for Catalyst Auth"
    >
      <main className={styles.hero}>
        <div className={styles.container}>
          <h1>Catalyst Auth Documentation</h1>
          <p>
            Build, deploy, and operate the Catalyst Auth platform with validated checklists, reference
            architectures, and production-ready runbooks.
          </p>
          <div className={styles.ctaRow}>
            {features.map((feature) => (
              <Link key={feature.title} className={clsx("button button--primary", styles.cta)} to={feature.to}>
                {feature.title}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
