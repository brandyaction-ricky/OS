// Run only after explicit approval for the disposable localhost stack.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accounts, appUrl, localEnvironment, sql } from '../../tools/knowledge-local-qa.mjs';

const local = localEnvironment(), users = await accounts(local), sessions = {};
for (const [name, user] of Object.entries(users)) {
  const client = local.client();
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.equal(error, null, `local ${name} login`);
  sessions[name] = { client, token: data.session.access_token };
}
let checks = 0;
async function api(who, path, body, expected = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(appUrl + path, { method, signal: AbortSignal.timeout(20000), headers: { ...(who ? { authorization: `Bearer ${sessions[who].token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path.split('?')[0].replace(/[a-f0-9-]{36}/g, ':id')} ${body?.action ?? ''}: ${data.error?.code ?? ''}`);
  checks++; return data;
}
const command = (who, body, expected = 200) => api(who, '/api/v1/knowledge/workspace', body, expected);
const doc = async (who, id) => (await api(who, `/api/v1/documents/${id}`)).document;
const state = async who => (await api(who, '/api/v1/knowledge/workspace')).state;
const suffix = randomUUID().slice(0, 8);
await api(null, '/api/v1/knowledge/workspace', null, 401);
await api('inactive', '/api/v1/knowledge/workspace', null, 403);
await state('author');
console.log('PASS local Auth → authenticated workspace; anonymous/inactive denial');

const note = (await command('author', { action: 'document.create', space: 'mine', title: `QA note ${suffix}`, content: 'Initial content' })).id;
let current = await doc('author', note);
assert.equal(current.content_md, 'Initial content');
for (const other of ['peer', 'admin', 'partner']) {
  await api(other, `/api/v1/documents/${note}`, null, 404);
  await api(other, `/api/v1/documents/${note}/versions`, null, 404);
  assert.ok(!(await state(other)).documents.some(d => d.id === note));
}
await command('author', { action: 'document.draft', id: note, expectedVersion: current.current_version, title: current.title, content: 'Autosaved draft' });
assert.equal((await state('author')).drafts.find(d => d.document_id === note).content_md, 'Autosaved draft');
assert.equal((await doc('author', note)).content_md, 'Initial content');
await command('author', { action: 'document.commit', id: note, expectedVersion: current.current_version, title: current.title, content: 'Committed content' });
await command('author', { action: 'document.commit', id: note, expectedVersion: current.current_version, title: current.title, content: 'Stale overwrite' }, 409);
current = await doc('author', note);
assert.equal(current.content_md, 'Committed content');
assert.ok(!(await state('author')).drafts.some(d => d.document_id === note));
const versions = await api('author', `/api/v1/documents/${note}/versions`);
assert.ok(versions.versions.length >= 2);
await api('author', `/api/v1/documents/${note}/versions`, { version: 1, expectedVersion: current.current_version, reason: 'Synthetic restore' });
assert.equal((await doc('author', note)).content_md, 'Initial content');
console.log('PASS private document isolation, autosave, commit, conflict, version restore');

const category = (await command('author', { action: 'category.save', space: 'team', name: `QA ${suffix}`, color: 'blue' })).id;
await command('admin', { action: 'category.save', id: category, partnerIds: [users.partner.id] });
const shared = (await command('author', { action: 'document.create', space: 'team', title: `QA team ${suffix}`, categoryId: category, content: 'Shared body' })).id;
const restricted = (await command('author', { action: 'document.create', space: 'team', title: `QA restricted ${suffix}`, content: 'Hidden from partner' })).id;
await doc('partner', shared); await api('partner', `/api/v1/documents/${restricted}`, null, 404);
current = await doc('peer', shared);
await command('peer', { action: 'document.commit', id: shared, expectedVersion: current.current_version, title: current.title, content: 'Peer edit' });
const raceVersion = (await doc('author', shared)).current_version;
const raced = await Promise.all(['author', 'peer'].map(async who => {
  const response = await fetch(appUrl + '/api/v1/knowledge/workspace', { method: 'POST', headers: { authorization: `Bearer ${sessions[who].token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'document.commit', id: shared, expectedVersion: raceVersion, title: 'QA race', content: who }) });
  return response.status;
}));
assert.deepEqual(raced.sort(), [200, 409]); checks += 2;
current = await doc('author', shared);
await command('partner', { action: 'document.properties', id: shared, expectedVersion: current.current_version, categoryId: null }, 403);
console.log('PASS team collaboration, partner isolation and simultaneous-write conflict');

const candidate = (await command('author', { action: 'candidate.submit', id: shared, expectedVersion: current.current_version, approverId: users.reviewer.id, stewardId: users.author.id, reviewDueOn: '2027-01-01' })).id;
current = await doc('author', shared);
await command('author', { action: 'candidate.decide', id: candidate, expectedVersion: current.current_version, decision: 'approved' }, 403);
await command('reviewer', { action: 'candidate.decide', id: candidate, expectedVersion: current.current_version, decision: 'approved' });
current = await doc('author', shared); assert.equal(current.status, 'canonical');
await command('author', { action: 'document.commit', id: shared, expectedVersion: current.current_version, content: 'Direct canon overwrite' }, 403);
const proposal = (await command('author', { action: 'proposal.create', id: shared, expectedVersion: current.current_version, title: current.title, content: 'Approved proposal body', reason: 'Synthetic proposal', approverId: users.reviewer.id })).id;
assert.notEqual((await doc('author', shared)).content_md, 'Approved proposal body');
await command('author', { action: 'proposal.decide', id: proposal, decision: 'approved' }, 403);
await command('reviewer', { action: 'proposal.decide', id: proposal, decision: 'approved' });
assert.equal((await doc('author', shared)).content_md, 'Approved proposal body');
current = await doc('author', shared);
const staleProposal = (await command('author', { action: 'proposal.create', id: shared, expectedVersion: current.current_version, content: 'Stale proposal body', reason: 'Synthetic conflict', approverId: users.reviewer.id })).id;
const metadataProposal = (await command('author', { action: 'proposal.create', id: shared, expectedVersion: current.current_version, folder: 'QA approved folder', reason: 'Synthetic metadata', approverId: users.reviewer.id })).id;
await command('reviewer', { action: 'proposal.decide', id: metadataProposal, decision: 'approved' });
assert.equal((await doc('author', shared)).folder, 'QA approved folder');
await command('reviewer', { action: 'proposal.decide', id: staleProposal, decision: 'approved' }, 409);
await command('reviewer', { action: 'proposal.decide', id: staleProposal, decision: 'returned', reason: 'Revise synthetic proposal' });
current = await doc('author', shared);
await command('author', { action: 'proposal.create', id: shared, proposalId: staleProposal, expectedVersion: current.current_version, content: 'Revised proposal body', reason: 'Synthetic revision', approverId: users.reviewer.id });
await command('reviewer', { action: 'proposal.decide', id: staleProposal, decision: 'approved' });
assert.equal((await doc('author', shared)).content_md, 'Revised proposal body');
console.log('PASS candidate approval, self-approval block and transactional canonical proposal');

const meeting = (await command('author', { action: 'meeting.create', title: `QA meeting ${suffix}`, visibility: 'attendees' })).id;
let m = (await state('author')).meetings.find(m => m.id === meeting);
assert.ok(m);
for (const other of ['peer', 'admin', 'partner']) assert.ok(!(await state(other)).meetings.some(m => m.id === meeting));
await command('author', { action: 'meeting.save', id: meeting, expectedVersion: m.version, attendees: [users.peer.id], content: 'Private meeting notes', items: [{ id: randomUUID(), kind: 'decision', text: 'Synthetic accepted decision', state: 'accepted' }, { id: randomUUID(), kind: 'task', text: 'Synthetic accepted task', state: 'accepted', ownerId: users.peer.id, dueOn: '2026-12-01' }] });
for (const action of ['meeting.start', 'meeting.finish', 'meeting.review']) {
  m = (await state('author')).meetings.find(m => m.id === meeting);
  await command('author', { action, id: meeting, expectedVersion: m.version });
}
m = (await state('peer')).meetings.find(m => m.id === meeting); assert.equal(m.status, 'done');
await command('author', { action: 'meeting.save', id: meeting, expectedVersion: m.version, content: 'Overwrite confirmed minutes' }, 403);
await command('author', { action: 'meeting.correct', id: meeting, expectedVersion: m.version, content: 'Append-only correction', reason: 'Synthetic correction' });
const children = await sessions.author.client.from('os_records').select('record_type,status').eq('parent_id', meeting);
assert.equal(children.error, null); assert.equal(children.data.length, 2);
assert.ok(children.data.some(row => row.record_type === 'decision' && row.status === 'confirmed'));
const hiddenChildren = await sessions.admin.client.from('os_records').select('id').eq('parent_id', meeting);
assert.equal(hiddenChildren.error, null); assert.equal(hiddenChildren.data.length, 0);
console.log('PASS meeting lifecycle, accepted decision/task creation and private child RLS');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const upload = await api('author', '/api/v1/knowledge-attachments', { documentId: note, fileName: 'synthetic.png', fileSize: png.length, mimeType: 'image/png' }, 201);
const uploaded = await sessions.author.client.storage.from('os-knowledge-attachments').uploadToSignedUrl(upload.path, upload.token, png, { contentType: 'image/png' });
assert.equal(uploaded.error, null, 'local Storage upload');
const read = await api('author', `/api/v1/knowledge-attachments?path=${encodeURIComponent(upload.path)}`);
const downloaded = await fetch(read.url); assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
await api('peer', `/api/v1/knowledge-attachments?path=${encodeURIComponent(upload.path)}`, null, 404);
await api('admin', `/api/v1/knowledge-attachments?path=${encodeURIComponent(upload.path)}`, null, 404);
await api('peer', '/api/v1/knowledge-attachments', { documentId: restricted, fileName: 'synthetic.png', fileSize: png.length, mimeType: 'image/png' }, 201);
await command('admin', { action: 'note.access', id: note, reason: 'Synthetic temporary audit' });
await doc('admin', note);
await api('admin', '/api/v1/knowledge-attachments', { documentId: note, fileName: 'synthetic.png', fileSize: png.length, mimeType: 'image/png' }, 403);
current = await doc('author', note);
const reference = new URLSearchParams({ path: upload.path, name: 'synthetic.png', type: 'image/png', size: String(png.length) });
await command('author', { action: 'document.commit', id: note, expectedVersion: current.current_version, title: current.title, content: `Initial content\n\n![synthetic.png](knowledge-attachment:?${reference})` });
const lifecycle = await local.service.from('os_knowledge_attachment_uploads').select('status').eq('path', upload.path).single();
assert.equal(lifecycle.error, null); assert.equal(lifecycle.data.status, 'referenced');
await api('author', `/api/v1/knowledge-attachments?path=${encodeURIComponent(upload.path)}`, null, 409, 'DELETE');
console.log('PASS attachment signed upload, byte readback and unauthorized-read rejection');

await command('author', { action: 'document.archive', id: note, reason: 'Synthetic archive' });
assert.equal((await doc('author', note)).status, 'archived');
await command('author', { action: 'trash.restore', id: note });
assert.equal((await doc('author', note)).status, 'draft');
const searched = await api('author', `/api/v1/knowledge/search?q=${suffix}&includeMine=true`);
assert.ok(searched.results.some(row => row.id === note));
const partnerSearch = await api('partner', `/api/v1/knowledge/search?q=${suffix}&includeMine=true`);
assert.ok(!partnerSearch.results.some(row => [note, restricted].includes(row.id)));
const graph = await api('peer', '/api/v1/knowledge/graph');
assert.ok(graph);
assert.equal(sql(`select count(*) from public.os_documents where id='${note}' and content_md like 'Initial content%';`), '1');
console.log(`PASS connected API/DB suite: ${checks} response checks plus database, RLS, concurrency and Storage assertions`);
