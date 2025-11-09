export const postgresMigrations = [
  {
    id: "0001_initial",
    filename: "0001_initial.sql",
    description: "Initial schema for profiles, memberships, entitlements, sessions, keys, and audit events",
  },
] as const;
