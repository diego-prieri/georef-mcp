import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeGeorefBackend, GeorefError, HttpGeorefBackend, type GeorefBackend } from '../src/backend.js';
import { createServer } from '../src/server.js';

const CBA = { id: '14', nombre: 'Córdoba' };
const CABA = { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' };
const BA = { id: '06', nombre: 'Buenos Aires' };

const fake = () =>
  new FakeGeorefBackend({
    provinces: [
      { ...CBA, centroide: { lat: -32.1448, lon: -63.802 } },
      { ...BA, centroide: { lat: -36.6769, lon: -60.5588 } },
    ],
    departments: [{ id: '14014', nombre: 'Capital', provincia: CBA, centroide: { lat: -31.4168, lon: -64.1836 } }],
    municipalities: [{ id: '820210', nombre: 'Rosario', provincia: { id: '82', nombre: 'Santa Fe' }, centroide: { lat: -32.949, lon: -60.698 } }],
    localities: [
      { id: '06791050', nombre: 'Tandil', provincia: BA, departamento: { id: '06791', nombre: 'Tandil' }, centroide: { lat: -37.3287, lon: -59.1369 } },
    ],
    addresses: [
      {
        nomenclatura: 'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires',
        calle: { id: '0200701001185', nombre: 'AV CORRIENTES', categoria: 'AV' },
        altura: { valor: 1234, unidad: null },
        departamento: { id: '02007', nombre: 'Comuna 1' },
        provincia: CABA,
        ubicacion: { lat: -34.60386, lon: -58.38419 },
      },
    ],
    locations: [
      { lat: -34.6037, lon: -58.3816, provincia: CABA, departamento: { id: '02007', nombre: 'Comuna 1' }, municipio: { id: '022007', nombre: 'Comuna 1' } },
    ],
  });

async function connect(backend: GeorefBackend = fake()) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(backend).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

const text = (r: any) => r.content[0].text as string;
const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

let client: Client;
beforeEach(async () => {
  client = await connect();
});

test('exposes six read-only, open-world tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'normalize_address',
    'reverse_geocode',
    'search_departments',
    'search_localities',
    'search_municipalities',
    'search_provinces',
  ]);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.equal(t.annotations?.openWorldHint, true, t.name);
  }
});

test('search_provinces matches without accents and returns one compact line per result', async () => {
  const res = await call('search_provinces', { nombre: 'cordoba' });
  assert.equal(text(res), 'Córdoba [id 14] (-32.14480, -63.80200)');
  assert.equal((res.structuredContent as any).provincias[0].id, '14');
});

test('search_provinces without nombre lists all', async () => {
  const res = await call('search_provinces', {});
  assert.equal((res.structuredContent as any).total, 2);
});

test('search_departments filters by province', async () => {
  const res = await call('search_departments', { nombre: 'capital', provincia: 'cordoba' });
  assert.match(text(res), /^Capital \[id 14014\] — Córdoba/);
  const none = await call('search_departments', { nombre: 'capital', provincia: 'mendoza' });
  assert.match(text(none), /^No results\./);
});

test('search_municipalities returns province and centroid', async () => {
  const res = await call('search_municipalities', { nombre: 'rosario' });
  assert.match(text(res), /Rosario \[id 820210\] — Santa Fe \(-32\.94900/);
});

test('search_localities includes department and province', async () => {
  const res = await call('search_localities', { nombre: 'tandil', provincia: '06' });
  assert.match(text(res), /Tandil \[id 06791050\] — Tandil, Buenos Aires/);
});

test('normalize_address returns the official nomenclature and coordinates', async () => {
  const res = await call('normalize_address', { direccion: 'corrientes 1234', provincia: '02' });
  assert.match(text(res), /AV CORRIENTES 1234, Comuna 1.*\[street id 0200701001185\] \(-34\.60386, -58\.38419\)/);
  assert.equal((res.structuredContent as any).direcciones.length, 1);
});

test('normalize_address empty result is not an error and explains what to try', async () => {
  const res = await call('normalize_address', { direccion: 'calle inexistente 1' });
  assert.notEqual(res.isError, true);
  assert.match(text(res), /street number/);
  assert.deepEqual((res.structuredContent as any).direcciones, []);
});

test('reverse_geocode resolves a point inside Argentina', async () => {
  const res = await call('reverse_geocode', { lat: -34.6037, lon: -58.3816 });
  assert.match(text(res), /Province: Ciudad Autónoma de Buenos Aires \[id 02\]/);
  assert.match(text(res), /Municipality: Comuna 1/);
});

test('reverse_geocode outside Argentina explains a possible lat/lon swap', async () => {
  const res = await call('reverse_geocode', { lat: 0, lon: 0 });
  assert.match(text(res), /swapped/);
});

test('reports truncation when more matches exist than max', async () => {
  const res = await call('search_provinces', { max: 1 });
  assert.match(text(res), /1 of 2 matches/);
});

test('rejects invalid input before reaching the backend', async () => {
  for (const [name, args] of [
    ['search_provinces', { max: 51 }],
    ['search_provinces', { max: 0 }],
    ['search_localities', {}],
    ['normalize_address', { direccion: 'x' }],
    ['reverse_geocode', { lat: -99, lon: 0 }],
    ['reverse_geocode', { lat: 'abc', lon: 0 }],
  ] as const) {
    const res = await call(name, args);
    assert.equal(res.isError, true, `${name} ${JSON.stringify(args)}`);
  }
});

test('upstream failures come back as actionable tool errors', async () => {
  const boom = async () => {
    throw new GeorefError('Georef /provincias returned 503: Service Unavailable', 503);
  };
  const broken: GeorefBackend = {
    provinces: boom,
    departments: boom,
    municipalities: boom,
    localities: boom,
    addresses: boom,
    location: boom,
  };
  const c = await connect(broken);
  const cases: [string, Record<string, unknown>][] = [
    ['search_provinces', {}],
    ['search_departments', {}],
    ['search_municipalities', {}],
    ['search_localities', { nombre: 'x' }],
    ['normalize_address', { direccion: 'abc 1' }],
    ['reverse_geocode', { lat: -34, lon: -58 }],
  ];
  for (const [name, args] of cases) {
    const res = await c.callTool({ name, arguments: args });
    assert.equal(res.isError, true, name);
    assert.match(text(res), /503.*Try again later/, name);
  }
});

test('HttpGeorefBackend sends params and User-Agent, and surfaces Georef error messages', async () => {
  let seen: { url?: string; ua?: string } = {};
  const srv = createHttpServer((req, res) => {
    seen = { url: req.url, ua: req.headers['user-agent'] };
    if (req.url?.startsWith('/georef/api/provincias')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total: 1, provincias: [{ id: '14', nombre: 'Córdoba', centroide: { lat: 1, lon: 2 } }] }));
    } else {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errores: [{ nombre_parametro: 'max', mensaje: 'El número debe ser menor o igual que 5000.' }] }));
    }
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const port = (srv.address() as AddressInfo).port;
    const http = new HttpGeorefBackend(`http://127.0.0.1:${port}/georef/api`);
    const page = await http.provinces({ nombre: 'cordoba', max: 3 });
    assert.equal(page.items[0].nombre, 'Córdoba');
    assert.equal(seen.url, '/georef/api/provincias?nombre=cordoba&max=3');
    assert.match(seen.ua ?? '', /^georef-mcp\//);

    const res = await (await connect(http)).callTool({ name: 'search_departments', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(text(res), /400: max: El número.*Check the parameters/);
  } finally {
    srv.close();
  }
});
