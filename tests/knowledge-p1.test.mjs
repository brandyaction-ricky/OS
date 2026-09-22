import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { updateFolderInventory, inKnowledgeScope, draftChanged, documentDraft } from '../lib/knowledge-workspace-state.ts';
import { executeFolderMoves, planFolderMove, normalizeKnowledgeFolder } from '../lib/knowledge-folders.ts';
import { markdownInlineTokens, safeMarkdownUrl } from '../lib/knowledge-markdown.ts';
import { createLatestSearch } from '../lib/knowledge-search-state.ts';

const document = (overrides = {}) => ({id:'doc-a', title:'Example', content_md:'Original', folder:'Library/Notes', status:'draft', owner_id:'owner-a', current_version:3, brand:'', team:'', tags:[], ...overrides});
const counts = inventory => Object.fromEntries(inventory.map(item => [item.path, item.count]));

test('create, move, archive and restore keep unloaded folder totals accurate', () => {
  let inventory = [{path:'Library/Notes', count:125}, {path:'Other', count:45}];
  const created = document({folder:'New/Sub'});
  inventory = updateFolderInventory(inventory, undefined, created, 'all', 'owner-a');
  assert.deepEqual(counts(inventory), {'Library/Notes':125, Other:45, 'New/Sub':1});
  const moved = {...created, folder:'Library/Notes'};
  inventory = updateFolderInventory(inventory, created, moved, 'all', 'owner-a');
  assert.deepEqual(counts(inventory), {'Library/Notes':126, Other:45});
  const archived = {...moved, status:'archived'};
  inventory = updateFolderInventory(inventory, moved, archived, 'all', 'owner-a');
  assert.equal(counts(inventory)['Library/Notes'], 125);
  inventory = updateFolderInventory(inventory, archived, moved, 'all', 'owner-a');
  assert.equal(counts(inventory)['Library/Notes'], 126);
});

test('scope counts follow status transitions without adding invisible documents', () => {
  const initial = document({status:'team'});
  const review = {...initial, status:'review'};
  assert.deepEqual(updateFolderInventory([{path:initial.folder,count:1}], initial, review, 'team', 'owner-a'), []);
  assert.deepEqual(counts(updateFolderInventory([], initial, review, 'review', 'owner-a')), {[initial.folder]:1});
  assert.deepEqual(updateFolderInventory([], undefined, document({owner_id:'other'}), 'mine', 'owner-a'), []);
  assert.equal(inKnowledgeScope(document({status:'canonical', owner_id:'other'}), 'mine_company', 'owner-a'), true);
  assert.equal(inKnowledgeScope(document({status:'archived'}), 'all', 'owner-a'), false);
  assert.equal(inKnowledgeScope(document({status:'archived'}), 'archived', 'owner-a'), true);
});

test('editing only metadata does not duplicate inventory counts', () => {
  const before = document();
  assert.deepEqual(counts(updateFolderInventory([{path:before.folder,count:150}], before, {...before,title:'Renamed'}, 'all')), {[before.folder]:150});
});

test('draft comparison catches content and metadata changes, including reverting edits', () => {
  const baseline = documentDraft(document());
  for (const key of Object.keys(baseline)) assert.equal(draftChanged({...baseline,[key]:baseline[key]+' change'},baseline),true);
  assert.equal(draftChanged({...baseline},baseline),false);
});

test('folder moves include descendants, preserve IDs and exclude similar prefixes', () => {
  const rows = [document(), document({id:'doc-b',folder:'Library/Notes/Sub'}),document({id:'doc-c',folder:'Library/NotesElsewhere'})];
  const plan = planFolderMove(rows,'Library/Notes','Archive/Moved');
  assert.deepEqual(plan.map(item => [item.id,item.to,item.version]),[['doc-a','Archive/Moved',3],['doc-b','Archive/Moved/Sub',3]]);
  assert.equal(rows[0].folder,'Library/Notes');
});

