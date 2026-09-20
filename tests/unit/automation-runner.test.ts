import { describe, expect, test } from "vitest";
import {
  assertTrustedRun,
  createClient,
  runScheduledJob,
  collectWatchdog,
  checkProductionSmoke,
  reportQa,
  checkPlatformAvailability,
  PlatformUnavailableError,
} from "../../scripts/automation/runner.mjs";

const env = {
  GITHUB_REPOSITORY: "Wesleyk31/Hire-Intelligence",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_TOKEN: "github-token",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://oidc.actions.githubusercontent.com/token?x=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("platform outage containment", () => {
  test("checks the lightweight public backend without requesting credentials", async () => {
    const urls: string[] = [];
    await expect(
      checkPlatformAvailability({
        fetchImpl: async (url: string, options: RequestInit) => {
          urls.push(url);
          expect(
            new Headers(options.headers).has("X-Hirer-Automation-Token"),
          ).toBe(false);
          return json({
            message: "Success",
            automationVersion: "production-automation-v1",
          });
        },
      }),
    ).resolves.toEqual({ status: "AVAILABLE" });
    expect(urls).toEqual([
      "https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p/api/_healthcheck",
    ]);
  });

  test("identifies the provider outage without leaking arbitrary response text", async () => {
    const error = await checkPlatformAvailability({
      fetchImpl: async () =>
        json(
          {
            code: "APP_TEMPORARILY_UNAVAILABLE",
            message: "private-provider-response",
          },
          402,
        ),
    }).catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(PlatformUnavailableError);
    expect(error.message).toContain("HTTP 402");
    expect(error.message).toContain("APP_TEMPORARILY_UNAVAILABLE");
    expect(error.message).not.toContain("private-provider-response");
  });

  test.each([{}, { message: "Success", automationVersion: "obsolete" }])(
    "rejects a false or stale health response",
    async (body) => {
      await expect(
        checkPlatformAvailability({ fetchImpl: async () => json(body) }),
      ).rejects.toThrow(/health/);
    },
  );

  test("stops a source scan immediately when the host blocks requests", async () => {
    const paths: string[] = [];
    const client = {
      request: async (path: string) => {
        paths.push(path);
        if (path.endsWith("/registry"))
          return {
            sources: [
              { source_id: "one", status: "ACTIVE" },
              { source_id: "two", status: "ACTIVE" },
            ],
          };
        throw new PlatformUnavailableError("source check");
      },
    };
    await expect(
      runScheduledJob("source-health", { env, client }),
    ).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(paths).toEqual(["/api/automation/registry", "/api/automation/run"]);
  });

  test("does not repeat QA writes against an unavailable platform", async () => {
    let calls = 0;
    await expect(
      reportQa({
        env,
        client: {
          request: async () => {
            calls++;
            throw new PlatformUnavailableError("report");
          },
        },
      }),
    ).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(calls).toBe(1);
  });

  test("prints the failed source and safe reason for ordinary probe failures", async () => {
    await expect(
      runScheduledJob("source-health", {
        env,
        client: {
          request: async (path: string) => {
            if (path.endsWith("/registry"))
              return {
                sources: [{ source_id: "broken-feed", status: "ACTIVE" }],
              };
            if (path.endsWith("/run"))
              throw new Error("HTTP_503 token=private-value");
            return { status: "SUCCESS" };
          },
        },
      }),
    ).rejects.toThrow(/broken-feed: HTTP_503 \[credential omitted\]/);
  });
});

