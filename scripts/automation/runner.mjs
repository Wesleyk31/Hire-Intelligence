import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PRODUCTION_API =
  "https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p";
export const PRODUCTION_SITE =
  "https://hirer-intelligence-mfj58p.v2.appdeploy.ai";
const REPOSITORY = "Wesleyk31/Hire-Intelligence";
const AUDIENCE = "hirer-intelligence-production";

export class PlatformUnavailableError extends Error {
  constructor(label) {
    super(
      `${label}: HTTP 402 — APP_TEMPORARILY_UNAVAILABLE. AppDeploy is blocking the application. Pause production automation and check hosting availability before resuming; no retry was attempted.`,
    );
    this.name = "PlatformUnavailableError";
  }
}
export const MONITORED_WORKFLOWS = [
  {
    workflow: "live-source-refresh.yml",
    name: "Live Source Refresh",
    expectedMinutes: 15,
  },
  { workflow: "source-health.yml", name: "Source Health", expectedMinutes: 60 },
  {
    workflow: "historical-backfill.yml",
    name: "Historical Backfill",
    expectedMinutes: 15,
  },
  {
    workflow: "source-validation.yml",
    name: "Source Validation",
    expectedMinutes: 1440,
  },
  {
    workflow: "deployment-qa.yml",
    name: "Production QA",
    expectedMinutes: 360,
  },
];

export function assertTrustedRun(env) {
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !["schedule", "push", "workflow_dispatch", "deployment_status"].includes(
      env.GITHUB_EVENT_NAME,
    )
  ) {
    throw new Error(
      "Production automation requires a trusted main branch run.",
    );
  }
  if (
    !/^\d+$/.test(env.GITHUB_RUN_ID || "") ||
    !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || "") ||
    !/^[a-f\d]{40}$/i.test(env.GITHUB_SHA || "")
  ) {
    throw new Error("GitHub run identity is incomplete.");
  }
}

function identity(env) {
  return {
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    commitSha: env.GITHUB_SHA,
  };
}

function safeFailureDetails(data, secrets = []) {
  const redact = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    let text = value;
    for (const secret of [
      ...secrets,
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      process.env.GITHUB_TOKEN,
    ]) {
      if (typeof secret === "string" && secret.length > 3)
        text = text.split(secret).join("[REDACTED]");
    }
    if (/unexpected (?:token|non-whitespace)|not valid JSON/i.test(text))
      return "INVALID_JSON_RESPONSE (response excerpt omitted)";
    text = text
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL omitted]")
      .replace(
        /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-hirer-automation-token|x-api-key)\s*[:=][^\r\n]*/gi,
        "[credential header omitted]",
      )
      .replace(/\b(?:bearer|basic)\s+[^\s;,]+/gi, "[credential omitted]")
      .replace(
        /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
        "[credential omitted]",
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[JWT omitted]",
      )
      .replace(/[A-Za-z0-9_+/=-]{48,}/g, "[long value omitted]")
      .replace(/<[^]*$/g, "[response markup omitted]")
      .replace(/[\u0000-\u001f\u007f]+/g, " ");
    return text.slice(0, 220).trim();
  };
  const details = [];
  const add = (reason, source) => {
    if (details.length >= 8) return;
    const message = redact(reason);
    if (!message) return;
    const key =
      typeof source === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(source)
        ? source + ": "
        : "";
    details.push(key + message);
  };
  // Only these backend-generated diagnostics are allowed into failure logs.
  // Never serialize headers, request bodies, records, evidence, or arbitrary error objects.
  add(data?.failure_reason);
  add(data?.run?.failure_reason);
  if (Array.isArray(data?.states)) {
    for (const state of data.states.slice(0, 20)) {
      if (state?.status !== "SUCCESS")
        add(state?.message || state?.failure_reason, state?.sourceKey);
    }
  }
  add(data?.discovery?.failure_reason);
  if (Array.isArray(data?.candidates)) {
    for (const candidate of data.candidates.slice(0, 20)) {
      if (!["SUCCESS", "ACTIVE", "VERIFIED"].includes(candidate?.status))
        add(candidate?.failure_reason, candidate?.source_id);
    }
  }
  return [...new Set(details)].join("; ").slice(0, 1900);
}

