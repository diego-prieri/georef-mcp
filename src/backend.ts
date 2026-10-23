/**
 * The backend the tools talk to. Tools depend on this interface only, so the
 * HTTP client can be swapped for a fake in tests (no network needed).
 * Field names mirror the Georef API responses (Spanish), verified with curl.
 */
export interface Ref {
  id: string | null;
  nombre: string | null;
}

export interface Point {
  lat: number;
  lon: number;
}

export interface Province {
  id: string;
  nombre: string;
  centroide: Point;
}

export interface Department extends Province {
  provincia: Ref;
}

export interface Municipality extends Province {
  provincia: Ref;
}

export interface Locality extends Province {
  categoria?: string;
  provincia: Ref;
  departamento?: Ref;
  municipio?: Ref;
  localidad_censal?: Ref;
}

export interface Address {
  nomenclatura: string;
  calle: Ref & { categoria?: string | null };
  altura: { valor: number | null; unidad: string | null };
  piso?: string | null;
  calle_cruce_1?: Ref;
  calle_cruce_2?: Ref;
  departamento: Ref;
  localidad_censal?: Ref;
  provincia: Ref;
  ubicacion: { lat: number | null; lon: number | null };
}

export interface Location {
  lat: number;
  lon: number;
  provincia: Ref;
  departamento: Ref;
  municipio: Ref;
}

/** A page of results: `total` is how many matched upstream, `items` what was returned. */
export interface Page<T> {
  total: number;
  items: T[];
}

export interface PlaceQuery {
  nombre?: string;
  provincia?: string;
  departamento?: string;
  max: number;
}

export interface AddressQuery {
  direccion: string;
  provincia?: string;
  departamento?: string;
  localidad?: string;
  max: number;
}

export interface GeorefBackend {
  provinces(q: PlaceQuery): Promise<Page<Province>>;
  departments(q: PlaceQuery): Promise<Page<Department>>;
  municipalities(q: PlaceQuery): Promise<Page<Municipality>>;
  localities(q: PlaceQuery): Promise<Page<Locality>>;
  addresses(q: AddressQuery): Promise<Page<Address>>;
  location(lat: number, lon: number): Promise<Location>;
}

/** Upstream error with the HTTP status and, when present, Georef's own message. */
export class GeorefError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const DEFAULT_BASE_URL = 'https://apis.datos.gob.ar/georef/api/';
const USER_AGENT = 'georef-mcp/0.1.0 (MCP server; Node.js)';

export class HttpGeorefBackend implements GeorefBackend {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL, private timeoutMs = 15_000) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private async get<T>(resource: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(resource, this.baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new GeorefError(`network error calling Georef /${resource}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      // Georef returns { errores: [{ mensaje, nombre_parametro? }] } on 4xx/5xx.
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { errores?: { mensaje?: string; nombre_parametro?: string }[] };
        const msgs = body.errores?.map((e) => (e.nombre_parametro ? `${e.nombre_parametro}: ${e.mensaje}` : e.mensaje)).filter(Boolean);
        if (msgs?.length) detail = msgs.join('; ');
      } catch {
        /* non-JSON body */
      }
      throw new GeorefError(`Georef /${resource} returned ${res.status}: ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }

  private async list<T>(resource: string, key: string, params: Record<string, string | number | undefined>): Promise<Page<T>> {
    const body = await this.get<Record<string, unknown>>(resource, params);
    return { total: Number(body.total ?? 0), items: (body[key] as T[]) ?? [] };
  }

  provinces({ nombre, max }: PlaceQuery) {
    return this.list<Province>('provincias', 'provincias', { nombre, max });
  }
  departments({ nombre, provincia, max }: PlaceQuery) {
    return this.list<Department>('departamentos', 'departamentos', { nombre, provincia, max });
  }
  municipalities({ nombre, provincia, max }: PlaceQuery) {
    return this.list<Municipality>('municipios', 'municipios', { nombre, provincia, max });
  }
  localities({ nombre, provincia, departamento, max }: PlaceQuery) {
    return this.list<Locality>('localidades', 'localidades', { nombre, provincia, departamento, max });
  }
  addresses({ direccion, provincia, departamento, localidad, max }: AddressQuery) {
    return this.list<Address>('direcciones', 'direcciones', { direccion, provincia, departamento, localidad, max });
  }
  async location(lat: number, lon: number): Promise<Location> {
    const body = await this.get<{ ubicacion: Location }>('ubicacion', { lat, lon });
    return body.ubicacion;
  }
}

/** Deterministic in-memory backend for tests. Matching is accent- and case-insensitive substring. */
export interface FakeData {
  provinces?: Province[];
  departments?: Department[];
  municipalities?: Municipality[];
  localities?: Locality[];
  addresses?: Address[];
  locations?: Location[];
}

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const matches = (value: string | null | undefined, q?: string) => !q || norm(value).includes(norm(q));
const refMatches = (ref: Ref | undefined, q?: string) => !q || ref?.id === q || matches(ref?.nombre, q);

export class FakeGeorefBackend implements GeorefBackend {
  constructor(private data: FakeData = {}) {}

  private page<T>(all: T[], max: number): Page<T> {
    return { total: all.length, items: all.slice(0, max) };
  }

  async provinces({ nombre, max }: PlaceQuery) {
    return this.page((this.data.provinces ?? []).filter((p) => matches(p.nombre, nombre)), max);
  }
  async departments({ nombre, provincia, max }: PlaceQuery) {
    return this.page((this.data.departments ?? []).filter((d) => matches(d.nombre, nombre) && refMatches(d.provincia, provincia)), max);
  }
  async municipalities({ nombre, provincia, max }: PlaceQuery) {
    return this.page((this.data.municipalities ?? []).filter((m) => matches(m.nombre, nombre) && refMatches(m.provincia, provincia)), max);
  }
  async localities({ nombre, provincia, departamento, max }: PlaceQuery) {
    return this.page(
      (this.data.localities ?? []).filter(
        (l) => matches(l.nombre, nombre) && refMatches(l.provincia, provincia) && refMatches(l.departamento, departamento),
      ),
      max,
    );
  }
  async addresses({ direccion, provincia, max }: AddressQuery) {
    return this.page(
      (this.data.addresses ?? []).filter((a) => matches(a.nomenclatura, direccion) && refMatches(a.provincia, provincia)),
      max,
    );
  }
  async location(lat: number, lon: number): Promise<Location> {
    const hit = this.data.locations?.find((l) => l.lat === lat && l.lon === lon);
    const empty = { id: null, nombre: null };
    return hit ?? { lat, lon, provincia: empty, departamento: empty, municipio: empty };
  }
}