describe("automation runner safety", () => {
  test("rejects pull requests and non-main manual runs before accessing production", () => {
    expect(() =>
      assertTrustedRun({ ...env, GITHUB_EVENT_NAME: "pull_request" }),
    ).toThrow(/trusted main/);
    expect(() =>
      assertTrustedRun({ ...env, GITHUB_REF: "refs/heads/feature" }),
    ).toThrow(/trusted main/);
    expect(() =>
      assertTrustedRun({ ...env, GITHUB_REPOSITORY: "someone/fork" }),
    ).toThrow(/trusted main/);
    expect(() => assertTrustedRun(env)).not.toThrow();
  });

  test("requests the audience-bound OIDC token and sends only the dedicated production header", async () => {
    const traffic: Array<{ url: string; init: RequestInit }> = [];
    const client = createClient({
      env,
      fetchImpl: async (url: string, init: RequestInit) => {
        traffic.push({ url: String(url), init });
        return String(url).startsWith("https://oidc.")
          ? json({ value: "short-lived-jwt" })
          : json({ status: "SUCCESS" });
      },
    });
    await client.request("/api/automation/run", {
      method: "POST",
      body: { job: "live-refresh" },
    });
    expect(new URL(traffic[0].url).searchParams.get("audience")).toBe(
      "hirer-intelligence-production",
    );
    expect(new Headers(traffic[0].init.headers).get("Authorization")).toBe(
      "Bearer oidc-request-token",
    );
    expect(
      new Headers(traffic[1].init.headers).get("X-Hirer-Automation-Token"),
    ).toBe("short-lived-jwt");
    expect(new Headers(traffic[1].init.headers).has("Authorization")).toBe(
      false,
    );
  });

  test("does not retry a mutation after an HTTP failure or expose response credentials", async () => {
    let requests = 0;
    const client = createClient({
      env,
      fetchImpl: async (url: string) => {
        if (String(url).startsWith("https://oidc."))
          return json({ value: "short-lived-jwt" });
        requests += 1;
        return json({ error: "short-lived-jwt private backend text" }, 503);
      },
    });
    await expect(
      client.request("/api/automation/run", { method: "POST", body: {} }),
    ).rejects.toThrow("HTTP 503");
    expect(requests).toBe(1);
  });

  test("HTTP failures include bounded selected source diagnostics while omitting secrets and raw evidence", async () => {
    const client = createClient({
      env,
      fetchImpl: async (url: string) =>
        String(url).startsWith("https://oidc.")
          ? json({ value: "short-lived-jwt" })
          : json(
              {
                status: "FAILED",
                failure_reason: "SOURCE_BATCH_FAILED short-lived-jwt",
                run: { failure_reason: "PAGINATION_NON_INCREASING" },
                states: [
                  {
                    sourceKey: "failed-feed",
                    status: "FAILED",
                    message:
                      "HTTP_403 token=private-secret https://publisher.example/data?key=private-secret",
                  },
                  {
                    sourceKey: "good-feed",
                    status: "SUCCESS",
                    message: "raw successful response",
                  },
                ],
                discovery: { failure_reason: "CATALOGUE_UNAVAILABLE" },
                candidates: [
                  {
                    source_id: "candidate-feed",
                    status: "REVIEW_REQUIRED",
                    failure_reason: "SCHEMA_CHANGED " + "details ".repeat(1000),
                  },
                ],
                headers: { authorization: "private-secret" },
                evidence: "raw evidence must not appear",
              },
              503,
            ),
    });
    const error = await client
      .request("/api/automation/run", { method: "POST", body: {} })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("HTTP 503");
    expect(error.message).toContain("SOURCE_BATCH_FAILED");
    expect(error.message).toContain("PAGINATION_NON_INCREASING");
    expect(error.message).toContain("failed-feed: HTTP_403");
    expect(error.message).toContain("CATALOGUE_UNAVAILABLE");
    expect(error.message).toContain("candidate-feed: SCHEMA_CHANGED");
    expect(error.message).not.toMatch(
      /private-secret|short-lived-jwt|raw evidence|raw successful|publisher\.example/,
    );
    expect(error.message.length).toBeLessThan(2200);
  });

  test("unsuccessful JSON status preserves concrete failure reasons even with HTTP 200", async () => {
    await expect(
      runScheduledJob("live-refresh", {
        env,
        client: {
          request: async () => ({
            status: "FAILED",
            states: [
              {
                sourceKey: "failed-feed",
                status: "FAILED",
                message: "SOURCE_SCHEMA_CHANGED",
              },
            ],
          }),
        },
      }),
    ).rejects.toThrow("failed-feed: SOURCE_SCHEMA_CHANGED");
  });

  test("HTML error bodies stay excluded from diagnostics", async () => {
    const client = createClient({
      env,
      fetchImpl: async (url: string) =>
        String(url).startsWith("https://oidc.")
          ? json({ value: "short-lived-jwt" })
          : new Response("<html>private source body</html>", {
              status: 502,
              headers: { "content-type": "text/html" },
            }),
    });
    await expect(
      client.request("/api/automation/run", { method: "POST", body: {} }),
    ).rejects.toThrow(/^\/api\/automation\/run: HTTP 502$/);
  });

  test("health probes continue after one failed source and persist the aggregate failure", async () => {
    const mutations: any[] = [];
    const client = {
      request: async (path: string, options?: any) => {
        if (path.endsWith("/registry"))
          return {
            sources: [
              { source_id: "failed", status: "ACTIVE" },
              { source_id: "good", status: "DEGRADED" },
              { source_id: "held", status: "REVIEW_REQUIRED" },
            ],
          };
        mutations.push({ path, ...options.body });
        if (options.body.sourceKey === "failed") throw new Error("HTTP 503");
        return { status: "SUCCESS" };
      },
    };
    await expect(
      runScheduledJob("source-health", { client, env }),
    ).rejects.toThrow(/source-health/);
    expect(
      mutations
        .filter((item) => item.path.endsWith("/run"))
        .map((item) => item.sourceKey),
    ).toEqual(["failed", "good"]);
    expect(mutations.at(-1)).toMatchObject({
      job: "source-health",
      status: "FAILED",
      runId: "123",
      runAttempt: "2",
      details: { checked: 2, failed: 1 },
    });
  });

  test("an interrupted health scan resumes with unobserved and oldest sources before recently checked sources", async () => {
    const probes: string[] = [];
    const client = {
      request: async (path: string, options?: any) => {
        if (path.endsWith("/registry"))
          return {
            sources: [
              {
                source_id: "recent",
                status: "ACTIVE",
                last_checked_at: "2026-09-18T03:00:00Z",
              },
              {
                source_id: "old",
                status: "ACTIVE",
                last_checked_at: "2026-09-16T00:00:00Z",
              },
              {
                source_id: "never-checked",
                status: "ACTIVE",
                last_checked_at: null,
              },
              {
                source_id: "unknown-timestamp",
                status: "DEGRADED",
                last_checked_at: "invalid",
              },
              {
                source_id: "oldest",
                status: "DEGRADED",
                last_checked_at: "2026-09-15T00:00:00Z",
              },
              {
                source_id: "held",
                status: "REVIEW_REQUIRED",
                last_checked_at: null,
              },
            ],
          };
        if (path.endsWith("/run")) probes.push(options.body.sourceKey);
        return { status: "SUCCESS" };
      },
    };
    await runScheduledJob("source-health", { client, env });
    expect(probes).toEqual([
      "never-checked",
      "unknown-timestamp",
      "oldest",
      "old",
      "recent",
    ]);
  });

  test("does not call any mutations for a malformed registry", async () => {
    const paths: string[] = [];
    const client = {
      request: async (path: string) => {
        paths.push(path);
        return { sources: [{}] };
      },
    };
    await expect(
      runScheduledJob("source-health", { client, env }),
    ).rejects.toThrow(/registry/);
    expect(paths).toEqual(["/api/automation/registry"]);
  });

  test.each(["FAILED", "DEGRADED", "RUNNING", undefined])(
    "fails the process for unsuccessful server status %s",
    async (status) => {
      await expect(
        runScheduledJob("historical-backfill", {
          env,
          client: { request: async () => ({ status }) },
        }),
      ).rejects.toThrow(/historical-backfill/);
    },
  );

  test("accepts an exhausted backfill without requesting a restart", async () => {
    const payloads: any[] = [];
    await expect(
      runScheduledJob("historical-backfill", {
        env,
        client: {
          request: async (_: string, opts: any) => {
            payloads.push(opts.body);
            return { status: "COMPLETE" };
          },
        },
      }),
    ).resolves.toMatchObject({ status: "COMPLETE" });
    expect(payloads).toEqual([
      {
        job: "historical-backfill",
        runId: "123",
        runAttempt: "2",
        commitSha: "a".repeat(40),
      },
    ]);
  });
});

