import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";
import { inspectSupabaseTooling } from "../tools/check-supabase-tooling.mjs";

test("the active chain records production assets and knowledge image links with separate approval gates", async () => {
  const result = await inspectMigrationBaseline();
  const manifest = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const lifecycle = manifest.forwardMigrations.find(entry => entry.file === "20260929025147_knowledge_attachment_lifecycle.sql");
  const teamSharing = manifest.forwardMigrations.find(entry => entry.file === "20260929062422_share_team_documents_with_all_members.sql");
  const productionAssets = manifest.forwardMigrations.find(entry => entry.file === "20260930234912_content_production_assets.sql");
  const knowledgeAssets = manifest.forwardMigrations.find(entry => entry.file === "20261001060319_knowledge_asset_links.sql");

  assert.equal(result.status, "ready");
  assert.equal(result.decision, "apply");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, false);
  assert.deepEqual(result.pendingApprovalMigrations, ["20260930234912_content_production_assets.sql", "20261001060319_knowledge_asset_links.sql", "20261002152810_connection_check_evidence.sql", "20261002193500_agent_document_write_status_policy.sql", "20261002202443_personal_work_notifications.sql", "20261003044602_final_os_channel_connections.sql", "20261003054936_channel_publication_guards_and_comments.sql", "20261003122206_knowledge_page_tree.sql", "20261003143000_document_approval_assignments.sql", "20261003151000_document_change_proposals.sql"]);
  assert.equal(result.baselinePresent, true);
  assert.equal(result.activeMigrationCount, 24);
  assert.equal(result.archivedMigrationCount, 14);
  assert.deepEqual(lifecycle.appliedEnvironments, ["development", "production"]);
  assert.equal(lifecycle.requiresApproval, false);
  assert.deepEqual(teamSharing.appliedEnvironments, ["development", "production"]);
  assert.equal(teamSharing.requiresApproval, false);
  assert.deepEqual(productionAssets.appliedEnvironments, ["development", "production"]);
  assert.equal(productionAssets.developmentApprovedAt, "2026-10-01");
  assert.equal(productionAssets.productionApprovedAt, "2026-10-01");
  assert.equal(productionAssets.requiresApproval, true);
  assert.equal(knowledgeAssets.requiresApproval, true);
  assert.equal(knowledgeAssets.developmentApprovedAt, "2026-10-01");
  assert.equal(knowledgeAssets.productionApprovedAt, "2026-10-01");
  assert.deepEqual(knowledgeAssets.appliedEnvironments, ["development", "production"]);
  assert.deepEqual(result.errors, []);
});

test("Supabase local tooling is pinned and uses guarded defaults", async () => {
  const result = await inspectSupabaseTooling();

  assert.equal(result.cliVersion, "2.117.0");
  assert.equal(result.configValid, true);
  assert.deepEqual(result.errors, []);
});
