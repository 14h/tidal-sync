import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const id = '12345678-1234-1234-1234-123456789abc';

test('desktop bridge lists and downloads external playlists without exposing tokens', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tidal-desktop-test-'));
  const preload = join(home, 'mock.mjs');
  await writeFile(preload, `
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/v1/users/1/playlistsAndFavoritePlaylists') return Response.json({items:[{playlist:{uuid:'${id}',title:'Library',numberOfTracks:0}}]});
      if (path === '/v1/playlists/${id}') return Response.json({uuid:'${id}',title:'External'});
      if (path === '/v1/playlists/${id}/items') return Response.json({items:[]});
      throw new Error('Unexpected request: ' + path);
    };
  `);
  const run = async (...args) => {
    const { stdout } = await exec(process.execPath, ['--import', preload, resolve('dist/desktop.js'), ...args], { env: { ...process.env, HOME: home } });
    assert.ok(!stdout.includes('private-test-token'));
    return stdout.trim().split('\n').map(line => JSON.parse(line));
  };
  try {
    assert.equal((await run('status'))[0].type, 'signedOut');
    await writeFile(join(home, '.tidal-sync.token.json'), JSON.stringify({userId:1,countryCode:'DE',accessToken:'private-test-token',refreshToken:'private-test-token',expiresAfter:Date.now()+3600000}));
    const list = await run('list');
    assert.deepEqual(list.find(e => e.type === 'playlists').playlists, [{id,title:'Library',count:0}]);
    const result = await run('url', `https://tidal.com/browse/playlist/${id}`, join(home, 'music'));
    assert.ok(result.some(e => e.type === 'progress' && e.total === 0));
    assert.equal(result.at(-1).type, 'complete');
    assert.deepEqual(await readdir(join(home, 'music')), []);
    await assert.rejects(run('url', 'https://example.com/nope', home), err => {
      const event = JSON.parse(err.stdout.trim());
      assert.equal(event.type, 'failure');
      return true;
    });
    assert.equal((await run('logout'))[0].type, 'signedOut');
    assert.equal((await run('status'))[0].type, 'signedOut');
  } finally { await rm(home, { recursive:true, force:true }); }
});

test('failed remux leaves no completed file and reports progress', async () => {
  const { setToken } = await import('../dist/api.js');
  const { downloadTracks } = await import('../dist/download.js');
  const folder = await mkdtemp(join(tmpdir(), 'tidal-download-test-'));
  const originalFetch = globalThis.fetch;
  const progress = [];
  setToken({ accessToken:'test',countryCode:'DE',userId:1 });
  globalThis.fetch = async url => {
    if (String(url).includes('playbackinfopostpaywall')) return Response.json({
      trackId:1, audioQuality:'HI_RES_LOSSLESS', manifestMimeType:'application/vnd.tidal.bts',
      manifest:Buffer.from(JSON.stringify({codecs:'flac',urls:['https://example.test/audio']})).toString('base64')
    });
    if (String(url) === 'https://example.test/audio') return new Response(Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]));
    throw new Error('Unexpected download request');
  };
  try {
    const result = await downloadTracks([{id:1,title:'Broken',artist:{name:'Artist'},album:{}}], folder, 'Test', 0, 1, 'HI_RES_LOSSLESS', n => progress.push(n));
    assert.deepEqual(result, {downloaded:0,failed:1});
    assert.deepEqual(progress, [1]);
    assert.deepEqual(await readdir(folder), []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(folder, { recursive:true,force:true });
  }
});