describe("independent workflow watchdog", () => {
  test("records missing workflows as stale and API failures as failed, then reports all observations", async () => {
    let report: any;
    const observations = await collectWatchdog({
      env,
      now: Date.parse("2026-09-18T04:00:00Z"),
      fetchImpl: async (url: string) => {
        const path = String(url);
        if (path.includes("source-health.yml"))
          return json({ workflow_runs: [] });
        if (path.includes("source-validation.yml")) return json({}, 503);
        return json({
          workflow_runs: [
            {
              id: 2,
              status: "completed",
              conclusion: "failure",
              created_at: "2026-09-18T03:55:00Z",
              updated_at: "2026-09-18T03:57:00Z",
              html_url: "https://github.com/example/2",
            },
            {
              id: 1,
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-18T03:40:00Z",
              updated_at: "2026-09-18T03:42:00Z",
              html_url: "https://github.com/example/1",
            },
          ],
        });
      },
      client: {
        request: async (_: string, options: any) => {
          report = options.body;
          return { status: "SUCCESS" };
        },
      },
    });
    expect(
      observations.find((item: any) => item.workflow === "source-health.yml"),
    ).toMatchObject({ status: "STALE", lastRun: null, lastSuccessAt: null });
    expect(
      observations.find(
        (item: any) => item.workflow === "source-validation.yml",
      ),
    ).toMatchObject({ status: "FAILED", failureCount: 1 });
    expect(
      observations.find(
        (item: any) => item.workflow === "live-source-refresh.yml",
      ),
    ).toMatchObject({
      status: "FAILED",
      failureCount: 1,
      lastSuccessAt: "2026-09-18T03:42:00Z",
      expectedMinutes: 15,
    });
    expect(report).toMatchObject({
      job: "workflow-watchdog",
      status: "FAILED",
      details: { observations },
    });
    expect(observations).toHaveLength(5);
  });

  test("does not call a previous success healthy when no recent run exists", async () => {
    const observations = await collectWatchdog({
      env,
      now: Date.parse("2026-09-18T04:00:00Z"),
      fetchImpl: async () =>
        json({
          workflow_runs: [
            {
              id: 1,
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-15T00:00:00Z",
              updated_at: "2026-09-15T00:05:00Z",
            },
          ],
        }),
      client: { request: async () => ({ status: "SUCCESS" }) },
    });
    expect(observations.every((item: any) => item.status === "STALE")).toBe(
      true,
    );
  });
});

