
import { POI, POIType, Exposure, SignalStrength } from '../types';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const ELEVATION_API_URL = 'https://api.open-meteo.com/v1/elevation';

// Helper to convert OSM tags to our App Types
const mapOsmTypeToPoiType = (tags: any): POIType | null => {
  if (tags.amenity === 'drinking_water' || tags.natural === 'spring') return POIType.FOUNTAIN;
  
  const name = tags.name || '';
  const nameLower = name.toLowerCase();

  const isStructure = 
    tags.tourism === 'wilderness_hut' || 
    tags.tourism === 'alpine_hut' || 
    (tags.amenity === 'shelter');

  if (isStructure && nameLower.includes('bivacco')) {
    return POIType.BIVOUAC;
  }
  
  return null;
};

// Optimized images (w=400 for thumbnails to load faster)
const getPlaceHolderImage = (type: POIType) => {
  switch (type) {
    case POIType.FOUNTAIN: return 'https://images.unsplash.com/photo-1542385906-e789f28c5a24?w=400&q=80';
    case POIType.BIVOUAC: return 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=400&q=80';
    default: return 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80';
  }
};

// Helper to parse elevation from OSM tags flexibly (e.g. "2400 m", "2400m", "2400")
const parseOsmElevation = (eleStr: string): number => {
  if (!eleStr) return 0;
  // Regex to find the first number in the string (handles "2400 m")
  const match = eleStr.match(/(\d+)/);
  return match ? parseInt(match[0]) : 0;
};

// Helper to fill missing altitude using Open-Meteo API (More reliable)
const enrichWithAltitude = async (pois: POI[]): Promise<POI[]> => {
  const poisMissingAlt = pois.filter(p => p.altitude === 0);
  if (poisMissingAlt.length === 0) return pois;

  // Increased chunk size for better batching
  const toFetch = poisMissingAlt.slice(0, 150); 
  
  const lats = toFetch.map(p => p.coordinates.lat).join(',');
  const lngs = toFetch.map(p => p.coordinates.lng).join(',');

  try {
    const url = `${ELEVATION_API_URL}?latitude=${lats}&longitude=${lngs}`;
    const res = await fetch(url); // Elevation API usually fast, no signal needed strictly here
    const data = await res.json();
    
    // Open-Meteo returns { elevation: [alt1, alt2, ...] }
    if (!data || !data.elevation || data.elevation.length !== toFetch.length) {
       return pois;
    }

    const elevationMap = new Map();
    data.elevation.forEach((ele: number, index: number) => {
      elevationMap.set(toFetch[index].id, ele);
    });

    return pois.map(p => {
      if (elevationMap.has(p.id)) {
        return { ...p, altitude: Math.round(elevationMap.get(p.id)) };
      }
      return p;
    });

  } catch (e) {
    // Silent fail is okay, we keep original OSM data (even if 0) or previous values
    return pois;
  }
};

const processOsmElements = (elements: any[], filterType: POIType | 'All'): POI[] => {
  return elements
      .filter((el: any) => (el.type === 'node' || el.type === 'way') && el.tags)
      .map((el: any) => {
        const type = mapOsmTypeToPoiType(el.tags);
        if (!type) return null;
        if (filterType !== 'All' && type !== filterType) return null;

        // Optimized altitude parsing directly from tags
        const osmAltitude = parseOsmElevation(el.tags.ele);
        
        // Handle coordinates for Nodes (lat/lon) and Ways (center.lat/center.lon)
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;

        if (!lat || !lng) return null;

        return {
          id: `osm-${el.id}`,
          name: el.tags.name,
          type: type,
          // Use robust OSM elevation first
          altitude: osmAltitude, 
          coordinates: { lat: lat, lng: lng },
          exposure: Exposure.VARIOUS,
          signal: SignalStrength.NONE,
          hasWater: type === POIType.FOUNTAIN || (el.tags.drinking_water === 'yes'),
          hasRoof: type === POIType.BIVOUAC || (el.tags.amenity === 'shelter'),
          // Check for electricity tags
          hasElectricity: el.tags.electricity === 'yes' || el.tags.power_supply === 'yes',
          // Check for fireplace/heating tags
          hasFireplace: el.tags.fireplace === 'yes' || el.tags.heating === 'stove' || el.tags.heating === 'wood',
          description: el.tags.description || el.tags.note || (type === POIType.BIVOUAC ? 'Bivacco non custodito.' : 'Punto acqua.'),
          imageUrl: getPlaceHolderImage(type)
        };
      })
      .filter((poi: POI | null) => poi !== null) as POI[];
}

