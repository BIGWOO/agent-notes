import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  readonly version?: string;
}

export function readPackageVersion(): string {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const rawPackageJson = readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(rawPackageJson) as PackageJson;

  return packageJson.version ?? "0.0.0";
}
