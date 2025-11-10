import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";

import type { McpRunbook } from "@catalyst-auth/contracts";

const parseRunbook = (contents: string, format: "json" | "yaml"): McpRunbook => {
  const data = format === "json" ? JSON.parse(contents) : parseYaml(contents);
  return data as McpRunbook;
};

export const loadRunbook = async (filePath: string): Promise<McpRunbook> => {
  const contents = await readFile(filePath, "utf8");
  const extension = extname(filePath).toLowerCase();
  if (extension === ".json") {
    return parseRunbook(contents, "json");
  }
  if (extension === ".yaml" || extension === ".yml") {
    return parseRunbook(contents, "yaml");
  }
  try {
    return parseRunbook(contents, "json");
  } catch {
    return parseRunbook(contents, "yaml");
  }
};
