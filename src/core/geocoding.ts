import { clampLatitude, normalizeLongitude } from '@/core/mapTiles';

export interface PlaceSearchResult {
  id: string;
  name: string;
  subtitle: string;
  displayName: string;
  lat: number;
  lon: number;
  source: 'nominatim' | 'photon' | 'offline';
}

interface BuiltinCityEntry {
  name: string;
  subtitle: string;
  aliases?: string[];
  lat: number;
  lon: number;
}

const BUILTIN_CITIES: BuiltinCityEntry[] = [
  { name: 'San Francisco', subtitle: 'California, United States', aliases: ['sf'], lat: 37.7749, lon: -122.4194 },
  { name: 'Mountain View', subtitle: 'California, United States', aliases: ['googleplex'], lat: 37.422, lon: -122.0841 },
  { name: 'New York City', subtitle: 'New York, United States', aliases: ['nyc', 'manhattan'], lat: 40.7128, lon: -74.006 },
  { name: 'Central Park', subtitle: 'New York, United States', lat: 40.7829, lon: -73.9654 },
  { name: 'Los Angeles', subtitle: 'California, United States', aliases: ['la'], lat: 34.0522, lon: -118.2437 },
  { name: 'Seattle', subtitle: 'Washington, United States', lat: 47.6062, lon: -122.3321 },
  { name: 'Austin', subtitle: 'Texas, United States', lat: 30.2672, lon: -97.7431 },
  { name: 'Boston', subtitle: 'Massachusetts, United States', aliases: ['mit', 'cambridge'], lat: 42.3601, lon: -71.0589 },
  { name: 'Chicago', subtitle: 'Illinois, United States', lat: 41.8781, lon: -87.6298 },
  { name: 'Toronto', subtitle: 'Ontario, Canada', lat: 43.6532, lon: -79.3832 },
  { name: 'London', subtitle: 'United Kingdom', lat: 51.5074, lon: -0.1278 },
  { name: 'Paris', subtitle: 'France', lat: 48.8566, lon: 2.3522 },
  { name: 'Berlin', subtitle: 'Germany', lat: 52.52, lon: 13.405 },
  { name: 'Munich', subtitle: 'Bavaria, Germany', aliases: ['munchen'], lat: 48.1351, lon: 11.582 },
  { name: 'Zurich', subtitle: 'Switzerland', aliases: ['eth zurich'], lat: 47.3769, lon: 8.5417 },
  { name: 'Amsterdam', subtitle: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  { name: 'Madrid', subtitle: 'Spain', lat: 40.4168, lon: -3.7038 },
  { name: 'Rome', subtitle: 'Italy', lat: 41.9028, lon: 12.4964 },
  { name: 'Tokyo', subtitle: 'Japan', lat: 35.6762, lon: 139.6503 },
  { name: 'Osaka', subtitle: 'Japan', lat: 34.6937, lon: 135.5023 },
  { name: 'Seoul', subtitle: 'South Korea', lat: 37.5665, lon: 126.978 },
  { name: 'Singapore', subtitle: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Bengaluru', subtitle: 'Karnataka, India', aliases: ['bangalore'], lat: 12.9716, lon: 77.5946 },
  { name: 'Mumbai', subtitle: 'Maharashtra, India', aliases: ['bombay'], lat: 19.076, lon: 72.8777 },
  { name: 'New Delhi', subtitle: 'Delhi, India', aliases: ['delhi'], lat: 28.6139, lon: 77.209 },
  { name: 'Hyderabad', subtitle: 'Telangana, India', lat: 17.385, lon: 78.4867 },
  { name: 'Chennai', subtitle: 'Tamil Nadu, India', aliases: ['madras'], lat: 13.0827, lon: 80.2707 },
  { name: 'Pune', subtitle: 'Maharashtra, India', lat: 18.5204, lon: 73.8567 },
  { name: 'Kolkata', subtitle: 'West Bengal, India', lat: 22.5726, lon: 88.3639 },
  { name: 'Dubai', subtitle: 'United Arab Emirates', lat: 25.2048, lon: 55.2708 },
  { name: 'Sydney', subtitle: 'New South Wales, Australia', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', subtitle: 'Victoria, Australia', lat: -37.8136, lon: 144.9631 },
  { name: 'Sao Paulo', subtitle: 'Brazil', lat: -23.5505, lon: -46.6333 },
  { name: 'Mexico City', subtitle: 'Mexico', lat: 19.4326, lon: -99.1332 },
  { name: 'Cairo', subtitle: 'Egypt', lat: 30.0444, lon: 31.2357 },
  { name: 'Cape Town', subtitle: 'South Africa', lat: -33.9249, lon: 18.4241 },
];

export function parseNominatimResults(payload: unknown): PlaceSearchResult[] {
  if (!Array.isArray(payload)) return [];
  const results: PlaceSearchResult[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const lat = Number(rec.lat);
    const lon = Number(rec.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const displayName = typeof rec.display_name === 'string' ? rec.display_name.trim() : '';
    const rawName = typeof rec.name === 'string' ? rec.name.trim() : '';
    const segments = displayName
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const name = rawName || segments[0] || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const subtitleParts = segments.filter((s, idx) => !(idx === 0 && s.toLowerCase() === name.toLowerCase()));
    const subtitle = subtitleParts.slice(0, 3).join(', ');
    results.push({
      id: `nom_${String(rec.place_id ?? `${lat}_${lon}`)}`,
      name,
      subtitle,
      displayName: displayName || (subtitle ? `${name}, ${subtitle}` : name),
      lat: clampLatitude(lat),
      lon: normalizeLongitude(lon),
      source: 'nominatim',
    });
  }
  return results;
}

export function parsePhotonResults(payload: unknown): PlaceSearchResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const results: PlaceSearchResult[] = [];
  for (let i = 0; i < features.length; i++) {
    const feat = features[i] as Record<string, unknown> | null;
    if (!feat || typeof feat !== 'object') continue;
    const geom = feat.geometry as { coordinates?: unknown } | undefined;
    const coords = Array.isArray(geom?.coordinates) ? geom.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const props = (feat.properties as Record<string, unknown> | undefined) ?? {};
    const name =
      (typeof props.name === 'string' && props.name.trim()) ||
      (typeof props.city === 'string' && props.city.trim()) ||
      `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const subParts = [props.city, props.state, props.country]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .filter((v) => v.toLowerCase() !== name.toLowerCase());
    const uniqueSubs = Array.from(new Set(subParts));
    const subtitle = uniqueSubs.join(', ');
    results.push({
      id: `pho_${String(props.osm_id ?? i)}_${lat.toFixed(4)}`,
      name,
      subtitle,
      displayName: subtitle ? `${name}, ${subtitle}` : name,
      lat: clampLatitude(lat),
      lon: normalizeLongitude(lon),
      source: 'photon',
    });
  }
  return results;
}

export function searchOfflineCities(query: string, limit = 6): PlaceSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: { score: number; entry: BuiltinCityEntry }[] = [];
  for (const entry of BUILTIN_CITIES) {
    const nameLower = entry.name.toLowerCase();
    const subLower = entry.subtitle.toLowerCase();
    const aliasMatch = (entry.aliases ?? []).some((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase()));
    let score = 0;
    if (nameLower === q) score = 100;
    else if (nameLower.startsWith(q)) score = 80;
    else if (aliasMatch) score = 70;
    else if (nameLower.includes(q)) score = 55;
    else if (subLower.includes(q)) score = 30;
    if (score > 0) {
      matches.push({ score, entry });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map(({ entry }) => ({
    id: `offline_${entry.name.toLowerCase().replace(/\s+/g, '_')}`,
    name: entry.name,
    subtitle: entry.subtitle,
    displayName: `${entry.name}, ${entry.subtitle}`,
    lat: entry.lat,
    lon: entry.lon,
    source: 'offline',
  }));
}

/**
 * Geocode a city, address, or landmark name using OpenStreetMap Nominatim with
 * automatic Photon fallback and offline major-city fallback.
 */
export async function searchPlaces(
  query: string,
  opts?: { limit?: number; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const limit = Math.max(1, Math.min(10, opts?.limit ?? 6));
  const fetcher = opts?.fetchImpl ?? globalThis.fetch;

  if (typeof fetcher === 'function') {
    // Primary: OpenStreetMap Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&addressdetails=1&q=${encodeURIComponent(trimmed)}`;
      const res = await fetcher(url, {
        signal: opts?.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data: unknown = await res.json();
        const parsed = parseNominatimResults(data);
        if (parsed.length > 0) return parsed.slice(0, limit);
      }
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
    }

    // Fallback: Photon (Komoot OpenStreetMap geocoder)
    try {
      const url = `https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(trimmed)}`;
      const res = await fetcher(url, {
        signal: opts?.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data: unknown = await res.json();
        const parsed = parsePhotonResults(data);
        if (parsed.length > 0) return parsed.slice(0, limit);
      }
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
    }
  }

  return searchOfflineCities(trimmed, limit);
}
