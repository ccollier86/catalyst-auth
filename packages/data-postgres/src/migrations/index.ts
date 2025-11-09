export const postgresMigrations = [
  {
    id: "0001_initial",
    filename: "0001_initial.sql",
    description: "Initial schema for profiles, memberships, entitlements, sessions, keys, and audit events",
  },
  {
    id: "0002_overlay_expansion",
    filename: "0002_overlay_expansion.sql",
    description: "Expand overlay tables for entitlements, sessions, and webhook registry support",
  },
] as const;
