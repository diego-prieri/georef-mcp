# georef-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI agents access to Argentina's official geographic data through the public **Georef API**.

> _Normalizá direcciones y buscá provincias, departamentos, municipios y localidades de Argentina desde tu agente._

[Georef](https://datosgobar.github.io/georef-ar-api/) (Servicio de Normalización de Datos Geográficos de Argentina) is a free public API from the Argentine government's open data team (datos.gob.ar). It normalizes free-text place names and street addresses into official names, INDEC ids and coordinates. No API key is needed.

## Tools

All tools are read-only (`readOnlyHint: true`) and call an external service (`openWorldHint: true`).

| Tool | Georef endpoint | Inputs | Returns |
| --- | --- | --- | --- |
| `search_provinces` | `/provincias` | `nombre?`, `max` | name, id, centroid |
| `search_departments` | `/departamentos` | `nombre?`, `provincia?`, `max` | name, id, province, centroid |
| `search_municipalities` | `/municipios` | `nombre?`, `provincia?`, `max` | name, id, province, centroid |
| `search_localities` | `/localidades` | `nombre`, `provincia?`, `departamento?`, `max` | name, id, department, province, centroid |
| `normalize_address` | `/direcciones` | `direccion`, `provincia?`, `departamento?`, `localidad?`, `max` | official address, street id, coordinates |
| `reverse_geocode` | `/ubicacion` | `lat`, `lon` | province, department, municipality |

`max` is bounded to 1–50. Filters accept a name (accents optional) or an INDEC id. Text output is one compact line per result; the full Georef objects are in `structuredContent`. Empty results come back as a normal result with a hint on what to try; upstream errors (4xx/5xx, timeouts) come back as `isError: true` with Georef's own message and a suggestion.

## Install

Requires Node.js 20 or newer.

```bash
git clone https://github.com/diego-prieri/georef-mcp && cd georef-mcp
npm install
npm run build
claude mcp add georef -- node /absolute/path/to/georef-mcp/dist/index.js
```

Any MCP client that launches stdio servers works the same way: run `node dist/index.js`.

Optional environment variable:

- `GEOREF_BASE_URL`: point at a self-hosted Georef instance (default `https://apis.datos.gob.ar/georef/api/`).

## Example prompts

- "normalizá 'av corrientes 1234 caba'"
- "What province and municipality is -31.4201, -64.1888 in?"
- "List the departments of Mendoza with their ids."
- "Is there a locality called San Martín in Buenos Aires province? Give me the coordinates."
- "Find the municipality of Rosario and its INDEC code."

## Development

```bash
npm test            # in-memory client ↔ server tests, no network
npm run test:live   # smoke test against the real API (GEOREF_LIVE=1)
npm run typecheck
npm run inspect     # MCP Inspector
```

```
src/
  backend.ts        GeorefBackend interface + HttpGeorefBackend (fetch) + FakeGeorefBackend
  tools/georef.ts   Tool definitions: zod inputs, annotations, ok()/fail() results
  server.ts         createServer(backend), no transport
  index.ts          stdio entry point
test/
  server.test.ts    Every tool, validation, empty results, upstream failures
  live.test.ts      Optional live smoke test
```

## Data attribution and licence

The data is served by the Georef API, published by the Argentine government's open data team (Dirección Nacional de Datos e Información Pública). According to the [Georef data documentation](https://datosgobar.github.io/georef-ar-api/etl-data/), the sources are:

- Provinces, departments, municipalities and `/ubicacion`: Instituto Geográfico Nacional (IGN)
- Localities: Base de Asentamientos Humanos de la República Argentina (BAHRA)
- Streets and addresses: Instituto Nacional de Estadística y Censos (INDEC)

The dataset [_Servicio de normalización de direcciones y unidades territoriales de Argentina_](https://datos.gob.ar/dataset/servicio-de-normalizacion-de-direcciones-y-unidades-territoriales-de-argentina) on datos.gob.ar is licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**. If you publish results obtained through this server, credit the sources above. The Georef API code itself is [MIT-licensed](https://github.com/datosgobar/georef-ar-api).

This project is not affiliated with or endorsed by the Argentine government. The public API has usage quotas; please be considerate with request volume.

## License

MIT (this server's code). See [LICENSE](LICENSE).
