import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GeorefBackend } from './backend.js';
import { registerGeorefTools } from './tools/georef.js';

export const SERVER_INFO = { name: 'georef-mcp', version: '0.1.0' };

/** Builds the server without a transport, so tests and the CLI share it. */
export function createServer(backend: GeorefBackend): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Argentina's official geographic data (Georef API, datos.gob.ar). Use normalize_address for street addresses (pass provincia/localidad to disambiguate), " +
      'search_* tools for administrative units and towns, and reverse_geocode for coordinates. Names are matched without accents; ids are INDEC codes and can be used as filters.',
  });
  registerGeorefTools(server, backend);
  return server;
}