test('folder validation rejects descendant moves and overlong descendant destinations before writing', () => {
  assert.throws(() => planFolderMove([document()],'Library','Library/Sub'));
  assert.throws(() => planFolderMove([document()],'Library','Library'));
  assert.throws(() => planFolderMove([document({folder:'Library/'+ 's'.repeat(120)})],'Library','t'.repeat(60)));
  assert.equal(normalizeKnowledgeFolder(' / Library // Notes / '),'Library/Notes');
  assert.throws(() => normalizeKnowledgeFolder('Library/   /Notes'));
});

test('a partially failed batch reports exact failures and retries only unfinished items', async () => {
  const plan = planFolderMove([document(),document({id:'doc-b',folder:'Library/Notes/Sub'})],'Library','Archive');
  const writes = [], progress = [];
  const first = await executeFolderMoves(plan, async item => { writes.push(item.id); if(item.id==='doc-b') throw new Error('Version conflict'); return item; }, count => progress.push(count));
  assert.deepEqual(first.succeeded.map(item=>item.id),['doc-a']);
  assert.equal(first.failed[0].message,'Version conflict');
  const retry = await executeFolderMoves(first.failed.map(item=>item.move), async item => { writes.push(item.id); return item; },()=>{});
  assert.deepEqual(writes,['doc-a','doc-b','doc-b']);
  assert.deepEqual(progress,[1,2]);
  assert.equal(retry.failed.length,0);
});

test('links, nested URL parentheses, images, wiki references and inline code stay distinct', () => {
  const tokens = markdownInlineTokens('[Page](https://example.com/a_(b)) ![Photo](https://example.com/a.png) ![[missing.png|Photo]] [[Note#Part|Read]] `[not link](https://example.com)` **bold**');
  assert.deepEqual(tokens.filter(item=>item.type!=='text').map(item=>item.type),['link','image','image','wiki','code','bold']);
  assert.equal(tokens[0].target,'https://example.com/a_(b)');
});

test('Markdown URLs reject executable schemes and credentials while preserving internal environments', () => {
  for (const url of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,x','file:///private/file','//evil.test/x','https://user:pass@example.com','https://example.com/\npath','/\\evil.test']) assert.equal(safeMarkdownUrl(url),null,url);
  assert.equal(safeMarkdownUrl('https://brandyaction-os.vercel.app/knowledge?document=example#part'),'/knowledge?document=example#part');
  assert.equal(safeMarkdownUrl('https://example.com/a.png',true),'https://example.com/a.png');
  assert.equal(safeMarkdownUrl('private/photo.png',true),null);
  assert.equal(safeMarkdownUrl('mailto:test@example.com'),'mailto:test@example.com');
});

test('late search responses cannot replace a newer response or update an unmounted view', async () => {
  const gate = createLatestSearch();
  let releaseOld;
  let displayed = null;
  const first = gate.start();
  const old = new Promise(resolve=>{releaseOld=resolve;}).then(value=>{if(gate.current(first)) displayed=value;});
  const second = gate.start();
  if(gate.current(second)) displayed='new';
  releaseOld('old'); await old;
  assert.equal(displayed,'new');
  gate.invalidate(); assert.equal(gate.current(second),false);
});

test('review-return migration only adds the active-reviewer return transition and retains all existing rules', () => {
  const baseline = readFileSync(new URL('../supabase/migrations/20260917082749_core_baseline.sql',import.meta.url),'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20260922063605_knowledge_review_return.sql',import.meta.url),'utf8');
  const signature = 'CREATE OR REPLACE FUNCTION "public"."os_set_document_status"';
  const functionBody = sql => sql.slice(sql.indexOf(signature),sql.indexOf('\n$$;',sql.indexOf(signature))+4);
  const addition = "    when v_from = 'review' and p_to = 'team' then v_active or v_admin\n";
  assert.ok(migration.includes(addition));
  assert.equal(functionBody(migration).replace(addition,''),functionBody(baseline));
  assert.match(migration,/FROM PUBLIC, anon/);
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
