import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { accounts, appUrl, localEnvironment, sql } from '../../tools/knowledge-local-qa.mjs';

const local = localEnvironment(), users = await accounts(local), client = local.client();
assert.match(users.author.id, /^[a-f0-9-]{36}$/);
const { data, error } = await client.auth.signInWithPassword(users.author); assert.equal(error, null);
const size = Number(process.argv[2] ?? 1000); assert.ok([1000, 5000].includes(size));
sql(`insert into public.os_documents(id,title,content_md,status,owner_id,source)
select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'QA scale '||n,
 (select string_agg('[[99000000-0000-4000-8000-'||lpad((((n+k-1)%1000)+1)::text,12,'0')||']]', E'\n') from generate_series(1,5) k),
 'team','${users.author.id}','wiki' from generate_series(1,${size}) n on conflict(id) do nothing;
analyze public.os_documents;`);
for (const path of ['/api/v1/knowledge/workspace', '/api/v1/knowledge/graph?format=compact', '/api/v1/knowledge/search?q=QA%20scale']) {
  const samples = [];
  let bytes = 0, result;
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const response = await fetch(appUrl + path, { headers: { authorization: `Bearer ${data.session.access_token}` } });
    assert.equal(response.status, 200, path);
    const body = await response.text(); bytes = Buffer.byteLength(body); result = JSON.parse(body);
    samples.push(Math.round(performance.now() - started));
  }
  if (path.includes('workspace')) assert.ok(result.state.documents.length >= size, 'no row-cap truncation');
  if (path.includes('search')) assert.ok(result.total >= size, 'search includes all fixture rows');
  console.log(JSON.stringify({ size, path, milliseconds: samples, bytes }));
}
