/** Opt-in, isolated DEV integration runner. Never reads Production keys or rows. */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules/.bin/supabase');
const ref = process.env.FINANCE_QA_PROJECT_REF;
const mode = process.argv[2];
if (!ref || process.env.FINANCE_QA_CONFIRM !== 'isolated-dev') throw new Error('Explicit isolated DEV target and confirmation required');
function command(args) {
  try { return execFileSync(cli, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`Supabase CLI failed (${args[0]} ${args[1]}): ${String(e.stderr || '').replace(/eyJ\S+|sb_secret_\S+/g, '[redacted]').slice(-1400)}`); }
}
const projects = JSON.parse(command(['projects', 'list', '--output', 'json']));
const target = projects.find(p => p.id === ref);
assert.equal(target?.name, 'brandyaction-os-dev', 'Target must be the existing isolated OS DEV project');
assert.equal(target.status, 'ACTIVE_HEALTHY');
function sql(query) {
  return JSON.parse(command(['db', 'query', '--linked', '--project-ref', ref, '--output', 'json', query])).rows;
}

if (mode === 'prepare-migration') {
  const pre = sql("select (select count(*) from pg_tables where schemaname='public' and tablename like 'os_fin_%') as tables, to_regprocedure('public.os_has_finance_access()') is not null as finance, to_regprocedure('public.os_is_active_member()') is not null as member")[0];
  assert.equal(pre.tables, 0); assert.ok(pre.finance && pre.member);
  const history = sql('select version, name, statements from supabase_migrations.schema_migrations order by version');
  const stage = mkdtempSync(path.join(tmpdir(), 'finance-migration-'));
  mkdirSync(path.join(stage, 'supabase/migrations'), { recursive: true });
  writeFileSync(path.join(stage, 'supabase/config.toml'), 'project_id = "finance-dev-qa"\n[db.seed]\nenabled = false\n');
  // Mirror already-applied history as generated staging inputs. No history repair or replay.
  for (const h of history) {
    assert.match(h.version, /^\d{14}$/); assert.match(h.name, /^[a-z0-9_]+$/);
    const relative = `supabase/migrations/${h.version}_${h.name}.sql`;
    let historical = h.statements?.length ? h.statements.join(';\n') : null;
    if (!historical) {
      // Some older CLI entries omit statements; use actual committed repository SQL only.
      const commit = execFileSync('git', ['log', '--all', '-1', '--format=%H', '--', relative], { cwd: root, encoding: 'utf8' }).trim();
      assert.match(commit, /^[0-9a-f]{40}$/, 'Missing historical SQL; do not invent replacement history');
      historical = execFileSync('git', ['show', `${commit}:${relative}`], { cwd: root, encoding: 'utf8' });
    }
    writeFileSync(path.join(stage, relative), historical);
  }
  const file = '20261007085710_finance_ledger.sql';
  const content = readFileSync(path.join(root, 'supabase/migrations', file));
  writeFileSync(path.join(stage, 'supabase/migrations', file), content);
  console.log(JSON.stringify({ target: target.name, appliedHistoryMirrored: history.length, stage, migration: file, sha256: createHash('sha256').update(content).digest('hex') }));
  process.exit(0);
}