async function readJson(response, label, secrets = []) {
  const isJson = /application\/(?:[\w.+-]+\+)?json\b/i.test(
    response.headers.get("content-type") || "",
  );
  if (!response.ok) {
    let details = "";
    let data;
    if (isJson) {
      try {
        data = await response.json();
        details = safeFailureDetails(data, secrets);
      } catch {
        /* Keep HTTP failure visible if its body is invalid. */
      }
    }
    if (response.status === 402 && data?.code === "APP_TEMPORARILY_UNAVAILABLE")
      throw new PlatformUnavailableError(label);
    throw new Error(
      `${label}: HTTP ${response.status}${details ? " — " + details : ""}`,
    );
  }
  if (!isJson) {
    throw new Error(
      `${label}: expected JSON response, received another content type`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response`);
  }
}

// One public request verifies the running backend before obtaining an identity,
// reading the database, scanning sources or trying to persist an outage report.
export async function checkPlatformAvailability({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(PRODUCTION_API + "/api/_healthcheck", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const health = await readJson(response, "AppDeploy health check");
  if (
    health?.message !== "Success" ||
    health?.automationVersion !== "production-automation-v1"
  )
    throw new Error(
      "AppDeploy health check returned an unexpected backend version or response.",
    );
  return { status: "AVAILABLE" };
}

export function createClient({ env = process.env, fetchImpl = fetch } = {}) {
  assertTrustedRun(env);
  if (
    env.HI_PRODUCTION_API_BASE_URL &&
    env.HI_PRODUCTION_API_BASE_URL !== PRODUCTION_API
  ) {
    throw new Error("Unapproved production API URL.");
  }
  async function token() {
    if (
      !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
      !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    )
      throw new Error("GitHub OIDC requires id-token: write.");
    const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)actions\.githubusercontent\.com$/.test(url.hostname)
    )
      throw new Error("Unapproved GitHub OIDC issuer request URL.");
    url.searchParams.set("audience", AUDIENCE);
    const response = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    const data = await readJson(response, "GitHub OIDC", [
      env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    ]);
    if (typeof data.value !== "string" || !data.value)
      throw new Error("GitHub OIDC returned no token.");
    return data.value;
  }
  return {
    async request(path, { method = "GET", body, authenticated = true } = {}) {
      if (!/^\/api\/[a-z0-9/-]+$/.test(path))
        throw new Error("Invalid production API path.");
      const headers = { Accept: "application/json" };
      if (authenticated) headers["X-Hirer-Automation-Token"] = await token();
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(PRODUCTION_API + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(150_000),
        redirect: "error",
      });
      // Mutations are not retried here: the server owns bounded retries and checkpoints.
      return readJson(response, path, [
        headers["X-Hirer-Automation-Token"],
        env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
        env.GITHUB_TOKEN,
      ]);
    },
  };
}

function requireSuccess(result, job) {
  if (
    result?.status !== "SUCCESS" &&
    !(job === "historical-backfill" && result?.status === "COMPLETE")
  ) {
    const status = ["FAILED", "DEGRADED", "RUNNING", "COMPLETE"].includes(
      result?.status,
    )
      ? result.status
      : result?.status === undefined
        ? "MISSING"
        : "UNKNOWN";
    const details = safeFailureDetails(result);
    throw new Error(
      `${job} did not succeed (status ${status}).${details ? " " + details : ""}`,
    );
  }
  return result;
}

export async function runScheduledJob(job, { client, env = process.env }) {
  if (
    ![
      "source-health",
      "historical-backfill",
      "live-refresh",
      "source-validation",
    ].includes(job)
  )
    throw new Error("Unknown scheduled job.");
  if (job !== "source-health")
    return requireSuccess(
      await client.request("/api/automation/run", {
        method: "POST",
        body: { job, ...identity(env) },
      }),
      job,
    );
  const registry = await client.request("/api/automation/registry");
  if (
    !Array.isArray(registry?.sources) ||
    registry.sources.some(
      (source) =>
        typeof source.source_id !== "string" ||
        !source.source_id ||
        typeof source.status !== "string",
    )
  ) {
    throw new Error("Invalid source registry response.");
  }
  const checkedAt = (source) => {
    const timestamp = Date.parse(source.last_checked_at || "");
    return Number.isFinite(timestamp) ? timestamp : -Infinity;
  };
  const active = registry.sources
    .filter((source) => ["ACTIVE", "DEGRADED"].includes(source.status))
    .sort((a, b) =>
      checkedAt(a) === checkedAt(b) ? 0 : checkedAt(a) - checkedAt(b),
    );
  const outcomes = [];
  for (const source of active) {
    try {
      const result = await client.request("/api/automation/run", {
        method: "POST",
        body: { job, sourceKey: source.source_id, ...identity(env) },
      });
      requireSuccess(result, job);
      outcomes.push({ source_id: source.source_id, status: "SUCCESS" });
    } catch (error) {
      if (error instanceof PlatformUnavailableError) throw error;
      outcomes.push({
        source_id: source.source_id,
        status: "FAILED",
        error: error.message,
      });
    }
  }
  const failed = outcomes.filter((result) => result.status === "FAILED").length;
  const details = {
    checked: active.length,
    failed,
    outcomes,
    dataStatus: active.length ? "CHECKED" : "EMPTY",
  };
  const status = failed || !active.length ? "FAILED" : "SUCCESS";
  requireSuccess(
    await client.request("/api/automation/report", {
      method: "POST",
      body: { job, ...identity(env), status, details },
    }),
    "source-health report persistence",
  );
  if (status === "FAILED") {
    const failures = safeFailureDetails({
      states: outcomes
        .filter((outcome) => outcome.status === "FAILED")
        .map((outcome) => ({
          sourceKey: outcome.source_id,
          status: outcome.status,
          message: outcome.error,
        })),
    });
    throw new Error(
      `source-health failed: ${failed} failed probes; ${active.length} eligible sources. ${failures}`,
    );
  }
  return { status, ...details };
}

function observeWorkflow(definition, runs, now) {
  const ordered = [...runs].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const last = ordered[0];
  const success = ordered.find((run) => run.conclusion === "success");
  const lastRun = last
    ? {
        id: last.id,
        status: last.status,
        conclusion: last.conclusion ?? null,
        created_at: last.created_at,
        updated_at: last.updated_at,
        html_url: last.html_url ?? null,
      }
    : null;
  let failureCount = 0;
  for (const run of ordered) {
    if (run.conclusion === "success") break;
    if (run.status === "completed") failureCount += 1;
  }
  const age = last ? now - Date.parse(last.created_at) : Infinity;
  const staleAfter = (definition.expectedMinutes * 2 + 10) * 60_000;
  const successAge = now - Date.parse(success?.updated_at || "");
  const status =
    !last || !Number.isFinite(age) || age > staleAfter
      ? "STALE"
      : last.status === "completed" && last.conclusion !== "success"
        ? "FAILED"
        : failureCount ||
            !success ||
            !Number.isFinite(successAge) ||
            successAge > staleAfter
          ? "DEGRADED"
          : "HEALTHY";
  return {
    ...definition,
    lastRun,
    lastSuccessAt: success?.updated_at ?? null,
    status,
    failureCount,
  };
}

export async function collectWatchdog({
  client,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  if (!env.GITHUB_TOKEN)
    throw new Error("Watchdog requires GITHUB_TOKEN with actions: read.");
  const observations = [];
  for (const definition of MONITORED_WORKFLOWS) {
    try {
      const url = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${definition.workflow}/runs?branch=main&per_page=100`;
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      const data = await readJson(response, `GitHub ${definition.workflow}`);
      if (!Array.isArray(data.workflow_runs))
        throw new Error("Invalid GitHub workflow response.");
      observations.push(observeWorkflow(definition, data.workflow_runs, now));
    } catch (error) {
      observations.push({
        ...definition,
        lastRun: null,
        lastSuccessAt: null,
        status: "FAILED",
        failureCount: 1,
        error: error.message,
      });
    }
  }
  const status = observations.every((item) => item.status === "HEALTHY")
    ? "SUCCESS"
    : "FAILED";
  requireSuccess(
    await client.request("/api/automation/report", {
      method: "POST",
      body: {
        job: "workflow-watchdog",
        ...identity(env),
        status,
        details: {
          observations,
          observedAt: new Date(now).toISOString(),
          observationWindow: "latest 100 main-branch runs per workflow",
        },
      },
    }),
    "watchdog report persistence",
  );
  return observations;
}

