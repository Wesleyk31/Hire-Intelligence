import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { planEvidenceRepair } from "../../scripts/plan-evidence-repair.mjs";

const now = "2026-09-16T00:00:00.000Z";
const checksum = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const file = (name: string, data: any) => ({
  name,
  bytes: JSON.stringify(data),
});
const row = (extra = {}) => ({
  id: "db-a",
  sourceKey: "qa-feed",
  externalId: "stable-a",
  project: "Synthetic River Crossing",
  location: "Perth WA",
  description: "Synthetic evidence only",
  sourceObservedAt: "2026-09-01",
  observedAt: now,
  provenance: "https://example.test/evidence/a",
  ...extra,
});
const page = (records: any[], extra = {}) => ({
  origin: "LIVE",
  exportKind: "FULL_STORAGE",
  snapshotId: "fixture-snapshot",
  requestCursor: null,
  nextCursor: null,
  records,
  ...extra,
});
function fixture(
  rows = [row(), row({ id: "db-b", externalId: "stable-b" })],
  indexes = [
    {
      id: "index-1",
      sourceKey: "qa-feed",
      ids: { "stable-a": "db-a" },
      pendingAddIntent: { externalIds: ["stable-b"], preparedAt: now },
    },
  ],
) {
  const inputs = [file("live.json", page(rows))];
  const indexExport = file(
    "indexes.json",
    page(indexes, { origin: undefined }),
  );
  const manifest = {
    snapshotId: "fixture-snapshot",
    capturedAt: now,
    reviewedBy: "fixture-reviewer",
    writerState: "PAUSED",
    collections: {
      opportunities: {
        complete: true,
        rowCount: rows.length,
        files: [{ name: inputs[0].name, sha256: checksum(inputs[0].bytes) }],
      },
      opportunity_indexes: {
        complete: true,
        rowCount: indexes.length,
        files: [
          { name: indexExport.name, sha256: checksum(indexExport.bytes) },
        ],
      },
    },
  };
  return {
    inputs,
    options: {
      sourceKey: "qa-feed",
      now,
      indexExport,
      snapshot: file("snapshot.json", manifest),
    },
    manifest,
  };
}
const codes = (result: any) =>
  result.blockers.map((blocker: any) => blocker.code);
const blocked = (result: any, code: string) => {
  expect(result.status).toBe("BLOCKED");
  expect(result.applicable).toBe(false);
  expect(result.proposal).toBeNull();
  expect(codes(result)).toContain(code);
};

