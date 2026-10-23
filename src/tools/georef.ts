import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { GeorefError, type GeorefBackend, type Page, type Ref } from '../backend.js';

/** Text for the model, structured content for clients that render or chain results. */
function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/**
 * Errors go back as tool results with isError, not thrown: the model sees the
 * message and can correct itself (fix a parameter, relax a filter).
 */
function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function upstreamFailure(what: string, e: unknown): CallToolResult {
  const err = e as Error;
  const status = e instanceof GeorefError ? e.status : undefined;
  let hint = 'Try again later; the public Georef API may be temporarily unavailable.';
  if (status === 400) hint = 'Check the parameters (names, ids, coordinate ranges) and retry.';
  else if (status === 429) hint = 'Georef rate limit reached; wait a bit before retrying.';
  return fail(`Could not ${what}: ${err.message}. ${hint}`);
}

const ALL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const max = z.number().int().min(1).max(50).default(10).describe('Maximum results to return (1–50)');
const nombre = z.string().trim().min(1).max(200);
const provincia = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe('Province name or id to filter by, e.g. "Córdoba", "caba" or "14"');

const fmtPoint = (p?: { lat?: number | null; lon?: number | null } | null) =>
  p && p.lat != null && p.lon != null ? `(${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})` : '(no coordinates)';
const fmtRef = (r?: Ref | null) => r?.nombre ?? '?';

function listResult<T>(page: Page<T>, line: (t: T) => string, key: string, emptyHint: string): CallToolResult {
  if (!page.items.length) return ok(`No results. ${emptyHint}`, { total: 0, [key]: [] });
  const more = page.total > page.items.length ? `\n(${page.items.length} of ${page.total} matches; raise max or refine the query)` : '';
  return ok(page.items.map(line).join('\n') + more, { total: page.total, [key]: page.items });
}

