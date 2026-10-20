const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = stripTypeScriptTypes(fs.readFileSync('supabase/functions/resolve-vod-link/index.ts', 'utf8'));
function harness({ admin = true, redirect = 'https://chzzk.naver.com/video/15720700', loggedIn = true } = {}) {
  let handler;
  const calls = [];
  const c = vm.createContext({ Request, Response, URL, AbortSignal, crypto,
    Deno: { env: { get: k => k === 'SUPABASE_URL' ? 'https://db.test' : 'anon' }, serve: h => { handler = h; } },
    fetch: async (url, options) => {
      const target = String(url); calls.push(target);
      if (target.includes('/auth/v1/user')) return Response.json({ id: 'admin' }, { status: loggedIn ? 200 : 401 });
      if (target.includes('/admin_users')) return Response.json(admin ? [{ user_id: 'admin' }] : []);
      if (target.startsWith('https://naver.me/')) { assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: redirect } }); }
      if (target.startsWith('https://api.chzzk.naver.com/')) return Response.json({ content: { channel: { channelId: 'channel' }, liveOpenDate: '2026-10-16 20:30:12' } });
      throw Error('Unexpected network: ' + target);
    },
  });
  vm.runInContext(source, c);
  return { calls, invoke: (url, channelId = 'channel') => handler(new Request('https://edge.test', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ url, channelId }) })) };
}
test('short and canonical links resolve to one stable video ID and Korean start instant', async () => {
  const h = harness();
  for (const url of ['https://naver.me/short', 'https://chzzk.naver.com/video/15720700?t=30']) {
    const r = await h.invoke(url);
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.equal(result.videoNo, '15720700');
    assert.equal(result.url, 'https://chzzk.naver.com/video/15720700');
    assert.equal(result.startedAt, '2026-10-16T11:30:12.000Z');
  }
});
test('resolver rejects non-admins and other-channel videos', async () => {
  assert.equal((await harness({ admin: false }).invoke('https://naver.me/short')).status, 403);
  assert.equal((await harness({ loggedIn: false }).invoke('https://naver.me/short')).status, 401);
  assert.equal((await harness().invoke('https://naver.me/short', 'another')).status, 400);
});
test('resolver never follows a redirect outside allowed hosts', async () => {
  for (const url of ['http://127.0.0.1', 'https://evil.test/video/1', 'https://chzzk.naver.com.evil.test/video/1']) {
    const h = harness();
    assert.equal((await h.invoke(url)).status, 400);
    assert.equal(h.calls.filter(x => !x.startsWith('https://db.test')).length, 0);
  }
  const h = harness({ redirect: 'https://127.0.0.1/secret' });
  assert.equal((await h.invoke('https://naver.me/short')).status, 400);
  assert.equal(h.calls.some(x => x.includes('127.0.0.1')), false);
});