function compactStoredHealth(health) {
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const timestamp = (value) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  const allowedValue = (value, allowed) =>
    allowed.includes(value) ? value : null;
  const backfill = health.backfill || {};
  const allowedJobs = [
    "live-refresh",
    "source-health",
    "historical-backfill",
    "source-validation",
    "deployment-qa",
    "e2e",
    "workflow-watchdog",
  ];
  const metricsBasis =
    "Acknowledged automation runs since rollout; pre-rollout unique evidence/page totals are unknown.";
  // Explicit projection: source URLs, evidence text, raw details and cursor tokens
  // never enter workflow logs. Absent metrics stay null rather than becoming zero.
  return {
    source_counts: Object.fromEntries(
      [
        "ACTIVE",
        "DEGRADED",
        "DISABLED",
        "CANDIDATE",
        "VALIDATING",
        "VERIFIED",
        "REVIEW_REQUIRED",
        "REJECTED",
      ].map((status) => [status, count(health.source_counts?.[status])]),
    ),
    source_count_basis: allowedValue(health.source_count_basis, [
      "PERSISTED_REGISTRY_ONLY",
    ]),
    unobserved_sources: count(health.unobserved_sources),
    backfill: {
      last_backfill_run: timestamp(backfill.last_backfill_run),
      ...Object.fromEntries(
        [
          "records_processed",
          "evidence_processed",
          "pages_processed",
          "duplicates_skipped",
          "sources_completed",
          "sources_remaining",
        ].map((key) => [key, count(backfill[key])]),
      ),
      metrics_basis: [
        metricsBasis,
        "ACKNOWLEDGED_RUNS_SINCE_AUTOMATION_ROLLOUT",
      ].includes(backfill.metrics_basis)
        ? backfill.metrics_basis
        : "NOT_VERIFIED",
      archive_index: backfill.archive_index
        ? {
            complete:
              typeof backfill.archive_index.complete === "boolean"
                ? backfill.archive_index.complete
                : null,
            pagesIndexed: count(backfill.archive_index.pagesIndexed),
            invalidRecords: count(backfill.archive_index.invalidRecords),
          }
        : null,
    },
    jobs: Array.isArray(health.jobs)
      ? health.jobs
          .filter((job) => allowedJobs.includes(job?.job))
          .map((job) => ({
            job: job.job,
            status: allowedValue(job.status, [
              "SUCCESS",
              "FAILED",
              "DEGRADED",
              "COMPLETE",
              "RUNNING",
              "NOT_RUN",
            ]),
            health: allowedValue(job.health, [
              "HEALTHY",
              "DEGRADED",
              "FAILED",
              "STALE",
            ]),
            last_run: timestamp(job.last_run),
            last_success_at: timestamp(job.last_success_at),
            failure_count: count(job.failure_count),
          }))
      : null,
  };
}

