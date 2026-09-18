import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const backendFiles = [
  "backend/index.ts",
  "backend/source-contracts.ts",
  "backend/source-automation.ts",
  "backend/source-admission.ts",
  "backend/automation-state.ts",
  "backend/automation-auth.ts",
  "backend/archive-storage.ts",
  "backend/backfill.ts",
];
const fail = (message) => {
  throw new Error(message);
};
const unwrap = (node) => {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
};
const nameOf = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
    ? node.text
    : undefined;
const stringValue = (node) => {
  node = unwrap(node);
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
};
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function declaration(file, name) {
  let found;
  walk(file, (node) => {
    if (ts.isVariableDeclaration(node) && nameOf(node.name) === name)
      found = node.initializer;
  });
  if (!found) fail("MISSING_DECLARATION:" + name);
  return unwrap(found);
}
function objectEntries(node, label) {
  node = unwrap(node);
  if (!node || !ts.isObjectLiteralExpression(node))
    fail("STATIC_OBJECT_REQUIRED:" + label);
  const entries = new Map();
  for (const property of node.properties) {
    const name = nameOf(property.name);
    if (!ts.isPropertyAssignment(property) || !name)
      fail("STATIC_PROPERTY_REQUIRED:" + label);
    if (entries.has(name)) fail("DUPLICATE_OBJECT_KEY:" + label + ":" + name);
    entries.set(name, unwrap(property.initializer));
  }
  return entries;
}
function typeAlias(file, name) {
  const found = file.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === name,
  );
  if (!found) fail("MISSING_SCHEMA_TYPE:" + name);
  return found.type;
}
function typeFields(file, name) {
  const type = typeAlias(file, name);
  if (!ts.isTypeLiteralNode(type)) fail("SCHEMA_OBJECT_REQUIRED:" + name);
  return new Map(
    type.members
      .filter(ts.isPropertySignature)
      .map((field) => [nameOf(field.name), field]),
  );
}
function literals(type) {
  return (ts.isUnionTypeNode(type) ? type.types : [type])
    .filter(ts.isLiteralTypeNode)
    .map((item) => stringValue(item.literal))
    .filter(Boolean);
}
function functionBody(file, name) {
  const found = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!found?.body) fail("MISSING_MIGRATION:" + name);
  return found.body;
}
function dbMethod(call) {
  const target = call.expression;
  if (
    ts.isPropertyAccessExpression(target) &&
    nameOf(target.expression) === "db"
  )
    return target.name.text;
  if (
    ts.isElementAccessExpression(target) &&
    nameOf(target.expression) === "db"
  )
    return stringValue(target.argumentExpression);
  return undefined;
}

export async function loadSchemaInputs(root = new URL("../", import.meta.url)) {
  const contents = await Promise.all(
    backendFiles.map(async (name) => [
      name,
      await readFile(new URL(name, root), "utf8"),
    ]),
  );
  return {
    files: Object.fromEntries(contents),
    workflows: (await readdir(new URL(".github/workflows/", root))).filter(
      (name) => name.endsWith(".yml"),
    ),
  };
}