if (mode !== 'test') throw new Error('Supported modes: prepare-migration, test');
const keys = JSON.parse(command(['projects', 'api-keys', '--project-ref', ref, '--output', 'json']));
const pub = keys.find(k => k.name === 'anon')?.api_key;
const secret = keys.find(k => k.name === 'service_role')?.api_key;
assert.ok(pub && secret, 'DEV API keys unavailable');
const url = `https://${ref}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, secret, options);
const anon = createClient(url, pub, options);
const run = randomUUID();
const users = []; const objects = []; const owned = new Map(); const results = [];
const port = Number(process.env.FINANCE_QA_PORT || 3118);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Use an unprivileged local QA port');
const baseUrl = `http://127.0.0.1:${port}`;
let server, browserCredentials;
const check = (name, fn) => fn().then(() => { results.push(name); console.log(`PASS ${name}`); });
const ok = (r) => { if (r.error) throw new Error(`DEV operation rejected: ${r.error.code || r.error.status || r.error.message}`); return r.data; };
const track = (resource, id) => { if (!owned.has(resource)) owned.set(resource, new Set()); owned.get(resource).add(id); };
async function insert(resource, row) { const id = row.id || randomUUID(); track(resource, id); return ok(await service.from(`os_fin_${resource}`).insert({ ...row, id, created_by: users[0], updated_by: users[0] }).select().single()); }
async function api(actor, route, method = 'GET', body) {
  const r = await fetch(`${baseUrl}/api/v1/finance/${route}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {} };
}
async function batch(actor, changes, expected = 200) {
  for (const c of changes) if (c.row.version === 0) track(c.resource, c.row.id);
  const response = await api(actor, 'batch', 'POST', { changes });
  assert.equal(response.status, expected, response.body.error?.code);
  return response.body;
}
async function identity(label, role, finance, active = true) {
  const email = `finance-qa-${run}-${label}@example.test`, password = randomBytes(30).toString('base64url');
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Finance QA ${label}` } })).user;
  users.push(user.id);
  ok(await service.from('os_profiles').update({ role, finance_access: finance, is_active: active, must_change_password: false }).eq('id', user.id));
  const client = createClient(url, pub, options);
  const session = ok(await client.auth.signInWithPassword({ email, password })).session;
  return { id: user.id, client, token: session.access_token, email, password };
}
try {
  // Refuse an occupied port before creating fixtures or sending requests to another server.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const finance = await identity('finance', 'member', true);
  const admin = await identity('admin', 'admin', false);
  const member = await identity('member', 'member', false);
  const inactive = await identity('inactive', 'member', true, false);
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      OS_ENVIRONMENT: 'development', NEXT_PUBLIC_DEMO_MODE: 'false', NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub, SUPABASE_SERVICE_ROLE_KEY: secret, FINANCE_REFUND_MODE: 'mock',
      FINANCE_TOSS_MODE: 'mock', FINANCE_BANK_PROVIDER: 'excel', FINANCE_MEMO_REQUEST_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Drain without logging application output or credentials during a long browser session.
  server.stdout.resume(); server.stderr.resume();
  let ready = false;
  for (let i = 0; i < 90; i++) {
    assert.equal(server.exitCode, null, 'Local QA server exited before readiness');
    try { const r = await fetch(`${baseUrl}/api/v1/finance/workspace?resource=cards`); if (r.status === 401) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'Local DEV server did not become ready');
  // Test steps are deliberately serial: stop at the first broken boundary.
  await check('API denies anonymous, ordinary and inactive users', async () => {
    assert.equal((await api(null, 'cards')).status, 401);
    assert.equal((await api(member, 'cards')).status, 403);
    assert.equal((await api(inactive, 'cards')).status, 403);
    assert.equal((await api(admin, 'cards')).status, 200);
  });
  await check('Toss read routes enforce real profile authorization and disconnected mode', async () => {
    for (const actor of [null, member, inactive]) {
      assert.equal((await api(actor, 'toss/status?biz=edu')).status, actor ? 403 : 401);
    }
    const connected = await api(finance, 'toss/status?biz=edu');
    assert.equal(connected.status, 200);
    assert.equal(connected.body.configured, false);
    assert.equal(connected.body.readOnly, true);
    assert.equal((await api(finance, 'toss/transactions?biz=edu&from=2026-09-01&to=2026-09-02')).status, 409);
    assert.equal((await api(finance, 'toss/transactions?biz=edu&from=2026-09-01&to=2026-09-02', 'POST')).status, 405);
    assert.equal((await api(finance, 'toss/status?biz=unknown')).status, 400);
  });
  await check('Data API RLS denies unauthorized reads and writes', async () => {
    assert.ok((await anon.from('os_fin_cards').select('id')).error);
    assert.deepEqual(ok(await member.client.from('os_fin_cards').select('id')), []);
    assert.deepEqual(ok(await inactive.client.from('os_fin_cards').select('id')), []);
    assert.ok((await member.client.from('os_fin_cards').insert({ name: 'Denied QA', last4: '1234' })).error);
    for (const client of [anon, member.client, inactive.client]) {
      assert.ok((await client.rpc('os_fin_log_action', { p_kind: 'csv_export', p_view: 'cards', p_ids: [] })).error);
      assert.ok((await client.rpc('os_fin_refund_command', { p_command: 'request', p_id: null, p_version: 0, p_payment: randomUUID(), p_amount: 1, p_reason: 'Denied QA' })).error);
    }
  });
  const revenue = { id: randomUUID(), version: 0, archived_at: null, kind: 'outsource', biz: 'ba', title: `QA ${run}`, client: 'Synthetic', revenue_date: '2026-09-15', usd: null, supply: 100000, vat: 10000, due_date: null, invoice: '', memo: '' };
  let saved;
  await check('Create and re-read external revenue through actual API and DB', async () => {
    saved = (await batch(finance, [{ resource: 'external_revenues', row: revenue }])).changes[0].row;
    assert.equal(saved.version, 1); assert.equal(saved.created_by, finance.id);
    assert.equal((await api(finance, `external-revenues/${revenue.id}`)).body.row.supply, 100000);
  });
  await check('Stale update returns conflict and leaves latest value intact', async () => {
    await batch(finance, [{ resource: 'external_revenues', row: { ...revenue, version: 1, memo: 'Latest QA' } }]);
    await batch(finance, [{ resource: 'external_revenues', row: { ...revenue, version: 1, memo: 'Stale QA' } }], 409);
    assert.equal((await api(finance, `external-revenues/${revenue.id}`)).body.row.memo, 'Latest QA');
  });
  await check('Concurrent same-version edits allow exactly one winner', async () => {
    const changes = memo => ({ changes: [{ resource: 'external_revenues', row: { ...revenue, version: 2, memo } }] });
    const attempts = await Promise.all(['A', 'B'].map(m => api(finance, 'batch', 'POST', changes(m))));
    assert.deepEqual(attempts.map(x => x.status).sort(), [200, 409]);
  });
  await check('DB rejects a late invalid row and rolls back the entire batch', async () => {
    const id = randomUUID(); track('external_revenues', id);
    const result = await finance.client.rpc('os_fin_commit', { p_changes: [
      { resource: 'external_revenues', row: { ...revenue, id } },
      { resource: 'budget_actuals', row: { id: randomUUID(), version: 0, item_id: randomUUID(), month: '2026-09-01', amount: 1 } },
    ] });
    assert.ok(result.error); assert.equal(ok(await service.from('os_fin_external_revenues').select('id').eq('id', id)).length, 0);
  });
  const account = n => ({ id: randomUUID(), version: 0, archived_at: null, bank: 'QA 은행', name: `QA ${n} ${run.slice(0, 8)}`, last4: '1234', uses: [], method: 'excel', sync_freq: 'daily_0700', include_in_net: true, opening_balance: null });
  const a = account('A'), b = account('B');
  await check('Bank accounts persist; archive and restore are reversible', async () => {
    await batch(finance, [{ resource: 'bank_accounts', row: a }, { resource: 'bank_accounts', row: b }]);
    await batch(finance, [{ resource: 'bank_accounts', row: { ...b, version: 1, archived_at: new Date().toISOString() } }]);
    await batch(finance, [{ resource: 'bank_accounts', row: { ...b, version: 2 } }]);
    assert.equal((await api(finance, `bank-accounts/${b.id}`)).body.row.archived_at, null);
  });
  const importBody = { kind: 'cards', rows: [ { date: '2026-09-10', time: '09:00', last: '9876', merchant: 'QA Software', appr: run, krw: 12000 } ], cards: [{ last: '9876', name: 'QA 카드', user: '가상 담당' }], fileName: 'synthetic.csv', headers: ['qa', run], mapping: { date: 0, amount: 1 } };
  async function importRows(body) {
    const r = await api(finance, 'imports/commit', 'POST', body); assert.equal(r.status, 200, r.body.error?.code);
    for (const c of r.body.changes) track(c.resource, c.row.id);
    return r.body;
  }
  let cardTx;
  await check('Card import commits mapping, card, batch and transaction atomically', async () => {
    const result = await importRows(importBody); assert.equal(result.inserted, 1);
    cardTx = result.changes.find(c => c.resource === 'card_transactions').row;
    assert.equal(result.changes.find(c => c.resource === 'import_mappings').row.columns.amount, 1);
  });
  await check('Reimport deduplicates approval; FX update preserves manual fields', async () => {
    const again = await importRows(importBody); assert.equal(again.inserted, 0); assert.equal(again.duplicates, 1);
    ok(await finance.client.from('os_fin_card_transactions').update({ manual_category: '지급수수료', manual_biz: 'common', manual_vat: '판단 필요', memo: 'Keep QA memo' }).eq('id', cardTx.id));
    const updated = await importRows({ ...importBody, rows: [{ ...importBody.rows[0], krw: 13000, fx: 10, cur: 'USD' }] });
    cardTx = updated.changes.find(c => c.resource === 'card_transactions').row;
    assert.equal(cardTx.amount_krw, 13000); assert.equal(cardTx.memo, 'Keep QA memo'); assert.equal(cardTx.manual_category, '지급수수료');
  });
  await check('Receipt limits and unuploaded/wrong transaction paths are rejected', async () => {
    assert.equal((await api(finance, 'receipts/upload', 'POST', { transactionId: cardTx.id, fileSize: 10485761, mimeType: 'application/pdf' })).status, 400);
    assert.equal((await api(finance, 'receipts/upload', 'POST', { transactionId: cardTx.id, fileSize: 10, mimeType: 'text/html' })).status, 400);
    assert.equal((await api(finance, `receipts/${cardTx.id}`, 'PATCH', { version: cardTx.version, path: `cards/${randomUUID()}/${randomUUID()}.pdf` })).status, 400);
    assert.equal((await api(finance, `receipts/${cardTx.id}`, 'PATCH', { version: cardTx.version, path: `cards/${cardTx.id}/${randomUUID()}.pdf` })).status, 400);
  });
  await check('Private receipt signed upload, attach and byte-for-byte read', async () => {
    const bytes = Buffer.from('%PDF-1.4\n% Synthetic finance QA receipt\n%%EOF');
    const signed = await api(finance, 'receipts/upload', 'POST', { transactionId: cardTx.id, fileSize: bytes.length, mimeType: 'application/pdf' });
    assert.equal(signed.status, 200, signed.body.error?.code); objects.push(signed.body.path);
    ok(await finance.client.storage.from('finance-receipts').uploadToSignedUrl(signed.body.path, signed.body.token, bytes, { contentType: 'application/pdf' }));
    const attached = await api(finance, `receipts/${cardTx.id}`, 'PATCH', { version: cardTx.version, path: signed.body.path });
    assert.equal(attached.status, 200, attached.body.error?.code); cardTx = attached.body.row;
    const read = await api(finance, `receipts/${cardTx.id}`); assert.equal(read.status, 200);
    const download = await fetch(read.body.url); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.ok((await anon.storage.from('finance-receipts').download(signed.body.path)).error);
    assert.ok((await member.client.storage.from('finance-receipts').createSignedUrl(signed.body.path, 60)).error);
    assert.equal((await api(member, `receipts/${cardTx.id}`)).status, 403);
  });
  await check('Storage enforces maximum bytes, not just declared request size', async () => {
    const signed = await api(finance, 'receipts/upload', 'POST', { transactionId: cardTx.id, fileSize: 100, mimeType: 'application/pdf' });
    assert.equal(signed.status, 200); objects.push(signed.body.path);
    assert.ok((await finance.client.storage.from('finance-receipts').uploadToSignedUrl(signed.body.path, signed.body.token, Buffer.alloc(10485761), { contentType: 'application/pdf' })).error);
  });
  await check('Receipt unlink keeps private object and stale attach is rejected', async () => {
    const old = cardTx.version;
    const unlink = await api(finance, `receipts/${cardTx.id}`, 'PATCH', { version: old, path: null }); assert.equal(unlink.status, 200); cardTx = unlink.body.row;
    assert.equal((await api(finance, `receipts/${cardTx.id}`, 'PATCH', { version: old, path: objects[0] })).status, 409);
    assert.equal((await api(finance, `receipts/${cardTx.id}`)).status, 404);
    assert.ok(ok(await finance.client.storage.from('finance-receipts').download(objects[0])));
  });
  const bankInput = { kind: 'bank', cards: [], rows: [
    { date: '2026-09-15', time: '10:00', acct: a.id, desc: 'QA external', in: 110000, out: 0, balance: 110000 },
    { date: '2026-09-16', time: '10:00', acct: a.id, desc: 'QA transfer out', in: 0, out: 10000, balance: 100000 },
  ], account: a.id, fileName: 'synthetic-bank.csv', headers: ['bank', run], mapping: { date: 0 } };
  let deposit, transferOut, transferIn;
  await check('Bank import deduplicates account/date/time/amount/balance/description', async () => {
    const imported = await importRows(bankInput); const rows = imported.changes.filter(c => c.resource === 'bank_transactions').map(c => c.row);
    deposit = rows[0]; transferOut = rows[1]; assert.equal(imported.inserted, 2);
    const again = await importRows(bankInput); assert.equal(again.inserted, 0); assert.equal(again.duplicates, 2);
    const incoming = await importRows({ ...bankInput, account: b.id, rows: [{ date: '2026-09-16', time: '10:00', acct: b.id, desc: 'QA transfer in', in: 10000, out: 0, balance: 10000 }] });
    transferIn = incoming.changes.find(c => c.resource === 'bank_transactions').row;
  });
  await check('Transfers require reciprocal pair and exclude internal income', async () => {
    const half = await finance.client.from('os_fin_bank_transactions').update({ link_type: 'transfer', link_ref: transferIn.id }).eq('id', transferOut.id);
    assert.ok(half.error);
    ok(await finance.client.rpc('os_fin_commit', { p_changes: [
      { resource: 'bank_transactions', row: { id: transferOut.id, version: transferOut.version, link_type: 'transfer', link_ref: transferIn.id } },
      { resource: 'bank_transactions', row: { id: transferIn.id, version: transferIn.version, link_type: 'transfer', link_ref: transferOut.id } },
    ] }));
    assert.equal((await api(finance, 'budget?month=2026-09')).body.income, 0);
  });
  await check('External revenue links exactly one deposit and updates income', async () => {
    ok(await finance.client.from('os_fin_bank_transactions').update({ link_type: 'external_revenue', link_ref: revenue.id }).eq('id', deposit.id));
    assert.equal((await api(finance, 'budget?month=2026-09')).body.income, 110000);
    assert.ok((await finance.client.from('os_fin_external_revenues').update({ archived_at: new Date().toISOString() }).eq('id', revenue.id)).error);
  });
  const budget = { id: randomUUID(), version: 0, archived_at: null, kind: 'fixed', name: 'QA manual budget', biz: 'common', monthly_amount: 10000, source: 'manual', card_categories: [], bank_categories: [], owner_name: '', memo: '', sort_order: 0 };
  await check('Budget distinguishes missing actual from explicit zero', async () => {
    await batch(finance, [{ resource: 'budget_items', row: budget }]);
    assert.equal((await api(finance, 'budget?month=2026-09')).body.items.find(i => i.id === budget.id).actual, null);
    await batch(finance, [{ resource: 'budget_actuals', row: { id: randomUUID(), version: 0, item_id: budget.id, month: '2026-09-01', amount: 0 } }]);
    assert.equal((await api(finance, 'budget?month=2026-09')).body.items.find(i => i.id === budget.id).actual, 0);
  });
  await check('Canceled card reimport preserves notes and never resurrects spending', async () => {
    await importRows({ ...importBody, rows: [{ ...importBody.rows[0], krw: -13000 }] });
    const again = await importRows(importBody); assert.equal(again.inserted, 1); // amount reconciliation can change; cancellation cannot
    const row = (await api(finance, `card-transactions/${cardTx.id}`)).body.row;
    assert.equal(row.canceled, true); assert.equal(row.memo, 'Keep QA memo');
  });
  await check('Recurring decision persists without canceling any external service', async () => {
    const r = { id: randomUUID(), version: 0, merchant_key: `qa-${run}`, owner_profile_id: null, owner_name: '가상 담당', state: '해지 검토' };
    await batch(finance, [{ resource: 'recurring_overrides', row: r }]);
    assert.equal((await api(finance, `recurring/${r.id}`)).body.row.state, '해지 검토');
  });
  const store = await insert('stores', { biz: 'edu', name: 'Synthetic QA store', secret_env: 'QA_NO_PROVIDER_KEY', status: 'disconnected' });
  const payment = await insert('payments', { store_id: store.id, biz: 'edu', payment_key: `qa-${run}`, order_id: run, order_name: 'Synthetic QA only', method: '카드', amount: 100000, status: 'DONE', paid_date: '2026-09-10', raw: { test_only: true } });
  await check('Provider records reject user writes and API omits private fields', async () => {
    assert.ok((await finance.client.from('os_fin_payments').update({ amount: 1 }).eq('id', payment.id)).error);
    assert.equal('raw' in (await api(finance, `payments/${payment.id}`)).body.row, false);
    assert.equal('secret_env' in (await api(finance, `stores/${store.id}`)).body.row, false);
  });
  await check('Settlement grouping and note persist without provider calls', async () => {
    await insert('settlements', { store_id: store.id, biz: 'edu', payment_key: payment.payment_key, transaction_key: run, is_cancel: false, method: '카드', amount: 100000, fee: 3000, pay_out_amount: 97000, sold_date: '2026-09-10', paid_out_date: '2026-09-15' });
    await batch(finance, [{ resource: 'payout_notes', row: { id: randomUUID(), version: 0, store_id: store.id, paid_out_date: '2026-09-15', reason: '기타', memo: 'QA unresolved deposit' } }]);
    const p = (await api(finance, 'payouts?month=2026-09')).body.rows.find(r => r.store_id === store.id);
    assert.equal(p.expected, 97000); assert.equal(p.state, '미확인'); assert.equal(p.note.memo, 'QA unresolved deposit');
  });
  await check('Refund request requires different approver and only completes in mock', async () => {
    const req = await api(finance, 'refunds/request', 'POST', { payment_id: payment.id, amount: 10000, reason: 'Synthetic QA; no money movement' });
    assert.equal(req.status, 200); track('refund_requests', req.body.row.id);
    const decision = { id: req.body.row.id, version: req.body.row.version };
    assert.equal((await api(finance, 'refunds/approve', 'POST', decision)).status, 403);
    const approved = await api(admin, 'refunds/approve', 'POST', decision); assert.equal(approved.status, 200, approved.body.error?.code);
    assert.equal(approved.body.row.state, 'done'); assert.equal(approved.body.row.mock, true); assert.equal(approved.body.row.result.money_moved, false);
    assert.equal((await api(finance, `payments/${payment.id}`)).body.row.canceled_amount, 0);
    assert.ok((await finance.client.rpc('os_fin_refund_finish_mock', { p_id: decision.id, p_version: 1 })).error);
  });
  await check('Refund rejection persists; duplicate decisions and excess amount fail', async () => {
    assert.equal((await api(finance, 'refunds/request', 'POST', { payment_id: payment.id, amount: 100001, reason: 'QA' })).status, 400);
    const req = await api(finance, 'refunds/request', 'POST', { payment_id: payment.id, amount: 10000, reason: 'QA reject' });
    assert.equal(req.status, 200); track('refund_requests', req.body.row.id);
    const d = { id: req.body.row.id, version: req.body.row.version };
    assert.equal((await api(admin, 'refunds/reject', 'POST', d)).body.row.state, 'rejected');
    assert.equal((await api(admin, 'refunds/reject', 'POST', d)).status, 409);
  });
  await check('Audit actions persist; provider sync stays explicitly disabled', async () => {
    assert.equal((await api(finance, 'events', 'POST', { kind: 'csv_export', view: 'cards' })).status, 200);
    assert.equal((await api(finance, 'events', 'POST', { kind: 'memo_request', view: 'cards', ids: [cardTx.id] })).body.mock, true);
    assert.equal((await api(finance, 'bank/sync', 'POST', {})).status, 409);
  });
  await check('Revoked finance permission takes effect with the existing token', async () => {
    ok(await service.from('os_profiles').update({ finance_access: false }).eq('id', finance.id));
    assert.equal((await api(finance, 'cards')).status, 403);
    assert.equal((await api(finance, 'toss/status?biz=edu')).status, 403);
    assert.deepEqual(ok(await finance.client.from('os_fin_cards').select('id')), []);
    ok(await service.from('os_profiles').update({ finance_access: true }).eq('id', finance.id));
  });
  if (process.env.FINANCE_QA_HOLD === 'browser') {
    const dir = mkdtempSync(path.join(tmpdir(), 'finance-browser-qa-'));
    browserCredentials = path.join(dir, 'synthetic-login.json');
    writeFileSync(browserCredentials, JSON.stringify({ email: finance.email, password: finance.password, url: baseUrl }), { mode: 0o600 });
    console.log(`BROWSER_READY ${browserCredentials}`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  server?.kill('SIGTERM');
  let cleanupFailed = false;
  for (const p of objects) { if ((await service.storage.from('finance-receipts').remove([p])).error) cleanupFailed = true; }
  const order = ['refund_requests', 'payment_cancels', 'payout_notes', 'bank_transactions', 'card_transactions', 'budget_actuals', 'import_batches', 'import_mappings', 'budget_items', 'external_revenues', 'recurring_overrides', 'card_rules', 'bank_rules', 'cards', 'bank_accounts', 'settlements', 'payments', 'stores', 'settings'];
  // Include all records created through the browser by this run's synthetic actors only.
  for (const resource of order) if (users.length) {
    const extra = await service.from(`os_fin_${resource}`).select('id').in('created_by', users);
    if (extra.error) cleanupFailed = true; else for (const row of extra.data) track(resource, row.id);
  }
  for (const resource of order) if (owned.get(resource)?.size) {
    const ids = [...owned.get(resource)];
    if ((await service.from(`os_fin_${resource}`).delete().in('id', ids)).error) cleanupFailed = true;
    const remaining = await service.from(`os_fin_${resource}`).select('id').in('id', ids); if (remaining.error || remaining.data.length) cleanupFailed = true;
  }
  if (users.length) {
    if ((await service.from('os_fin_events').delete().in('created_by', users)).error) cleanupFailed = true;
    for (const id of users) {
      // Disable access before removing the synthetic identity; never touch an existing user.
      if ((await service.from('os_profiles').update({ is_active: false }).eq('id', id)).error) cleanupFailed = true;
      if ((await service.auth.admin.updateUserById(id, { ban_duration: '876000h' })).error) cleanupFailed = true;
      if ((await service.auth.admin.deleteUser(id)).error) cleanupFailed = true;
    }
  }
  if (browserCredentials) unlinkSync(browserCredentials);
  console.log(JSON.stringify({ passed: results.length, checks: results, cleanup: cleanupFailed ? 'FAILED' : 'synthetic fixtures removed', productionChanged: false }));
  if (cleanupFailed) process.exitCode = 1;
}
