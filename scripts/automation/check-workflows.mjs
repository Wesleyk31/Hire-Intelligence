import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Targeted safety lint. Prettier separately parses YAML/TS and checks formatting;
// typecheck and executable contract tests provide code validation.
const fail = (message) => {
  throw new Error(message);
};
const directory = new URL("../../.github/workflows/", import.meta.url);
const files = (await readdir(directory)).filter((file) =>
  file.endsWith(".yml"),
);
const expected = [
  "deployment-qa.yml",
  "historical-backfill.yml",
  "live-source-refresh.yml",
  "source-health.yml",
  "source-validation.yml",
  "workflow-watchdog.yml",
];
for (const file of expected)
  if (!files.includes(file)) fail(`Missing workflow ${file}`);
for (const file of expected) {
  const source = await readFile(new URL(file, directory), "utf8");
  for (const [label, pattern] of [
    ["manual trigger", /workflow_dispatch:/],
    ["default-deny permissions", /^permissions: \{\}/m],
    ["timeout", /timeout-minutes: \d+/],
    ["shared production concurrency", /group: hirer-production-automation/],
    ["non-cancelling active production job", /cancel-in-progress: false/],
    ["bounded pending production queue", /queue: max/],
    [
      "trusted repository guard",
      /github\.repository == 'Wesleyk31\/Hire-Intelligence'/,
    ],
    ["main branch guard", /github\.ref == 'refs\/heads\/main'/],
    ["OIDC permissions", /id-token: write/],
    ["credential-free checkout", /persist-credentials: false/],
  ])
    if (!pattern.test(source)) fail(`${file}: missing ${label}`);
  for (const line of source
    .split("\n")
    .filter((line) => /\buses:/.test(line))) {
    if (!/uses: [\w.-]+\/[\w.-]+@[a-f\d]{40}(?:\s|$)/.test(line))
      fail(`${file}: action must use a verified immutable commit`);
  }
  if (
    /continue-on-error:|\|\|\s*true|secrets\.|permissions: write-all|pull_request_target:/.test(
      source,
    )
  )
    fail(`${file}: unsafe failure, secret, or permission configuration`);
  if (file !== "deployment-qa.yml" && /pull_request:/.test(source))
    fail(`${file}: scheduled mutation workflows must not run on PRs`);
  if (
    file === "deployment-qa.yml" &&
    !/github\.event_name != 'pull_request'/.test(source)
  )
    fail("Production QA must exclude PRs from its production job");
}
for (const file of ["runner.mjs", "check-workflows.mjs"]) {
  const result = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(new URL(file, import.meta.url))],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    fail(result.stderr || `${file}: Node syntax check failed`);
}
console.log(
  `Automation safety lint passed for ${expected.length} workflows and runner syntax.`,
);