test("a newly queued run cannot make an old successful workflow healthy", async () => {
  const observations = await collectWatchdog({
    env,
    now: Date.parse("2026-09-18T04:00:00Z"),
    fetchImpl: async () =>
      json({
        workflow_runs: [
          {
            id: 2,
            status: "queued",
            conclusion: null,
            created_at: "2026-09-18T03:59:00Z",
            updated_at: "2026-09-18T03:59:00Z",
          },
          {
            id: 1,
            status: "completed",
            conclusion: "success",
            created_at: "2026-09-15T00:00:00Z",
            updated_at: "2026-09-15T00:05:00Z",
          },
        ],
      }),
    client: { request: async () => ({ status: "SUCCESS" }) },
  });
  expect(observations.every((item: any) => item.status === "DEGRADED")).toBe(
    true,
  );
});

test.each([
  ["live-source-refresh.yml", "2026-09-18T03:19:00Z", "STALE"],
  ["source-health.yml", "2026-09-18T01:55:00Z", "HEALTHY"],
])(
  "watchdog uses the server's cadence grace for %s",
  async (workflow, timestamp, expected) => {
    const observations = await collectWatchdog({
      env,
      now: Date.parse("2026-09-18T04:00:00Z"),
      fetchImpl: async () =>
        json({
          workflow_runs: [
            {
              id: 1,
              status: "completed",
              conclusion: "success",
              created_at: timestamp,
              updated_at: timestamp,
            },
          ],
        }),
      client: { request: async () => ({ status: "SUCCESS" }) },
    });
    expect(
      observations.find((item: any) => item.workflow === workflow)?.status,
    ).toBe(expected);
  },
);

