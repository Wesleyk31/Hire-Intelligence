import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const playwrightCli = resolve("node_modules/@playwright/test/cli.js");

function listTests(config: string, smokeTarget?: "production") {
  const env = { ...process.env };
  if (smokeTarget) env.HI_SMOKE_TARGET = smokeTarget;
  else delete env.HI_SMOKE_TARGET;

  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--list", "--config", config],
    { cwd: process.cwd(), encoding: "utf8", env },
  );
  const output = result.stdout + result.stderr;
  expect(result.status, output).toBe(0);
  return output;
}

describe("Playwright production smoke discovery", () => {
  test("ordinary local browser discovery excludes production smoke", () => {
    expect(listTests("playwright.config.ts")).not.toContain(
      "automation-smoke.spec.ts",
    );
  });

  test("local automation discovery excludes production smoke", () => {
    expect(listTests("playwright.automation.config.ts")).not.toContain(
      "automation-smoke.spec.ts",
    );
  });

  test("explicit production automation discovery selects production smoke", () => {
    const output = listTests("playwright.automation.config.ts", "production");
    expect(output).toContain("automation-smoke.spec.ts");
    expect(output).toContain("Total: 1 test in 1 file");
  });
});