// --- GLOBAL SEARCH BY NAME ---
export const searchOsmPoisByName = async (searchTerm: string): Promise<POI[]> => {
  const boundsStr = "(36,6,48,19)"; 
  const cleanTerm = searchTerm.replace(/"/g, '\\"'); 

  // Added 'way' search to find building outlines too
  const query = `
    [out:json][timeout:15];
    (
      node["tourism"~"wilderness_hut|alpine_hut"]["name"~"${cleanTerm}",i]${boundsStr};
      way["tourism"~"wilderness_hut|alpine_hut"]["name"~"${cleanTerm}",i]${boundsStr};
      
      node["amenity"="shelter"]["name"~"Bivacco",i]["name"~"${cleanTerm}",i]${boundsStr};
      way["amenity"="shelter"]["name"~"Bivacco",i]["name"~"${cleanTerm}",i]${boundsStr};
    );
    out center qt 20;
  `;

  try {
    const formData = new URLSearchParams();
    formData.append('data', query);
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: formData
    });
    if (!response.ok) throw new Error("Search failed");
    const data = await response.json();
    
    if (!data.elements) return [];

    let pois = processOsmElements(data.elements, 'All');
    pois = await enrichWithAltitude(pois);

    return pois;
  } catch (error) {
    console.error("Search Error:", error);
    return [];
  }
};

// --- BOUNDING BOX SEARCH (WITH ABORT SIGNAL) ---
export const fetchOsmPois = async (
  bounds: { south: number; west: number; north: number; east: number }, 
  filterType: POIType | 'All',
  signal?: AbortSignal // Added Signal
): Promise<POI[]> => {
  let queryFilters = '';
  const includeFountains = filterType === 'All' || filterType === POIType.FOUNTAIN;
  const includeBivouacs = filterType === 'All' || filterType === POIType.BIVOUAC;
  const bbox = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`;

  if (includeFountains) {
    queryFilters += `
      node["amenity"="drinking_water"]${bbox};
      node["natural"="spring"]${bbox};
    `;
  }

  if (includeBivouacs) {
    // Search both nodes (points) and ways (buildings/polygons)
    queryFilters += `
      node["tourism"~"wilderness_hut|alpine_hut"]["name"~"Bivacco",i]${bbox};
      way["tourism"~"wilderness_hut|alpine_hut"]["name"~"Bivacco",i]${bbox};
      
      node["amenity"="shelter"]["name"~"Bivacco",i]${bbox};
      way["amenity"="shelter"]["name"~"Bivacco",i]${bbox};
    `;
  }

  if (!queryFilters.trim()) return [];

  // Optimized: Timeout 25s for large areas, Limit 2000 items
  // 'out center' is crucial for 'way' elements to return a single coordinate
  const query = `
    [out:json][timeout:25];
    (
      ${queryFilters}
    );
    out center qt 2000;
  `;

  try {
    const formData = new URLSearchParams();
    formData.append('data', query);

    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: formData,
      signal: signal // Pass signal to fetch
    });

    if (!response.ok) {
      throw new Error(`OSM API Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.elements) return [];

    let pois = processOsmElements(data.elements, filterType);
    
    // Enrich only small batches to avoid blocking
    if (pois.length > 0 && pois.length < 200) {
       pois = await enrichWithAltitude(pois);
    }
    
    return pois;

  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Request cancelled, strictly not an error
      return []; 
    }
    console.warn("Error fetching OSM data:", error);
    return [];
  }
};