export function registerGeorefTools(server: McpServer, backend: GeorefBackend): void {
  server.registerTool(
    'search_provinces',
    {
      title: 'Search provinces',
      description:
        'Search Argentina\'s 24 provinces (including CABA) by name. Omit nombre to list them all. Returns official name, INDEC id and centroid.',
      inputSchema: { nombre: nombre.optional().describe('Province name, accents optional, e.g. "cordoba"'), max: max.default(24) },
      annotations: ALL_ANNOTATIONS,
    },
    async (args) => {
      try {
        const page = await backend.provinces(args);
        return listResult(page, (p) => `${p.nombre} [id ${p.id}] ${fmtPoint(p.centroide)}`, 'provincias', 'Check the spelling or omit nombre to list all provinces.');
      } catch (e) {
        return upstreamFailure('search provinces', e);
      }
    },
  );

  server.registerTool(
    'search_departments',
    {
      title: 'Search departments',
      description: 'Search departments (partidos in Buenos Aires, comunas in CABA) by name and/or province.',
      inputSchema: { nombre: nombre.optional().describe('Department name, e.g. "Capital"'), provincia, max },
      annotations: ALL_ANNOTATIONS,
    },
    async (args) => {
      try {
        const page = await backend.departments(args);
        return listResult(page, (d) => `${d.nombre} [id ${d.id}] — ${fmtRef(d.provincia)} ${fmtPoint(d.centroide)}`, 'departamentos', 'Check the spelling, or drop the provincia filter; use search_provinces to confirm the province name.');
      } catch (e) {
        return upstreamFailure('search departments', e);
      }
    },
  );

  server.registerTool(
    'search_municipalities',
    {
      title: 'Search municipalities',
      description: 'Search municipalities (local governments) by name and/or province.',
      inputSchema: { nombre: nombre.optional().describe('Municipality name, e.g. "Rosario"'), provincia, max },
      annotations: ALL_ANNOTATIONS,
    },
    async (args) => {
      try {
        const page = await backend.municipalities(args);
        return listResult(page, (m) => `${m.nombre} [id ${m.id}] — ${fmtRef(m.provincia)} ${fmtPoint(m.centroide)}`, 'municipios', 'Check the spelling or drop the provincia filter. Small towns may be localities, not municipalities: try search_localities.');
      } catch (e) {
        return upstreamFailure('search municipalities', e);
      }
    },
  );

  server.registerTool(
    'search_localities',
    {
      title: 'Search localities',
      description: 'Search localities (cities, towns, settlements from the BAHRA dataset) by name, optionally within a province and department.',
      inputSchema: {
        nombre: nombre.describe('Locality name, e.g. "Tandil"'),
        provincia,
        departamento: z.string().trim().min(1).max(200).optional().describe('Department name or id to filter by'),
        max,
      },
      annotations: ALL_ANNOTATIONS,
    },
    async (args) => {
      try {
        const page = await backend.localities(args);
        return listResult(
          page,
          (l) => `${l.nombre} [id ${l.id}] — ${fmtRef(l.departamento)}, ${fmtRef(l.provincia)} ${fmtPoint(l.centroide)}`,
          'localidades',
          'Check the spelling, or drop the provincia/departamento filters.',
        );
      } catch (e) {
        return upstreamFailure('search localities', e);
      }
    },
  );

  server.registerTool(
    'normalize_address',
    {
      title: 'Normalize address',
      description:
        'Normalize a free-text street address ("street number", e.g. "av corrientes 1234") into its official form with street id, department, province and coordinates. Pass provincia (and optionally departamento or localidad) to disambiguate: the same street name exists in many cities.',
      inputSchema: {
        direccion: z.string().trim().min(3).max(300).describe('Street and number, e.g. "Av. Corrientes 1234". Do not include the city; use the filters.'),
        provincia,
        departamento: z.string().trim().min(1).max(200).optional().describe('Department name or id, e.g. "Comuna 1"'),
        localidad: z.string().trim().min(1).max(200).optional().describe('Locality name or id, e.g. "Tandil"'),
        max: max.default(5),
      },
      annotations: ALL_ANNOTATIONS,
    },
    async (args) => {
      try {
        const page = await backend.addresses(args);
        return listResult(
          page,
          (a) => `${a.nomenclatura} [street id ${a.calle?.id ?? '?'}] ${fmtPoint(a.ubicacion)}`,
          'direcciones',
          'Use the form "street number" without the city (e.g. "corrientes 1234"), and pass the city as provincia/localidad. Coverage depends on INDEC street data and is incomplete in some areas.',
        );
      } catch (e) {
        return upstreamFailure('normalize the address', e);
      }
    },
  );

  server.registerTool(
    'reverse_geocode',
    {
      title: 'Reverse geocode',
      description: 'Find the province, department and municipality that contain a WGS84 point (lat, lon). Only points inside Argentina resolve.',
      inputSchema: {
        lat: z.number().min(-90).max(90).describe('Latitude in decimal degrees, e.g. -34.6037'),
        lon: z.number().min(-180).max(180).describe('Longitude in decimal degrees, e.g. -58.3816'),
      },
      annotations: ALL_ANNOTATIONS,
    },
    async ({ lat, lon }) => {
      try {
        const loc = await backend.location(lat, lon);
        if (!loc.provincia?.id) {
          return ok(`No Argentine province contains (${lat}, ${lon}). Check that lat/lon are not swapped (Argentina is roughly lat -22 to -55, lon -53 to -74).`, { ubicacion: loc });
        }
        const parts = [
          `Province: ${loc.provincia.nombre} [id ${loc.provincia.id}]`,
          `Department: ${loc.departamento?.nombre ?? '—'}${loc.departamento?.id ? ` [id ${loc.departamento.id}]` : ''}`,
          `Municipality: ${loc.municipio?.nombre ?? '—'}${loc.municipio?.id ? ` [id ${loc.municipio.id}]` : ''}`,
        ];
        return ok(parts.join('\n'), { ubicacion: loc });
      } catch (e) {
        return upstreamFailure('reverse geocode', e);
      }
    },
  );
}