describe("offline source-index reconciliation proposal", () => {
  it("produces exact reviewable mappings with original hashes and current-state preconditions from a complete supplied fixture", () => {
    const { inputs, options } = fixture();
    const originals = JSON.stringify({ inputs, options });
    const result = planEvidenceRepair(inputs, options);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.applicable).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.proposal).toMatchObject({
      sourceKey: "qa-feed",
      indexStorageId: "index-1",
      ids: { "stable-a": "db-a", "stable-b": "db-b" },
    });
    expect(
      result.proposal.mappings.map((item: any) => [
        item.externalId,
        item.previousStorageId,
        item.storageId,
        item.reason,
      ]),
    ).toEqual([
      ["stable-a", "db-a", "db-a", "CONFIRMED_EXISTING"],
      ["stable-b", null, "db-b", "RECOVER_PENDING_ADD"],
    ]);
    expect(result.proposal.mappings[1].evidence.ref).toMatchObject({
      file: "live.json",
      page: 0,
      row: 1,
      reviewId: "LIVE:db-b",
      storageId: "db-b",
    });
    expect(result.proposal.mappings[1].evidence.originalHash).toBe(
      "02cc55e859a8580fd46d499f605f96b5e51a1270c3cdc2a204dcde8062cd8ed1",
    );
    expect(result.indexEvidence[0]).toMatchObject({
      storageId: "index-1",
      pendingAddIntent: { externalIds: ["stable-b"], preparedAt: now },
    });
    expect(result.indexEvidence[0].originalHash).toBe(
      "bc7ea857dad0466ed6e0b8fc6d57c7804274be6aa1ac77d567258b8ab941cd2f",
    );
    expect(result.preconditions.map((item: any) => item.code)).toEqual(
      expect.arrayContaining([
        "REVIEW_PROPOSAL",
        "EXCLUSIVE_WRITER",
        "RECHECK_SNAPSHOT",
        "MATCH_ORIGINAL_HASHES",
        "PRESERVE_ROLLBACK",
        "ACKNOWLEDGE_INDEX_BEFORE_RESUME",
      ]),
    );
    expect(result.inputs[0]).toMatchObject({
      file: "live.json",
      fileHash: checksum(inputs[0].bytes),
      hashOrigin: "FILE_BYTES",
    });
    expect(JSON.stringify({ inputs, options })).toBe(originals);
  });

  it("blocks a partial review cursor chain even when a manifest asserts completeness", () => {
    const { inputs, options } = fixture();
    inputs[0] = file("live.json", {
      origin: "LIVE",
      requestCursor: null,
      nextCursor: "unexported",
      items: [row({ storageId: "db-a", reviewId: "LIVE:db-a" })],
    });
    blocked(planEvidenceRepair(inputs, options), "INCOMPLETE_LIVE_COVERAGE");
  });

  it("blocks review projections even if their cursor chain is terminal", () => {
    const { inputs, options } = fixture();
    inputs[0] = file("live.json", {
      origin: "LIVE",
      requestCursor: null,
      nextCursor: null,
      items: [row({ storageId: "db-a", reviewId: "LIVE:db-a" })],
    });
    blocked(
      planEvidenceRepair(inputs, options),
      "FULL_STORAGE_EXPORT_REQUIRED",
    );
  });

  it("blocks a complete chain that has no reviewed paused snapshot", () => {
    const { inputs, options, manifest } = fixture();
    options.snapshot = file("snapshot.json", {
      ...manifest,
      writerState: "RUNNING",
      reviewedBy: "",
    });
    blocked(
      planEvidenceRepair(inputs, options),
      "UNREVIEWED_OR_UNSTABLE_SNAPSHOT",
    );
  });

  it("does not pick either identical or revised physical duplicates as the winner", () => {
    for (const description of [
      "Synthetic evidence only",
      "Revised description",
    ]) {
      const { inputs, options } = fixture(
        [row(), row({ id: "db-c", description })],
        [],
      );
      const result = planEvidenceRepair(inputs, options);
      blocked(result, "AMBIGUOUS_LIVE_IDENTITY");
      expect(result.inventory.identities[0].storageLocations).toBe(2);
    }
  });

  it("blocks identity collisions at one physical ID and conflicting supplied storage references", () => {
    const collision = fixture([row(), row({ externalId: "stable-b" })], []);
    blocked(
      planEvidenceRepair(collision.inputs, collision.options),
      "PHYSICAL_IDENTITY_COLLISION",
    );
    const mismatched = fixture(
      [row({ storageId: "different-id", reviewId: "LIVE:db-a" })],
      [],
    );
    blocked(
      planEvidenceRepair(mismatched.inputs, mismatched.options),
      "AMBIGUOUS_STORAGE_REFERENCE",
    );
  });

  it("blocks missing identity, physical IDs, and whitespace-normalized identity changes", () => {
    for (const extra of [
      { externalId: "" },
      { id: "" },
      { sourceKey: "" },
      { externalId: " stable-a " },
    ]) {
      const { inputs, options } = fixture([row(extra)], []);
      blocked(planEvidenceRepair(inputs, options), "INVALID_LIVE_IDENTITY");
    }
  });

  it("blocks mismatched file hashes, snapshot IDs, counts, and incomplete index coverage", () => {
    const a = fixture();
    a.inputs[0].bytes += " ";
    blocked(planEvidenceRepair(a.inputs, a.options), "SNAPSHOT_FILE_MISMATCH");
    const b = fixture();
    b.inputs[0] = file("live.json", page([row()], { snapshotId: "different" }));
    blocked(planEvidenceRepair(b.inputs, b.options), "SNAPSHOT_ID_MISMATCH");
    const c = fixture();
    c.manifest.collections.opportunities.rowCount = 400;
    c.options.snapshot = file("snapshot.json", c.manifest);
    blocked(planEvidenceRepair(c.inputs, c.options), "SNAPSHOT_COUNT_MISMATCH");
    const d = fixture();
    d.options.indexExport = file(
      "indexes.json",
      page([], { origin: undefined, nextCursor: "more" }),
    );
    blocked(
      planEvidenceRepair(d.inputs, d.options),
      "INCOMPLETE_INDEX_COVERAGE",
    );
  });

  it("blocks duplicate source indexes, stale mappings, and unresolved pending IDs", () => {
    const duplicate = fixture([row()], [
      { id: "index-1", sourceKey: "qa-feed", ids: { "stable-a": "db-a" } },
      { id: "index-2", sourceKey: "qa-feed", ids: { "stable-a": "db-a" } },
    ] as any);
    blocked(
      planEvidenceRepair(duplicate.inputs, duplicate.options),
      "AMBIGUOUS_SOURCE_INDEX",
    );
    const stale = fixture([row()], [
      { id: "index-1", sourceKey: "qa-feed", ids: { "stable-c": "db-a" } },
    ] as any);
    blocked(
      planEvidenceRepair(stale.inputs, stale.options),
      "INDEX_IDENTITY_COLLISION",
    );
    const pending = fixture([row()]);
    blocked(
      planEvidenceRepair(pending.inputs, pending.options),
      "PENDING_ID_UNRESOLVED",
    );
  });

  it("preserves archived revisions as findings and never maps archive locations into the live index", () => {
    const { inputs, options } = fixture();
    inputs.push(
      file("archive.json", {
        id: "archive-1",
        sourceKey: "qa-feed",
        events: [
          row({ id: undefined, description: "Earlier synthetic revision" }),
        ],
      }),
    );
    const result = planEvidenceRepair(inputs, options);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.inventory.summary.revisionIdentities).toBe(1);
    expect(result.proposal.ids).toEqual({
      "stable-a": "db-a",
      "stable-b": "db-b",
    });
  });

  it("supports explicit no-index snapshots but never drops a dangling existing mapping", () => {
    const bootstrap = fixture([row()], []);
    expect(
      planEvidenceRepair(bootstrap.inputs, bootstrap.options).proposal,
    ).toMatchObject({ indexStorageId: null, ids: { "stable-a": "db-a" } });
    const dangling = fixture([row()], [
      {
        id: "index-1",
        sourceKey: "qa-feed",
        ids: { "stable-z": "db-missing" },
      },
    ] as any);
    blocked(
      planEvidenceRepair(dangling.inputs, dangling.options),
      "DANGLING_INDEX_MAPPING",
    );
  });

  it("reads explicit files through the CLI, retains originals, and rejects URLs and mutation flags", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hire-repair-plan-"));
    try {
      const { inputs, options, manifest } = fixture();
      const livePath = join(directory, "live.json");
      const indexPath = join(directory, "indexes.json");
      const snapshotPath = join(directory, "snapshot.json");
      manifest.collections.opportunities.files[0].name = livePath;
      manifest.collections.opportunity_indexes.files[0].name = indexPath;
      const snapshotBytes = JSON.stringify(manifest);
      await Promise.all([
        writeFile(livePath, inputs[0].bytes),
        writeFile(indexPath, options.indexExport.bytes),
        writeFile(snapshotPath, snapshotBytes),
      ]);
      const script = resolve("scripts/plan-evidence-repair.mjs");
      const output = execFileSync(
        process.execPath,
        [
          script,
          "--source-key",
          "qa-feed",
          "--snapshot",
          snapshotPath,
          "--indexes",
          indexPath,
          "--now",
          now,
          livePath,
        ],
        { encoding: "utf8" },
      );
      expect(JSON.parse(output)).toMatchObject({
        status: "REVIEW_REQUIRED",
        applicable: false,
      });
      expect(await readFile(livePath, "utf8")).toBe(inputs[0].bytes);
      expect(await readFile(indexPath, "utf8")).toBe(options.indexExport.bytes);
      expect(await readFile(snapshotPath, "utf8")).toBe(snapshotBytes);
      for (const args of [
        ["--apply"],
        ["--source-key", "qa-feed", "https://example.test/export.json"],
      ]) {
        expect(
          spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
            .status,
        ).toBe(2);
      }
      expect(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(new URL("../../scripts/plan-evidence-repair.mjs", import.meta.url).href)});`,
          ],
          { encoding: "utf8" },
        ),
      ).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
it("rejects duplicate JSON identity keys instead of silently using the last value", () => {
  const { inputs, options, manifest } = fixture();
  inputs[0].bytes = inputs[0].bytes.replace(
    '"sourceKey":"qa-feed"',
    '"sourceKey":"other-feed","sourceKey":"qa-feed"',
  );
  manifest.collections.opportunities.files[0].sha256 = checksum(
    inputs[0].bytes,
  );
  options.snapshot = file("snapshot.json", manifest);
  expect(() => planEvidenceRepair(inputs, options)).toThrow(
    /Duplicate JSON key/,
  );
});

it("bounds nested envelopes and large row counts before inventory processing", () => {
  const { inputs, options, manifest } = fixture();
  let data = JSON.parse(inputs[0].bytes);
  for (let i = 0; i < 80; i++) data = { pages: [data] };
  inputs[0] = file("live.json", data);
  manifest.collections.opportunities.files[0].sha256 = checksum(
    inputs[0].bytes,
  );
  options.snapshot = file("snapshot.json", manifest);
  expect(() => planEvidenceRepair(inputs, options)).toThrow(/nesting/);
  const many = fixture(Array.from({ length: 100001 }, () => null) as any, []);
  expect(() => planEvidenceRepair(many.inputs, many.options)).toThrow(
    /row limit/,
  );
});

it("blocks markers prepared after capture and malformed page issue metadata", () => {
  const future = fixture([row()], [
    {
      id: "index-1",
      sourceKey: "qa-feed",
      ids: {},
      pendingAddIntent: {
        externalIds: ["stable-a"],
        preparedAt: "2026-09-17T00:00:00Z",
      },
    },
  ] as any);
  blocked(
    planEvidenceRepair(future.inputs, future.options),
    "INVALID_PENDING_INTENT",
  );
  const malformed = fixture();
  malformed.inputs[0] = file(
    "live.json",
    page([row()], { pageIssues: "lost-page" }),
  );
  blocked(
    planEvidenceRepair(malformed.inputs, malformed.options),
    "EXPORT_PAGE_ISSUES",
  );
});

it("blocks repeated cursor receipts, repeated physical rows, and malformed pending markers", () => {
  const repeatPage = fixture();
  repeatPage.inputs[0] = file("live.json", {
    pages: [page([row()]), page([row()])],
  });
  blocked(
    planEvidenceRepair(repeatPage.inputs, repeatPage.options),
    "INCOMPLETE_LIVE_COVERAGE",
  );
  const repeatRow = fixture([row(), row()], []);
  blocked(
    planEvidenceRepair(repeatRow.inputs, repeatRow.options),
    "REPEATED_PHYSICAL_ROW",
  );
  for (const pendingAddIntent of [
    null,
    {},
    { externalIds: ["stable-a", "stable-a"], preparedAt: now },
  ]) {
    const value = fixture([row()], [
      { id: "index-1", sourceKey: "qa-feed", ids: {}, pendingAddIntent },
    ] as any);
    blocked(
      planEvidenceRepair(value.inputs, value.options),
      "INVALID_PENDING_INTENT",
    );
  }
});

it("retains unusual source IDs exactly, isolates other sources, and respects the backend index size bound", () => {
  const value = fixture(
    [
      row({ externalId: "__proto__" }),
      row({ id: "db-elsewhere", sourceKey: "different-feed" }),
    ],
    [],
  );
  const result = planEvidenceRepair(value.inputs, value.options);
  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(Object.keys(result.proposal.ids)).toEqual(["__proto__"]);
  expect(
    Object.getOwnPropertyDescriptor(result.proposal.ids, "__proto__")?.value,
  ).toBe("db-a");
  const large = fixture([row({ id: "x".repeat(224 * 1024) })], []);
  blocked(
    planEvidenceRepair(large.inputs, large.options),
    "INDEX_CAPACITY_REVIEW_REQUIRED",
  );
});

it("rejects original malformed UTF-8 bytes even when the complete snapshot hashes match", async () => {
  const { inputs, options, manifest } = fixture(
    [row({ externalId: "before!after" })],
    [],
  );
  expect(planEvidenceRepair(inputs, options).status).toBe("REVIEW_REQUIRED");
  const invalidBytes = Buffer.from(inputs[0].bytes, "utf8");
  invalidBytes[invalidBytes.indexOf("before!after") + "before".length] = 0xff;
  const originalBytes = Buffer.from(invalidBytes);
  manifest.collections.opportunities.files[0].sha256 = createHash("sha256")
    .update(invalidBytes)
    .digest("hex");
  options.snapshot = file("snapshot.json", manifest);
  expect(() =>
    planEvidenceRepair([{ name: "live.json", bytes: invalidBytes }], options),
  ).toThrow(/utf-8/i);
  expect(invalidBytes).toEqual(originalBytes);

  const directory = await mkdtemp(join(tmpdir(), "hire-repair-invalid-utf8-"));
  try {
    const livePath = join(directory, "live.json");
    const indexPath = join(directory, "indexes.json");
    const snapshotPath = join(directory, "snapshot.json");
    manifest.collections.opportunities.files[0].name = livePath;
    manifest.collections.opportunity_indexes.files[0].name = indexPath;
    await Promise.all([
      writeFile(livePath, invalidBytes),
      writeFile(indexPath, options.indexExport.bytes),
      writeFile(snapshotPath, JSON.stringify(manifest)),
    ]);
    const run = spawnSync(
      process.execPath,
      [
        resolve("scripts/plan-evidence-repair.mjs"),
        "--source-key",
        "qa-feed",
        "--snapshot",
        snapshotPath,
        "--indexes",
        indexPath,
        "--now",
        now,
        livePath,
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr).error).toMatch(/utf-8/i);
    expect(await readFile(livePath)).toEqual(originalBytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
