// Tiny client for OneMap (data.gov.sg) Elastic search — no auth, CORS-friendly.

export interface OneMapResult {
  address:   string; // ADDRESS, title-cased
  postal:    string; // POSTAL (or '')
  building:  string; // BUILDING (or '')
  latitude:  number;
  longitude: number;
}

interface OneMapRawResult {
  SEARCHVAL?:  string;
  BLK_NO?:     string;
  ROAD_NAME?:  string;
  BUILDING?:   string;
  ADDRESS?:    string;
  POSTAL?:     string;
  LATITUDE?:   string;
  LONGITUDE?:  string;
}

const ENDPOINT = 'https://www.onemap.gov.sg/api/common/elastic/search';

// "10 BAYFRONT AVENUE MARINA BAY SANDS SINGAPORE 018956"
// → "10 Bayfront Avenue Marina Bay Sands Singapore 018956"
// SG postal codes stay numeric so they're unaffected.
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s|\(|\/|-)([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export async function searchOneMap(query: string, signal?: AbortSignal): Promise<OneMapResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `${ENDPOINT}?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json() as { results?: OneMapRawResult[] };
    const rows = data.results ?? [];
    return rows.slice(0, 10).map((r) => ({
      address:   titleCase(r.ADDRESS ?? ''),
      postal:    r.POSTAL  === 'NIL' ? '' : (r.POSTAL ?? ''),
      building:  r.BUILDING === 'NIL' ? '' : titleCase(r.BUILDING ?? ''),
      latitude:  Number(r.LATITUDE)  || 0,
      longitude: Number(r.LONGITUDE) || 0,
    })).filter((r) => r.address && r.latitude && r.longitude);
  } catch {
    return [];
  }
}
