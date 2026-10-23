/**
 * Live smoke test against the real Georef API. Skipped unless GEOREF_LIVE=1:
 *   npm run test:live
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HttpGeorefBackend } from '../src/backend.js';
import { createServer } from '../src/server.js';

test('live Georef smoke test', { skip: process.env.GEOREF_LIVE !== '1' && 'set GEOREF_LIVE=1 to run' }, async (t) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(new HttpGeorefBackend(process.env.GEOREF_BASE_URL)).connect(serverSide);
  const client = new Client({ name: 'live', version: '0.0.0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>, expect: RegExp) => {
    const res: any = await client.callTool({ name, arguments: args });
    t.diagnostic(`${name} → ${res.content[0].text.split('\n')[0]}`);
    assert.notEqual(res.isError, true, res.content[0].text);
    assert.match(res.content[0].text, expect);
  };
  await call('search_provinces', { nombre: 'cordoba' }, /Córdoba \[id 14\]/);
  await call('search_departments', { nombre: 'capital', provincia: 'cordoba' }, /Capital \[id 14014\]/);
  await call('search_municipalities', { nombre: 'rosario', provincia: 'santa fe' }, /Rosario/);
  await call('search_localities', { nombre: 'tandil' }, /Tandil.*Buenos Aires/);
  await call('normalize_address', { direccion: 'av corrientes 1234', provincia: 'caba' }, /AV CORRIENTES 1234/);
  await call('reverse_geocode', { lat: -34.6037, lon: -58.3816 }, /Ciudad Autónoma de Buenos Aires/);
});
