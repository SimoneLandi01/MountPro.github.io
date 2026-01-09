
export enum POIType {
  BIVOUAC = 'Bivacco',
  FOUNTAIN = 'Fontana',
  REFUGE = 'Rifugio',
  PICNIC = 'Area Picnic',
  VIEWPOINT = 'Punto Panoramico'
}

export enum Exposure {
  NORTH = 'Nord',
  SOUTH = 'Sud',
  EAST = 'Est',
  WEST = 'Ovest',
  VARIOUS = 'Vario'
}

export enum SignalStrength {
  NONE = '/',
  LOW = 'H+',
  MEDIUM = '3G',
  HIGH = '4G',
  EXCELLENT = '5G'
}

export interface POI {
  id: string;
  name: string;
  type: POIType;
  altitude: number;
  coordinates: { lat: number; lng: number };
  exposure: Exposure;
  signal: SignalStrength;
  hasWater: boolean;
  hasRoof: boolean;
  hasElectricity: boolean;
  hasFireplace: boolean;
  description: string;
  imageUrl: string;
}

export interface LiveConditions {
  temperature: string;
  condition: string;
  wind: string;
  sunrise: string;
  sunset: string;
  connectivity_info: {
    type: string; // "5G", "4G", "3G", "H+", "/"
    strength: number; // 0 to 4
    description: string;
  };
  snow_ice_alert: boolean;
  summary: string;
  google_maps_url?: string;
}

export interface Trail {
  id: string;
  name: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  lengthKm: number;
  gainM: number;
  duration: string;
}