describe("production acceptance and reporting", () => {
  const valid = {
    opportunities: [
      {
        id: "stored-1",
        equipmentPrediction: { label: "PREDICTED", classes: ["Excavator"] },
      },
    ],
    evidenceReferences: [{ sourceUrl: "https://data.example.gov.au/record/1" }],
    sources: [{ source_id: "source-1" }],
    errors: [],
    coverage: { bounded: true },
  };
  const clientFor = (smoke: any, storedHealth: any = {}) => ({
    request: async (path: string) =>
      path.endsWith("/health")
        ? {
            schemaVersion: 1,
            automationVersion: "production-automation-v1",
            ...storedHealth,
          }
        : path.endsWith("/summary")
          ? { metrics: { active: 1 }, sources: { configured: 1 } }
          : smoke,
  });
  test("preserves the deployed metrics basis enum", async () => {
    const result = await checkProductionSmoke({
      client: clientFor(valid, {
        backfill: {
          metrics_basis: "ACKNOWLEDGED_RUNS_SINCE_AUTOMATION_ROLLOUT",
        },
      }),
    });
    expect(result.health.backfill.metrics_basis).toBe(
      "ACKNOWLEDGED_RUNS_SINCE_AUTOMATION_ROLLOUT",
    );
  });
  test("reveals failed sources without logging endpoints, evidence or credentials", async () => {
    const result = await checkProductionSmoke({
      client: clientFor(valid, {
        sources: [
          {
            source_id: "healthy-feed",
            status: "ACTIVE",
            failure_reason: null,
            collection_blocked: false,
          },
          {
            source_id: "broken-feed",
            status: "DEGRADED",
            collection_blocked: true,
            consecutive_failures: 3,
            failure_reason:
              "HTTP_400 token=private-value https://publisher.example/api",
            collection_hold_reason: "STRUCTURAL_FAILURE",
            checks: { parser: "FAIL", schema: "NOT_VERIFIED" },
            last_checked_at: "2026-09-18T00:00:00Z",
            last_success_at: null,
            endpoint: "private-endpoint",
            rawEvidence: "private-evidence",
          },
        ],
      }),
    });
    expect(result.health.source_issues).toEqual([
      {
        source_id: "broken-feed",
        status: "DEGRADED",
        collection_blocked: true,
        consecutive_failures: 3,
        failure_reason: "HTTP_400 [credential omitted] [URL omitted]",
        collection_hold_reason: "STRUCTURAL_FAILURE",
        failed_checks: ["parser"],
        last_checked_at: "2026-09-18T00:00:00.000Z",
        last_success_at: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private-value|private-endpoint|private-evidence|publisher.example/,
    );
    expect(
      (await checkProductionSmoke({ client: clientFor(valid) })).health
        .source_issues,
    ).toBeNull();
  });
  test("logs only compact stored operational observations and preserves unknown metrics", async () => {
    const result = await checkProductionSmoke({
      client: clientFor(valid, {
        source_counts: { ACTIVE: 3, DEGRADED: 2, DISABLED: 1 },
        source_count_basis: "PERSISTED_REGISTRY_ONLY",
        unobserved_sources: 7,
        sources: [{ credentials: "private-token" }],
        backfill: {
          last_backfill_run: "2026-09-18T03:00:00Z",
          records_processed: 500,
          evidence_processed: 40,
          pages_processed: 2,
          duplicates_skipped: 3,
          sources_completed: 1,
          sources_remaining: 4,
          metrics_basis:
            "Acknowledged automation runs since rollout; pre-rollout unique evidence/page totals are unknown.",
          archive_index: {
            complete: false,
            pagesIndexed: 9,
            invalidRecords: 1,
            nextToken: "private-token",
          },
          sources: [{ checkpoint: "private-token" }],
        },
        jobs: [
          {
            job: "live-refresh",
            status: "FAILED",
            health: "FAILED",
            failure_count: 2,
            last_run: "2026-09-18T03:01:00Z",
            last_success_at: null,
            details: { token: "private-token" },
          },
        ],
      }),
    });
    expect(result.health).toMatchObject({
      source_counts: { ACTIVE: 3, DEGRADED: 2, DISABLED: 1, CANDIDATE: null },
      unobserved_sources: 7,
      backfill: {
        evidence_processed: 40,
        pages_processed: 2,
        archive_index: { complete: false, pagesIndexed: 9 },
      },
      jobs: [
        {
          job: "live-refresh",
          status: "FAILED",
          health: "FAILED",
          last_success_at: null,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-token");
    const unknown = await checkProductionSmoke({ client: clientFor(valid) });
    expect(unknown.health.backfill.evidence_processed).toBeNull();
    expect(unknown.health.unobserved_sources).toBeNull();
  });

  test("checks real API shapes and fails when loaded records have no evidence references", async () => {
    await expect(
      checkProductionSmoke({ client: clientFor(valid) }),
    ).resolves.toMatchObject({
      status: "SUCCESS",
      opportunities: 1,
      evidenceReferences: 1,
    });
    await expect(
      checkProductionSmoke({
        client: clientFor({ ...valid, evidenceReferences: [] }),
      }),
    ).rejects.toThrow(/evidence/);
    await expect(
      checkProductionSmoke({
        client: clientFor({ ...valid, errors: ["storage unavailable"] }),
      }),
    ).rejects.toThrow(/backend/);
  });

  test("rejects malformed API and unsupported evidence references", async () => {
    await expect(
      checkProductionSmoke({
        client: clientFor({ ...valid, sources: undefined }),
      }),
    ).rejects.toThrow(/sources/);
    await expect(
      checkProductionSmoke({
        client: clientFor({ ...valid, evidenceReferences: [{}] }),
      }),
    ).rejects.toThrow(/evidence/);
  });

  test("records empty stored evidence honestly without manufacturing records", async () => {
    await expect(
      checkProductionSmoke({
        client: clientFor({
          ...valid,
          opportunities: [],
          evidenceReferences: [],
        }),
      }),
    ).resolves.toMatchObject({
      status: "SUCCESS",
      dataStatus: "EMPTY",
      opportunities: 0,
    });
  });

  test("records failing browser or static checks as failed and rejects unknown outcomes", async () => {
    let report: any;
    const client = {
      request: async (_: string, options: any) => {
        report = options.body;
        return { status: "SUCCESS" };
      },
    };
    await expect(
      reportQa({
        env: {
          ...env,
          QA_STATIC_RESULT: "failure",
          QA_API_RESULT: "success",
          QA_BROWSER_RESULT: "success",
        },
        client,
      }),
    ).rejects.toThrow(/QA/);
    expect(report).toMatchObject({
      job: "deployment-qa",
      status: "FAILED",
      details: { authenticatedBrowser: false },
    });
  });
});