/** Structural rollout guard only: parse source; never import backend code or call a production database. */
export function validateAutomationSchema({ files, workflows }) {
  const parsed = Object.fromEntries(
    backendFiles.map((name) => {
      if (typeof files[name] !== "string") fail("MISSING_SCHEMA_INPUT:" + name);
      const file = ts.createSourceFile(
        name,
        files[name],
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      if (file.parseDiagnostics.length)
        fail("TYPESCRIPT_PARSE_FAILURE:" + name);
      return [name, file];
    }),
  );
  const registry = parsed["backend/source-automation.ts"];
  const fields = typeFields(registry, "SourceRegistryRecord");
  for (const required of [
    "registry_schema_version",
    "source_id",
    "source_name",
    "publisher",
    "jurisdiction",
    "category",
    "endpoint",
    "provenance_url",
    "dataset_id",
    "machine_readable_format",
    "licence_name",
    "licence_url",
    "access_requirements",
    "legal_review_status",
    "activation_basis",
    "contract_version",
    "status",
    "collection_blocked",
    "collection_hold_reason",
    "last_checked_at",
    "last_success_at",
    "last_failure_at",
    "consecutive_failures",
    "failure_reason",
    "response_latency",
    "schema_version",
    "last_record_timestamp",
    "freshness_status",
    "checks",
    "retry_count",
    "backfill_checkpoint",
    "backfill_complete",
    "records_processed",
    "evidence_processed",
    "created_at",
    "updated_at",
  ]) {
    if (!fields.has(required) || fields.get(required).questionToken)
      fail("REQUIRED_REGISTRY_FIELD:" + required);
  }
  const version = fields.get("registry_schema_version").type;
  if (!ts.isLiteralTypeNode(version) || version.literal.getText() !== "1")
    fail("UNSUPPORTED_REGISTRY_SCHEMA_VERSION");
  const statuses = literals(typeAlias(registry, "SourceStatus"));
  for (const status of [
    "ACTIVE",
    "DEGRADED",
    "DISABLED",
    "CANDIDATE",
    "VALIDATING",
    "VERIFIED",
    "REVIEW_REQUIRED",
    "REJECTED",
  ]) {
    if (!statuses.includes(status)) fail("MISSING_ADMISSION_STATE:" + status);
  }
  if (!literals(typeAlias(registry, "CheckStatus")).includes("NOT_VERIFIED"))
    fail("UNKNOWN_CHECK_STATE_REQUIRED");

  const sourceKeys = new Set();
  for (const name of ["SOURCES", "HISTORICAL_SOURCES"]) {
    const array = declaration(parsed["backend/index.ts"], name);
    if (!ts.isArrayLiteralExpression(array))
      fail("STATIC_SOURCE_CATALOG_REQUIRED:" + name);
    for (const row of array.elements) {
      const key = stringValue(objectEntries(row, name).get("key"));
      if (!key || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(key))
        fail("INVALID_SOURCE_KEY:" + key);
      if (sourceKeys.has(key)) fail("DUPLICATE_SOURCE_KEY:" + key);
      sourceKeys.add(key);
    }
  }
  const contracts = parsed["backend/source-contracts.ts"];
  const candidates = objectEntries(
    declaration(contracts, "SOURCE_PILOT_CONTRACTS"),
    "candidate contracts",
  );
  const candidateType = literals(typeAlias(contracts, "SourcePilotKey"));
  for (const [key, row] of candidates) {
    if (
      stringValue(objectEntries(row, key).get("key")) !== key ||
      !candidateType.includes(key)
    )
      fail("CANDIDATE_KEY_MISMATCH:" + key);
    if (sourceKeys.has(key)) fail("CANDIDATE_COLLIDES_WITH_SOURCE:" + key);
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(key))
      fail("INVALID_CANDIDATE_KEY:" + key);
  }
  if (candidateType.some((key) => !candidates.has(key)))
    fail("CANDIDATE_TYPE_WITHOUT_CONTRACT");

  const state = parsed["backend/automation-state.ts"];
  const jobPolicies = objectEntries(
    declaration(state, "JOB_POLICIES"),
    "JOB_POLICIES",
  );
  const authPolicies = objectEntries(
    declaration(parsed["backend/automation-auth.ts"], "WORKFLOW_JOBS"),
    "WORKFLOW_JOBS",
  );
  for (const [workflow, jobs] of authPolicies) {
    if (!workflows.includes(workflow)) fail("WORKFLOW_NOT_FOUND:" + workflow);
    if (!ts.isArrayLiteralExpression(jobs))
      fail("STATIC_WORKFLOW_JOBS_REQUIRED:" + workflow);
    for (const job of jobs.elements.map(stringValue)) {
      if (!jobPolicies.has(job)) fail("UNSUPPORTED_AUTHORIZED_JOB:" + job);
      const configured = stringValue(
        objectEntries(jobPolicies.get(job), job).get("workflow"),
      );
      if (configured !== workflow) fail("JOB_WORKFLOW_AUTH_MISMATCH:" + job);
    }
  }
  for (const [job, policy] of jobPolicies) {
    const definition = objectEntries(policy, job);
    const workflow = stringValue(definition.get("workflow"));
    if (!workflows.includes(workflow)) fail("WORKFLOW_NOT_FOUND:" + workflow);
    const allowed = authPolicies.get(workflow);
    if (
      !allowed ||
      !ts.isArrayLiteralExpression(allowed) ||
      !allowed.elements.map(stringValue).includes(job)
    )
      fail("JOB_NOT_AUTHORIZED:" + job);
    if (
      !ts.isNumericLiteral(definition.get("expectedMinutes")) ||
      Number(definition.get("expectedMinutes").text) <= 0
    )
      fail("INVALID_JOB_CADENCE:" + job);
  }

  for (const name of [
    "backend/source-automation.ts",
    "backend/source-admission.ts",
    "backend/automation-state.ts",
    "backend/archive-storage.ts",
    "backend/backfill.ts",
  ]) {
    walk(parsed[name], (node) => {
      if (
        ts.isCallExpression(node) &&
        dbMethod(node) &&
        !["list", "get", "add", "update"].includes(dbMethod(node))
      ) {
        fail("DESTRUCTIVE_DATABASE_OPERATION:" + name + ":" + dbMethod(node));
      }
    });
  }
  const schemaMigration = functionBody(state, "ensureAutomationSchema");
  let schemaWrites = 0;
  walk(schemaMigration, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (dbMethod(node) && dbMethod(node) !== "list")
      fail("MIGRATION_DIRECT_DATABASE_MUTATION");
    if (nameOf(node.expression) !== "save") return;
    if (stringValue(node.arguments[0]) !== "automation_schema")
      fail("MIGRATION_WRITE_OUTSIDE_NEW_SCHEMA");
    const record = objectEntries(node.arguments[1], "schema migration record");
    if (
      record.get("version")?.getText() !== "1" ||
      record.get("legacy_data_preserved")?.kind !== ts.SyntaxKind.TrueKeyword
    )
      fail("UNSUPPORTED_AUTOMATION_MIGRATION");
    let parent = node.parent,
      guarded = false;
    while (parent && parent !== schemaMigration) {
      if (
        ts.isIfStatement(parent) &&
        ts.isPrefixUnaryExpression(parent.expression) &&
        parent.expression.operator === ts.SyntaxKind.ExclamationToken &&
        nameOf(parent.expression.operand) === "old"
      )
        guarded = true;
      parent = parent.parent;
    }
    if (!guarded) fail("MIGRATION_MUST_PRESERVE_EXISTING_SCHEMA");
    schemaWrites++;
  });
  if (schemaWrites !== 1) fail("EXPECTED_ONE_ADDITIVE_SCHEMA_MARKER");

  const archiveMigration = functionBody(
    parsed["backend/archive-storage.ts"],
    "prepareArchiveIdentityIndex",
  );
  let checkpointTable,
    legacyReads = 0,
    migrationWrites = 0,
    resumes = false;
  walk(archiveMigration, (node) => {
    if (ts.isVariableDeclaration(node)) {
      if (nameOf(node.name) === "table")
        checkpointTable = stringValue(node.initializer);
      if (nameOf(node.name) === "state") {
        const value = unwrap(node.initializer);
        resumes =
          ts.isBinaryExpression(value) &&
          value.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
          nameOf(value.left) === "saved";
      }
    }
    if (!ts.isCallExpression(node)) return;
    if (dbMethod(node)) {
      if (
        dbMethod(node) !== "list" ||
        stringValue(node.arguments[0]) !== "evidence_pages"
      )
        fail("LEGACY_MIGRATION_MUST_READ_ONLY");
      const options = objectEntries(node.arguments[1], "legacy indexing read");
      if (options.get("limit")?.getText() !== "1" || !options.has("nextToken"))
        fail("LEGACY_MIGRATION_MUST_BE_BOUNDED");
      legacyReads++;
    }
    if (nameOf(node.expression) === "save") {
      if (
        nameOf(node.arguments[0]) !== "table" ||
        nameOf(node.arguments[1]) !== "state"
      )
        fail("LEGACY_MIGRATION_CHECKPOINT_WRITE_INVALID");
      migrationWrites++;
    }
  });
  if (
    checkpointTable !== "archive_identity_migration" ||
    legacyReads !== 1 ||
    migrationWrites !== 1 ||
    !resumes
  )
    fail("LEGACY_MIGRATION_MUST_RESUME_ADDITIVELY");
  return {
    schemaVersion: 1,
    sourceKeys: sourceKeys.size,
    candidateKeys: candidates.size,
    workflows: authPolicies.size,
    jobs: jobPolicies.size,
    migrations: 2,
    scope:
      "Static TypeScript AST checks only; no production database connection or migration execution.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(validateAutomationSchema(await loadSchemaInputs())),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
