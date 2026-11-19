import { describe, expect, it } from 'vitest';
import {
  parseNominatimResults,
  parsePhotonResults,
  searchOfflineCities,
  searchPlaces,
} from '@/core/geocoding';
import {
  formatLatLonPair,
  nudgeLatLonMeters,
  parseCoordinateInput,
  shiftLatLonByMapDrag,
} from '@/core/mapTiles';

describe('Enhanced coordinate parsing and map drag/nudge math', () => {
  it('parses decimal, cardinal, DMS, and Google Maps / OpenStreetMap URLs', () => {
    expect(parseCoordinateInput('37.4220, -122.0841')).toEqual({ lat: 37.422, lon: -122.0841 });
    expect(parseCoordinateInput('(12.9716, 77.5946)')).toEqual({ lat: 12.9716, lon: 77.5946 });
    expect(parseCoordinateInput('37.422° N, 122.0841° W')).toEqual({ lat: 37.422, lon: -122.0841 });
    expect(parseCoordinateInput('33.8688S 151.2093E')).toEqual({ lat: -33.8688, lon: 151.2093 });

    const dms = parseCoordinateInput(`37°25'19.2"N 122°05'02.8"W`);
    expect(dms).not.toBeNull();
    expect(dms!.lat).toBeCloseTo(37.422, 4);
    expect(dms!.lon).toBeCloseTo(-122.08411, 4);

    const gmaps = parseCoordinateInput(
      'https://www.google.com/maps/place/Googleplex/@37.4220656,-122.0840897,17z/data=!3m1',
    );
    expect(gmaps).toEqual({ lat: 37.4220656, lon: -122.0840897 });

    const gmapsQuery = parseCoordinateInput('https://maps.google.com/?q=48.8584,2.2945');
    expect(gmapsQuery).toEqual({ lat: 48.8584, lon: 2.2945 });

    const osm = parseCoordinateInput('https://www.openstreetmap.org/#map=18/51.5074/-0.1278');
    expect(osm).toEqual({ lat: 51.5074, lon: -0.1278 });

    // Plain city names should NOT parse as coordinates
    expect(parseCoordinateInput('Tokyo')).toBeNull();
    expect(parseCoordinateInput('San Francisco, CA')).toBeNull();
  });

  it('shifts lat/lon accurately on map drag for 0°, 90°, and 180° headings', () => {
    const baseLat = 37.422;
    const baseLon = -122.0841;

    // Heading 0°: dragging map RIGHT (+100m) brings western area into center => longitude decreases
    const dragRight = shiftLatLonByMapDrag(baseLat, baseLon, 100, 0, 0);
    expect(dragRight.lat).toBeCloseTo(baseLat, 6);
    expect(dragRight.lon).toBeLessThan(baseLon);

    // Heading 0°: dragging map DOWN (-100m ROS Y) brings northern area into center => latitude increases
    const dragDown = shiftLatLonByMapDrag(baseLat, baseLon, 0, -100, 0);
    expect(dragDown.lat).toBeGreaterThan(baseLat);
    expect(dragDown.lon).toBeCloseTo(baseLon, 6);

    // Heading +90° (North points right): dragging map LEFT (-100m) pulls North into center => latitude increases
    const dragLeftRot90 = shiftLatLonByMapDrag(baseLat, baseLon, -100, 0, 90);
    expect(dragLeftRot90.lat).toBeGreaterThan(baseLat);
    expect(dragLeftRot90.lon).toBeCloseTo(baseLon, 6);

    // Heading 180°: dragging map RIGHT (+100m) moves center EAST => longitude increases
    const dragRightRot180 = shiftLatLonByMapDrag(baseLat, baseLon, 100, 0, 180);
    expect(dragRightRot180.lat).toBeCloseTo(baseLat, 6);
    expect(dragRightRot180.lon).toBeGreaterThan(baseLon);
  });

  it('nudges lat/lon by exact meters and formats cleanly', () => {
    const north = nudgeLatLonMeters(0, 0, 0, 111.32);
    expect(north.lat).toBeCloseTo(0.001, 4);
    expect(north.lon).toBeCloseTo(0, 6);
    expect(formatLatLonPair(37.422, -122.0841, 4)).toBe('37.4220, -122.0841');
  });
});

describe('City & place geocoding', () => {
  it('parses Nominatim and Photon responses and falls back to offline major cities', async () => {
    const nom = parseNominatimResults([
      {
        place_id: 101,
        name: 'Bengaluru',
        display_name: 'Bengaluru, Bangalore Urban, Karnataka, India',
        lat: '12.9767936',
        lon: '77.590082',
      },
    ]);
    expect(nom).toHaveLength(1);
    expect(nom[0]!.name).toBe('Bengaluru');
    expect(nom[0]!.lat).toBeCloseTo(12.97679, 4);
    expect(nom[0]!.subtitle).toContain('Karnataka');

    const pho = parsePhotonResults({
      features: [
        {
          geometry: { coordinates: [139.6503, 35.6762] },
          properties: { osm_id: 22, name: 'Tokyo', country: 'Japan' },
        },
      ],
    });
    expect(pho).toHaveLength(1);
    expect(pho[0]!.name).toBe('Tokyo');
    expect(pho[0]!.lat).toBeCloseTo(35.6762, 4);
    expect(pho[0]!.lon).toBeCloseTo(139.6503, 4);

    // Offline alias match ("bangalore" -> Bengaluru)
    const offline = searchOfflineCities('bangalore');
    expect(offline.length).toBeGreaterThan(0);
    expect(offline[0]!.name).toBe('Bengaluru');

    // When fetch rejects, searchPlaces falls back cleanly to offline major cities
    const failingFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const fallbackHits = await searchPlaces('Tokyo', { fetchImpl: failingFetch });
    expect(fallbackHits.length).toBeGreaterThan(0);
    expect(fallbackHits[0]!.name).toBe('Tokyo');
  });
});
