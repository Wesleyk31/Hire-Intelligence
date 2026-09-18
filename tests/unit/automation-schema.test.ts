import { describe, expect, test } from "vitest";
import {
  loadSchemaInputs,
  validateAutomationSchema,
} from "../../scripts/check-automation-schema.mjs";

describe("static additive automation migration guards", () => {
  test("accepts the checked repository schema without executing backend storage", async () => {
    expect(validateAutomationSchema(await loadSchemaInputs())).toMatchObject({
      schemaVersion: 1,
      migrations: 2,
    });
  });
  test("rejects removing required provenance fields from persisted source records", async () => {
    const inputs = await loadSchemaInputs();
    inputs.files["backend/source-automation.ts"] = inputs.files[
      "backend/source-automation.ts"
    ].replace(/provenance_url:\s*string;/, "");
    expect(() => validateAutomationSchema(inputs)).toThrow(
      /REQUIRED_REGISTRY_FIELD:provenance_url/,
    );
  });
  test("rejects destructive datastore calls added to an automation module", async () => {
    const inputs = await loadSchemaInputs();
    inputs.files["backend/automation-state.ts"] +=
      '\nasync function destructiveMigration() { await db.delete("backfill_cursors", ["legacy"]); }';
    expect(() => validateAutomationSchema(inputs)).toThrow(
      /DESTRUCTIVE_DATABASE_OPERATION/,
    );
  });
  test("rejects a migration that resets existing backfill checkpoints", async () => {
    const inputs = await loadSchemaInputs();
    inputs.files["backend/automation-state.ts"] = inputs.files[
      "backend/automation-state.ts"
    ].replace(
      /export async function ensureAutomationSchema\(\)\s*\{/,
      'export async function ensureAutomationSchema() { await save("backfill_cursors", {cursor: 0});',
    );
    expect(() => validateAutomationSchema(inputs)).toThrow(
      /MIGRATION_WRITE_OUTSIDE_NEW_SCHEMA/,
    );
  });
  test("rejects duplicate live/historical source identities", async () => {
    const inputs = await loadSchemaInputs();
    inputs.files["backend/index.ts"] = inputs.files["backend/index.ts"].replace(
      /key:\s*['"]qld-environmental-authorities['"]/,
      "key: 'wa-mining-tenements'",
    );
    expect(() => validateAutomationSchema(inputs)).toThrow(
      /DUPLICATE_SOURCE_KEY/,
    );
  });
  test("rejects an OIDC allowlist pointing to a workflow absent from the repository", async () => {
    const inputs = await loadSchemaInputs();
    inputs.files["backend/automation-auth.ts"] = inputs.files[
      "backend/automation-auth.ts"
    ].replaceAll("source-health.yml", "missing-health.yml");
    expect(() => validateAutomationSchema(inputs)).toThrow(
      /WORKFLOW_NOT_FOUND:missing-health.yml/,
    );
  });
});