export async function checkProductionSmoke({ client }) {
  const health = await client.request("/api/automation/health");
  if (
    health?.schemaVersion !== 1 ||
    health?.automationVersion !== "production-automation-v1"
  )
    throw new Error("Production automation health schema/version failed.");
  const summary = await client.request("/api/public/summary", {
    authenticated: false,
  });
  if (
    !summary?.metrics ||
    !summary?.sources ||
    typeof summary.metrics.active !== "number"
  )
    throw new Error("Public summary schema failed.");
  const smoke = await client.request("/api/automation/smoke");
  for (const field of [
    "opportunities",
    "evidenceReferences",
    "sources",
    "errors",
  ]) {
    if (!Array.isArray(smoke?.[field]))
      throw new Error(`Production smoke: invalid ${field}.`);
  }
  if (smoke.errors.length)
    throw new Error("Production smoke reported backend errors.");
  if (smoke.coverage?.bounded !== true)
    throw new Error("Production smoke must disclose bounded coverage.");
  if (smoke.opportunities.length && !smoke.evidenceReferences.length)
    throw new Error("Loaded opportunities lack evidence references.");
  for (const reference of smoke.evidenceReferences) {
    const url =
      reference.sourceUrl || reference.provenance || reference.source_url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
      throw new Error("Invalid stored evidence reference.");
  }
  for (const opportunity of smoke.opportunities) {
    if (
      opportunity.equipmentPrediction?.classes?.length &&
      opportunity.equipmentPrediction.label !== "PREDICTED"
    )
      throw new Error("Inferred equipment is missing its PREDICTED label.");
  }
  return {
    status: "SUCCESS",
    dataStatus: smoke.opportunities.length ? "PRESENT" : "EMPTY",
    opportunities: smoke.opportunities.length,
    evidenceReferences: smoke.evidenceReferences.length,
    sources: smoke.sources.length,
    coverage: smoke.coverage,
    health: compactStoredHealth(health),
  };
}

