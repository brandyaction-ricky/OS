// Explicitly invoked integration harness. Never loads .env or uses a hosted project.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const project = 'knowledge-workspace-qa-20261009';
export const container = `supabase_db_${project}`;
export const appUrl = 'http://127.0.0.1:3137';
export function localEnvironment() {
  const directory = resolve(process.env.KNOWLEDGE_QA_STACK_DIR ?? '/missing');
  assert.match(directory, /^\/private\/tmp\/knowledge-supabase-qa\.[A-Za-z0-9]+$/);
  assert.match(readFileSync(join(directory, 'supabase/config.toml'), 'utf8'), new RegExp(`project_id = "${project}"`));
  const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '--workdir', directory, '-o', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  }));
  assert.equal(status.API_URL, 'http://127.0.0.1:59321');
  const database = new URL(status.DB_URL);
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '59322');
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_DEMO_MODE: 'false',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return { directory, env, status, service: createClient(status.API_URL, status.SERVICE_ROLE_KEY, options),
    client: () => createClient(status.API_URL, status.ANON_KEY, options) };
}
export function sql(text) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
export async function accounts(local) {
  const file = join(local.directory, 'synthetic-accounts.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const users = {};
  for (const name of ['author', 'peer', 'admin', 'reviewer', 'partner', 'inactive']) {
    const email = `${name}@knowledge-qa.invalid`, password = randomBytes(24).toString('base64url');
    const { data, error } = await local.service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `QA ${name}` } });
    assert.equal(error, null, 'synthetic Auth creation');
    const { error: profileError } = await local.service.from('os_profiles').update({
      display_name: `QA ${name}`, is_active: name !== 'inactive', must_change_password: false,
      role: name === 'admin' || name === 'reviewer' ? 'admin' : 'member', member_kind: name === 'partner' ? 'partner' : 'staff',
    }).eq('id', data.user.id);
    assert.equal(profileError, null, 'synthetic profile setup');
    users[name] = { id: data.user.id, email, password };
  }
  writeFileSync(file, JSON.stringify(users), { mode: 0o600, flag: 'wx' });
  return users;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('tools/knowledge-local-qa.mjs')) {
  const local = localEnvironment();
  if (process.argv[2] === 'serve') {
    const child = spawn('node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', '3137'], { env: local.env, stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('exit', code => process.exit(code ?? 1));
  } else if (process.argv[2] === 'accounts') {
    await accounts(local); console.log('Six synthetic accounts ready in the dedicated localhost stack.');
  } else throw new Error('Use serve or accounts explicitly.');
}
