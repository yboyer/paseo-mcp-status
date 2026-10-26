import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { activeLogin, login, loginStatus, completeLogin } from '../server/cli.ts';

test('remote OAuth: fragmented stderr URL, callback validation, CLI completion and failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-login-'));
  const oldShell = process.env.SHELL;
  try {
    const cli = join(dir, 'fake-cli');
    await writeFile(cli, `#!${process.execPath}
const { createServer } = require('node:http');
if (process.argv.at(-1) === 'fail') process.exit(1);
const server = createServer((req, res) => {
  if (!req.url.includes('code=test-code')) { res.writeHead(400).end(); return; }
  res.setHeader('Connection', 'close');
  res.end('Authenticated');
  server.close(() => process.exit(0));
});
server.listen(0, '127.0.0.1', () => {
  const callback = 'http://127.0.0.1:' + server.address().port + '/callback';
  const url = 'https://example.com/authorize?redirect_uri=' + encodeURIComponent(callback) + '&state=expected';
  process.stdout.write('Documentation: https://example.com/docs\\n');
  process.stderr.write(url.slice(0, 35));
  setTimeout(() => process.stderr.write(url.slice(35) + '\\n'), 20);
});
`, { mode: 0o700 });
    const shell = join(dir, 'shell');
    await writeFile(shell, `#!/bin/sh\nprintf '%s\\n' '${cli}'\n`, { mode: 0o700 });
    process.env.SHELL = shell;
    const waitFor = async (fn) => {
      for (let i = 0; i < 100; i++) {
        const value = fn();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Timed out waiting for fake CLI');
    };
    assert.equal(activeLogin('codex', dir), null);
    const [id, duplicate] = await Promise.all([
      login('codex', dir, 'example'), login('codex', dir, 'example'),
    ]);
    assert.equal(duplicate, id, 'simultaneous clicks must reuse the pending session');
    assert.deepEqual(activeLogin('codex', dir), { sessionId: id, server: 'example' },
      'a remounted client must recover the original session');
    assert.equal(activeLogin('claude', dir), null);
    assert.equal(activeLogin('codex', dir + '/other'), null);
    await assert.rejects(login('codex', dir, 'other'), /already in progress/);
    const auth = new URL(await waitFor(() => loginStatus(id).url));
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', 'wrong');
    callback.searchParams.set('code', 'test-code');
    await assert.rejects(completeLogin(id, callback.href), /Invalid authentication callback/);
    callback.searchParams.set('state', 'expected');
    const foreign = new URL(callback);
    foreign.hostname = 'example.com';
    await assert.rejects(completeLogin(id, foreign.href), /Invalid authentication callback/);
    assert.equal(await login('codex', dir, 'example'), id,
      'returning from the browser must not replace the callback state');
    await completeLogin(activeLogin('codex', dir).sessionId, callback.href);
    await waitFor(() => loginStatus(id).ok === true);
    assert.equal(activeLogin('codex', dir), null);
    await assert.rejects(completeLogin(id, callback.href), /No pending authentication/);
    const failed = await login('codex', dir, 'fail');
    await waitFor(() => loginStatus(failed).ok === false);
    assert.throws(() => loginStatus('unknown'), /expired/);
  } finally {
    if (oldShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = oldShell;
    await rm(dir, { recursive: true, force: true });
  }
});