export async function reportQa({ client, env = process.env }) {
  const checks = {
    static: env.QA_STATIC_RESULT,
    api: env.QA_API_RESULT,
    browser: env.QA_BROWSER_RESULT,
  };
  const status = Object.values(checks).every((value) => value === "success")
    ? "SUCCESS"
    : "FAILED";
  const browserStatus = checks.browser === "success" ? "SUCCESS" : "FAILED";
  const details = {
    checks,
    scope: "production-api-and-public-browser",
    authenticatedBrowser: false,
    localAuthenticatedBrowser: "synthetic fixtures only",
    apiDataStatus: env.QA_DATA_STATUS || "NOT_VERIFIED",
  };
  // Persist both reports even if one persistence attempt fails.
  const errors = [];
  for (const report of [
    { job: "e2e", status: browserStatus },
    { job: "deployment-qa", status },
  ]) {
    try {
      requireSuccess(
        await client.request("/api/automation/report", {
          method: "POST",
          body: { ...report, ...identity(env), details },
        }),
        "QA report persistence",
      );
    } catch (error) {
      if (error instanceof PlatformUnavailableError) throw error;
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "QA report persistence failed.");
  if (status !== "SUCCESS")
    throw new Error("Deployment QA failed; stored failed acceptance results.");
  return { status, checks };
}

export async function main(command = process.argv[2], env = process.env) {
  if (command === "platform-check") {
    console.log(JSON.stringify(await checkPlatformAvailability()));
    return;
  }
  const client = createClient({ env });
  await checkPlatformAvailability();
  let result;
  if (command === "production-smoke") {
    result = await checkProductionSmoke({ client });
    if (env.GITHUB_OUTPUT)
      await appendFile(env.GITHUB_OUTPUT, `data_status=${result.dataStatus}\n`);
  } else if (command === "watchdog") {
    const observations = await collectWatchdog({ client, env });
    result = { observations };
    console.log(JSON.stringify(result));
    if (observations.some((item) => item.status !== "HEALTHY"))
      throw new Error("Workflow watchdog detected unhealthy or missing runs.");
    return;
  } else if (command === "report") result = await reportQa({ client, env });
  else result = await runScheduledJob(command, { client, env });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
