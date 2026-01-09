import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, 
  List, 
  Mountain, 
  Droplets, 
  Home, 
  Signal, 
  Sun, 
  CloudSnow, 
  Navigation,
  ChevronLeft,
  Info,
  Wind,
  ExternalLink,
  RefreshCw,
  X,
  WifiOff,
  CloudOff,
  Filter,
  Trees,
  Thermometer,
  Cloud,
  Layers,
  CloudRain,
  Loader2,
  Search,
  Compass,
  Locate,
  Clock,
  Sunset,
  Sunrise,
  Image as ImageIcon,
  Zap,
  Flame,
  SignalHigh,
  SignalMedium,
  SignalLow,
  SignalZero,
  Smartphone
} from 'lucide-react';
import L from 'leaflet';
import { POI, POIType, Exposure, SignalStrength } from './types';
import { MOCK_POIS } from './constants';
import { getLiveOutdoorInfo, AIResponse } from './services/geminiService';
import { fetchOsmPois, searchOsmPoisByName } from './services/osmService';

// --- Custom Marker Icons Logic ---
const createCustomIcon = (type: POIType, isSelected: boolean) => {
  
  // --- BIVOUAC: Drop Shape (Pin) with House Icon ---
  if (type === POIType.BIVOUAC) {
    const size = isSelected ? 42 : 34; 
    
    return L.divIcon({
      className: 'custom-poi-marker',
      html: `
        <div class="w-full h-full drop-shadow-lg transition-transform duration-300 ${isSelected ? '-translate-y-2' : ''}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full filter">
            <!-- Drop/Pin Shape -->
            <path d="M12 2C7.58 2 4 5.58 4 10C4 14.42 12 22 12 22C12 22 20 14.42 20 10C20 5.58 16.42 2 12 2Z" fill="#ea580c" stroke="white" stroke-width="1.5"/>
            <!-- Stylized House Icon -->
            <path d="M8 10.5L12 7L16 10.5V15H8V10.5Z" fill="white"/> 
            <rect x="10.5" y="13" width="3" height="3" fill="#ea580c"/>
          </svg>
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size], 
      popupAnchor: [0, -size]
    });
  } 
  
  // --- FOUNTAIN: Circle Shape ---
  else if (type === POIType.FOUNTAIN) {
    const size = isSelected ? 36 : 28; 
    const bgColor = 'bg-blue-500';
    // Water drop icon inside circle
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-7.4-1.7-2.8-3-4-4-6.6-1 2.6-2.3 3.8-4 6.6-2 3.5-3 5.4-3 7.4a7 7 0 0 0 7 7z"/></svg>`; 
    const ring = isSelected ? `ring-4 ring-white/30` : 'shadow-lg';

    return L.divIcon({
      className: 'custom-poi-marker',
      html: `
        <div class="${bgColor} ${ring} w-full h-full rounded-full border-2 border-white flex items-center justify-center transition-transform duration-300">
          ${iconSvg}
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2],
      popupAnchor: [0, -size/2]
    });
  }

  // Fallback
  return L.divIcon({ className: '' });
};

const Badge: React.FC<{ children: React.ReactNode; color?: string; icon?: React.ReactNode }> = ({ children, color = 'bg-zinc-800', icon }) => (
  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${color} text-zinc-300 flex items-center gap-1`}>
    {icon}
    {children}
  </span>
);

export default function App() {
  // --- State Managment ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('map'); 
  const [liveInfo, setLiveInfo] = useState<AIResponse | null>(null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // --- Data Source State ---
  const [allPois, setAllPois] = useState<POI[]>(MOCK_POIS);
  const [isSearchingArea, setIsSearchingArea] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);

  // --- Map Layers State ---
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite'>('standard');
  const [showPrecipitation, setShowPrecipitation] = useState(false);
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);
  
  // --- Compass State ---
  const [heading, setHeading] = useState<number>(0);

  // --- Filter States ---
  // DEFAULT TO BIVOUACS
  const [selectedType, setSelectedType] = useState<POIType | 'All'>(POIType.BIVOUAC);
  const [altitudeRange, setAltitudeRange] = useState<{min: number, max: number}>({ min: 0, max: 4810 });
  const [selectedExposure, setSelectedExposure] = useState<Exposure | 'All'>('All');
  
  // Expanded Filters
  const [filterWater, setFilterWater] = useState(false);
  const [filterRoof, setFilterRoof] = useState(false);
  const [filterElectricity, setFilterElectricity] = useState(false);
  const [filterFireplace, setFilterFireplace] = useState(false);
  const [filterSignal, setFilterSignal] = useState(false); 
  
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.TileLayer | null>(null); // For roads on satellite
  const rainLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Ref to hold the AbortController for the current fetch request
  const fetchAbortControllerRef = useRef<AbortController | null>(null);

  const selectedTypeRef = useRef(selectedType);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { selectedTypeRef.current = selectedType; }, [selectedType]);

  // --- Compass Logic ---
  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      // Use webkitCompassHeading for iOS or alpha for Android
      const compass = (event as any).webkitCompassHeading || Math.abs(event.alpha! - 360);
      if (compass) setHeading(compass);
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  // --- Navigation & Reviews Logic ---
  const handleNavigation = () => {
    if (!selectedPoi) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.coordinates.lat},${selectedPoi.coordinates.lng}`;
    window.open(url, '_blank');
  };

  const handleOpenReviews = () => {
    if (!selectedPoi) return;
    if (liveInfo?.data?.google_maps_url) {
       window.open(liveInfo.data.google_maps_url, '_blank');
    } else {
       // Fallback to query search if no specific link found
       const query = encodeURIComponent(selectedPoi.name);
       window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
    }
  };

  // --- Daylight Calculation ---
  const calculateDaylight = (sunriseStr?: string, sunsetStr?: string) => {
    if (!sunriseStr || !sunsetStr) return null;
    try {
      const now = new Date();
      const parseTime = (str: string) => {
        const [h, m] = str.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0);
        return d;
      };
      const sunrise = parseTime(sunriseStr);
      const sunset = parseTime(sunsetStr);
      const totalMs = sunset.getTime() - sunrise.getTime();
      const totalHrs = Math.floor(totalMs / 3600000);
      const totalMins = Math.floor((totalMs % 3600000) / 60000);
      let remainingText = "Terminata";
      let isDark = true;
      if (now < sunset && now > sunrise) {
        const diffMs = sunset.getTime() - now.getTime();
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        remainingText = `${diffHrs}h ${diffMins}m`;
        isDark = false;
      } else if (now < sunrise) {
         remainingText = "Non ancora alba";
      }
      return { total: `${totalHrs}h ${totalMins}m`, remaining: remainingText, isDark };
    } catch (e) {
      return null;
    }
  };

  // --- Helper for Signal Icon ---
  const renderSignalIcon = (strength: number) => {
    const className = "w-4 h-4 text-emerald-500";
    if (strength >= 4) return <SignalHigh className={className} />;
    if (strength >= 3) return <SignalMedium className={className} />;
    if (strength >= 1) return <SignalLow className="w-4 h-4 text-yellow-500" />;
    return <SignalZero className="w-4 h-4 text-zinc-600" />;
  };

  // --- Search Logic ---
  const handleGlobalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || isOffline) return;

    setIsGlobalSearching(true);
    setViewMode('map');
    
    const results = await searchOsmPoisByName(searchQuery);
    
    if (results.length > 0) {
      setAllPois(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const uniqueNew = results.filter(p => !existingIds.has(p.id));
        return [...prev, ...uniqueNew];
      });

      const bestMatch = results[0];
      setSelectedPoi(bestMatch);
      
      if (mapRef.current) {
        mapRef.current.flyTo([bestMatch.coordinates.lat, bestMatch.coordinates.lng], 14, { duration: 1.5 });
      }
    } else {
      alert("Nessun bivacco trovato con questo nome.");
    }
    setIsGlobalSearching(false);
  };

  // --- Core Fetch Function (Viewport) with AbortController ---
  const executeFetch = async () => {
    if (!mapRef.current || isOffline) return;
    
    // Abort previous request if it exists
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort();
    }

    // Create new controller
    const controller = new AbortController();
    fetchAbortControllerRef.current = controller;

    setIsSearchingArea(true);
    const bounds = mapRef.current.getBounds();
    const formattedBounds = {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };

    try {
      const newPois = await fetchOsmPois(formattedBounds, selectedTypeRef.current, controller.signal);
      
      if (controller.signal.aborted) return; // Ignore if cancelled

      setAllPois(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const uniqueNewPois = newPois.filter(p => !existingIds.has(p.id));
        return [...prev, ...uniqueNewPois]; 
      });
    } catch (err) {
       // Ignore abort errors
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingArea(false);
        fetchAbortControllerRef.current = null;
      }
    }
  };

  // --- Filtering Logic ---
  const filteredPois = useMemo(() => {
    return allPois.filter(poi => {
      const isAllowedType = poi.type === POIType.BIVOUAC || poi.type === POIType.FOUNTAIN;
      if (!isAllowedType) return false;

      const matchesType = selectedType === 'All' || poi.type === selectedType;
      const matchesAltitude = (poi.altitude === 0 && altitudeRange.min === 0) || (poi.altitude >= altitudeRange.min && poi.altitude <= altitudeRange.max);
      const matchesExposure = selectedExposure === 'All' || poi.exposure === selectedExposure || poi.exposure === Exposure.VARIOUS;
      const matchesSignal = !filterSignal || poi.signal !== SignalStrength.NONE; 

      const matchesWater = !filterWater || poi.hasWater;
      const matchesRoof = !filterRoof || poi.hasRoof;
      const matchesElectricity = !filterElectricity || poi.hasElectricity;
      const matchesFireplace = !filterFireplace || poi.hasFireplace;

      return matchesType && matchesAltitude && matchesExposure && matchesSignal && matchesWater && matchesRoof && matchesElectricity && matchesFireplace;
    });
  }, [allPois, selectedType, altitudeRange, selectedExposure, filterSignal, filterWater, filterRoof, filterElectricity, filterFireplace]);

  // --- Network Listener ---
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // --- Map Initialization ---
  useEffect(() => {
    if (viewMode === 'map' && mapContainerRef.current && !mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([46.2, 11.4], 9);
      
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);

      mapRef.current = map;

      const onMoveEnd = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // Reduced debounce time for snappier feel (300ms)
        debounceRef.current = setTimeout(() => {
          if (map.getZoom() >= 9) { 
             executeFetch();
          }
        }, 300); 
      };

      map.on('moveend', onMoveEnd);

      if (!isOffline) onMoveEnd();
    }

    if (mapRef.current) {
      const map = mapRef.current;
      const markers = markersRef.current;
      
      const filteredIds = new Set(filteredPois.map(p => p.id));
      markers.forEach((marker, id) => {
        if (!filteredIds.has(id)) {
          map.removeLayer(marker);
          markers.delete(id);
        }
      });

      filteredPois.forEach(poi => {
        const isSelected = selectedPoi?.id === poi.id;
        if (markers.has(poi.id)) {
          const marker = markers.get(poi.id)!;
          marker.setIcon(createCustomIcon(poi.type, isSelected));
          marker.setZIndexOffset(isSelected ? 1000 : 0);
        } else {
          const marker = L.marker([poi.coordinates.lat, poi.coordinates.lng], {
            icon: createCustomIcon(poi.type, isSelected)
          }).addTo(map);
          marker.on('click', () => {
            setSelectedPoi(poi);
            map.flyTo([poi.coordinates.lat, poi.coordinates.lng], map.getZoom(), { duration: 0.5 });
          });
          markers.set(poi.id, marker);
        }
      });
    }

  }, [viewMode, filteredPois, selectedPoi]);

  // --- Map Layers Management ---
  useEffect(() => {
    if (!mapRef.current) return;
    if (baseLayerRef.current) mapRef.current.removeLayer(baseLayerRef.current);
    if (overlayLayerRef.current) mapRef.current.removeLayer(overlayLayerRef.current);

    if (mapStyle === 'standard') {
      baseLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        className: 'dark-tiles'
      }).addTo(mapRef.current);
    } else {
      baseLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19
      }).addTo(mapRef.current);
      overlayLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        zIndex: 50
      }).addTo(mapRef.current);
    }

    if (showPrecipitation) {
      if (!rainLayerRef.current) {
        fetch('https://api.rainviewer.com/public/weather-maps.json')
          .then(res => res.json())
          .then(data => {
            const latest = data.radar?.past?.[data.radar.past.length - 1];
            if (latest && mapRef.current) {
              rainLayerRef.current = L.tileLayer(`https://tile.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.6,
                zIndex: 100
              }).addTo(mapRef.current);
            }
          });
      }
    } else {
      if (rainLayerRef.current) {
        mapRef.current.removeLayer(rainLayerRef.current);
        rainLayerRef.current = null;
      }
    }
    if (rainLayerRef.current) rainLayerRef.current.bringToFront();
  }, [mapStyle, showPrecipitation, viewMode]);


  // --- Gemini API Call ---
  const fetchLiveInfo = async (poi: POI) => {
    if (isOffline) return;
    setIsLoadingLive(true);
    setLiveInfo(null); // Reset previous info immediately to avoid stale data
    const data = await getLiveOutdoorInfo(poi);
    setLiveInfo(data);
    setIsLoadingLive(false);
  };

  useEffect(() => {
    if (selectedPoi && !isOffline) fetchLiveInfo(selectedPoi);
  }, [selectedPoi, isOffline]);

  const resetFilters = () => {
    setSelectedType('All');
    setAltitudeRange({ min: 0, max: 4810 });
    setFilterWater(false);
    setFilterRoof(false);
    setFilterElectricity(false);
    setFilterFireplace(false);
    setFilterSignal(false);
  };

  const daylightInfo = liveInfo?.data?.sunset && liveInfo?.data?.sunrise 
    ? calculateDaylight(liveInfo.data.sunrise, liveInfo.data.sunset) 
    : null;

  return (
    <div className="flex h-screen w-full bg-zinc-950 overflow-hidden text-zinc-200 font-sans">
      
      {/* Sidebar */}
      <aside 
        className={`fixed inset-0 z-[5000] w-full h-full sm:max-w-md ml-auto bg-zinc-900 transition-transform duration-300 ease-in-out flex flex-col border-l border-zinc-800 ${
          isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900 shrink-0">
          <button 
             onClick={() => setIsSidebarOpen(false)} 
             className="flex items-center gap-1 text-zinc-300 hover:text-white transition-colors p-2 rounded-lg hover:bg-zinc-800"
          >
             <ChevronLeft className="w-5 h-5" />
             <span className="text-sm font-medium">Indietro</span>
          </button>
          <h1 className="text-lg font-bold">Filtri</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
           <div className="flex justify-between items-center">
               <h3 className="text-sm font-bold text-zinc-500 uppercase">Impostazioni</h3>
               <button onClick={resetFilters} className="text-xs text-orange-500">Reset</button>
           </div>
           
           <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase">Tipologia</h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setSelectedType('All')} className={`flex-1 px-4 py-3 rounded-lg text-sm border ${selectedType === 'All' ? 'bg-zinc-100 text-black' : 'bg-zinc-800'}`}>Tutti</button>
              <button onClick={() => setSelectedType(POIType.BIVOUAC)} className={`flex-1 px-4 py-3 rounded-lg text-sm border ${selectedType === POIType.BIVOUAC ? 'bg-orange-600 border-orange-600' : 'bg-zinc-800 border-zinc-700'}`}>Bivacchi</button>
              <button onClick={() => setSelectedType(POIType.FOUNTAIN)} className={`flex-1 px-4 py-3 rounded-lg text-sm border ${selectedType === POIType.FOUNTAIN ? 'bg-blue-600 border-blue-600' : 'bg-zinc-800 border-zinc-700'}`}>Fontane</button>
            </div>
           </div>

           <div className="space-y-4">
             <h3 className="text-xs font-bold text-zinc-500 uppercase">Altitudine</h3>
             <input type="range" min="0" max="4810" value={altitudeRange.min} onChange={(e) => setAltitudeRange(prev => ({...prev, min: Number(e.target.value)}))} className="w-full accent-orange-600"/>
             <div className="flex justify-between text-xs text-zinc-400"><span>{altitudeRange.min}m</span><span>4810m</span></div>
           </div>

           {/* Expanded Filters Grid */}
           <div className="space-y-4">
             <h3 className="text-xs font-bold text-zinc-500 uppercase">Servizi & Dotazioni</h3>
             <div className="grid grid-cols-2 gap-3">
               <button onClick={() => setFilterWater(!filterWater)} className={`p-4 border rounded-xl flex flex-col items-center justify-center gap-2 transition-all ${filterWater ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  <Droplets size={20}/> <span className="text-xs">Acqua</span>
               </button>
               <button onClick={() => setFilterRoof(!filterRoof)} className={`p-4 border rounded-xl flex flex-col items-center justify-center gap-2 transition-all ${filterRoof ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  <Home size={20}/> <span className="text-xs">Coperto</span>
               </button>
               <button onClick={() => setFilterElectricity(!filterElectricity)} className={`p-4 border rounded-xl flex flex-col items-center justify-center gap-2 transition-all ${filterElectricity ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  <Zap size={20}/> <span className="text-xs">Elettricità</span>
               </button>
               <button onClick={() => setFilterFireplace(!filterFireplace)} className={`p-4 border rounded-xl flex flex-col items-center justify-center gap-2 transition-all ${filterFireplace ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  <Flame size={20}/> <span className="text-xs">Stufa/Camino</span>
               </button>
               <button onClick={() => setFilterSignal(!filterSignal)} className={`p-4 border rounded-xl flex flex-col items-center justify-center gap-2 col-span-2 transition-all ${filterSignal ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  <SignalHigh size={20}/> <span className="text-xs">Copertura Mobile</span>
               </button>
             </div>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="w-full h-full relative bg-zinc-950 overflow-hidden">
        
        {/* Transparent Header Overlay with Floating Glass Elements - Perfectly Aligned */}
        {/* Row 1: Main Controls */}
        <header className="absolute top-4 left-4 right-4 z-[2000] flex items-center justify-between gap-3 pointer-events-none">
          <button 
             onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
             className="pointer-events-auto w-10 h-10 flex items-center justify-center bg-zinc-900/90 border border-zinc-700/50 rounded-xl text-zinc-300 hover:text-white shadow-lg backdrop-blur-md shrink-0 transition-colors"
           >
             {viewMode === 'list' ? <MapIcon className="w-5 h-5" /> : <List className="w-5 h-5" />}
           </button>

          <form onSubmit={handleGlobalSearch} className="flex-1 max-w-md relative pointer-events-auto h-10 flex items-center">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca su MountPro..."
              className="w-full h-10 bg-zinc-900/90 border border-zinc-700/50 text-zinc-200 text-sm rounded-xl pl-9 pr-4 focus:ring-2 focus:ring-orange-500/50 focus:outline-none transition-all placeholder:text-zinc-500 shadow-lg backdrop-blur-md"
            />
            {isGlobalSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-orange-500" />}
          </form>
          
          <div className="flex items-center gap-2 shrink-0 pointer-events-auto">
            <button onClick={() => setIsSidebarOpen(true)} className="w-10 h-10 flex items-center justify-center bg-zinc-900/90 border border-zinc-700/50 rounded-xl text-zinc-300 hover:text-white shadow-lg backdrop-blur-md transition-colors">
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="w-full h-full overflow-y-auto p-0 scroll-smooth bg-zinc-900">
          {viewMode === 'list' ? (
            <div className="p-6 pt-24 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
               {filteredPois.length > 0 ? filteredPois.map(poi => (
                  <div key={poi.id} onClick={() => setSelectedPoi(poi)} className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl overflow-hidden cursor-pointer hover:border-zinc-500 shadow-xl group transition-colors">
                    <div className="h-44 bg-zinc-800 relative">
                       <img src={poi.imageUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"/>
                       <div className="absolute top-2 right-2 flex gap-1">
                          {poi.hasWater && <div className="bg-blue-600 p-1 rounded-full"><Droplets size={12} color="white"/></div>}
                          {poi.hasRoof && <div className="bg-emerald-600 p-1 rounded-full"><Home size={12} color="white"/></div>}
                          {poi.hasElectricity && <div className="bg-yellow-600 p-1 rounded-full"><Zap size={12} color="white"/></div>}
                       </div>
                    </div>
                    <div className="p-4">
                      <div className="text-[10px] text-orange-500 font-bold uppercase mb-1">{poi.type}</div>
                      <h3 className="font-bold text-lg text-zinc-100">{poi.name}</h3>
                      <div className="flex justify-between mt-3 text-xs text-zinc-400">
                         <span className="flex items-center gap-1"><Mountain size={12}/> {poi.altitude}m</span>
                         <span className="flex items-center gap-1"><Sun size={12}/> {poi.exposure}</span>
                      </div>
                    </div>
                  </div>
               )) : (
                 <div className="col-span-full text-center py-20 text-zinc-500">Nessun risultato.</div>
               )}
            </div>
          ) : (
            <div className="h-full w-full relative group">
               <div ref={mapContainerRef} className="h-full w-full bg-zinc-900" />
               
               {/* --- Row 2: Secondary Controls (Compass, Status, Layers) --- */}
               {/* Positioned at top-16 (64px) which allows gap below the 40px header buttons */}
               <div className="absolute top-16 left-4 right-4 z-[1000] flex justify-between items-start pointer-events-none">
                  {/* Compass */}
                  <div className="pointer-events-auto bg-zinc-900/90 backdrop-blur-md border border-zinc-700/50 w-10 h-10 flex items-center justify-center rounded-xl shadow-lg">
                      <div style={{ transform: `rotate(${-heading}deg)`, transition: 'transform 0.3s ease-out' }}>
                        <Compass className="w-5 h-5 text-orange-500" />
                      </div>
                  </div>

                  {/* Auto-Search Indicator (Centered) */}
                  <div className="pointer-events-auto h-10 flex items-center">
                    {isSearchingArea && (
                      <div className="bg-zinc-900/90 backdrop-blur-md text-white px-4 py-2 rounded-xl shadow-xl font-bold text-xs flex items-center gap-2 border border-zinc-700/50 animate-in fade-in slide-in-from-top-4">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500" />
                        Aggiornamento mappa...
                      </div>
                    )}
                  </div>

                  {/* Layers Control */}
                  <div className="pointer-events-auto relative">
                      <button 
                        onClick={() => setIsLayersMenuOpen(!isLayersMenuOpen)}
                        className="w-10 h-10 bg-zinc-900/90 backdrop-blur-md border border-zinc-700/50 rounded-xl flex items-center justify-center text-white hover:bg-zinc-800 shadow-xl transition-colors"
                      >
                        <Layers className="w-5 h-5" />
                      </button>
                      
                      {isLayersMenuOpen && (
                        <div className="absolute top-12 right-0 w-56 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl shadow-2xl p-3 animate-in fade-in slide-in-from-top-2">
                          <div className="mb-3">
                            <span className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block">Stile Mappa</span>
                            <div className="flex flex-col gap-2">
                              <button onClick={() => setMapStyle('standard')} className={`text-left p-2 rounded text-xs ${mapStyle === 'standard' ? 'bg-orange-900/30 text-orange-400 border border-orange-900/50' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                                <span className="font-bold block">Standard OSM</span>
                                <span className="text-[10px] opacity-70">OpenStreetMap classico</span>
                              </button>
                              <button onClick={() => setMapStyle('satellite')} className={`text-left p-2 rounded text-xs ${mapStyle === 'satellite' ? 'bg-orange-900/30 text-orange-400 border border-orange-900/50' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                                <span className="font-bold block">Satellite Ibrido</span>
                                <span className="text-[10px] opacity-70">Immagini aeree + Sentieri</span>
                              </button>
                            </div>
                          </div>
                          <button onClick={() => setShowPrecipitation(!showPrecipitation)} className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-medium border ${showPrecipitation ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-zinc-950 border-zinc-800 text-zinc-400'}`}>
                              <span className="flex items-center gap-2"><CloudRain className="w-4 h-4" /> Meteo Radar</span>
                              {showPrecipitation && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                          </button>
                        </div>
                      )}
                  </div>
               </div>

            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedPoi && (
          <div className="absolute inset-y-0 right-0 w-full sm:w-[450px] bg-zinc-950 border-l border-zinc-800 shadow-2xl z-[3000] flex flex-col animate-in slide-in-from-right duration-300">
             <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/95 sticky top-0 backdrop-blur-md z-10">
              <button onClick={() => setSelectedPoi(null)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-white">
                <ChevronLeft className="w-5 h-5" /> 
              </button>
              <h3 className="font-bold uppercase tracking-widest text-[10px] text-zinc-500 flex items-center gap-2">
                <Info className="w-3 h-3" /> Scheda Dettaglio
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto hide-scrollbar pb-10">
               <div className="relative h-64">
                 <img src={selectedPoi.imageUrl} className="w-full h-full object-cover" />
                 <div className="absolute bottom-4 left-6">
                   <Badge color="bg-orange-600 text-white border-none mb-2 inline-flex">{selectedPoi.type}</Badge>
                   <h2 className="text-3xl font-bold text-white shadow-black drop-shadow-md">{selectedPoi.name}</h2>
                 </div>
               </div>
               <div className="p-6 space-y-6">
                  {/* Key Stats */}
                  <div className="grid grid-cols-2 gap-3">
                     <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800 flex flex-col">
                       <span className="text-[10px] text-zinc-500 uppercase font-bold">Altitudine</span>
                       <div className="text-lg font-bold flex items-center gap-2 text-white">
                         <Mountain className="w-5 h-5 text-zinc-400" /> 
                         {selectedPoi.altitude > 0 ? `${selectedPoi.altitude}m` : <span className="text-zinc-500 text-sm">Ricerca in corso...</span>}
                       </div>
                     </div>
                     <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800 flex flex-col">
                       <span className="text-[10px] text-zinc-500 uppercase font-bold">Dotazioni</span>
                       <div className="flex gap-2 mt-1">
                          {selectedPoi.hasWater ? <Droplets className="w-5 h-5 text-blue-400" /> : <Droplets className="w-5 h-5 text-zinc-700" />}
                          {selectedPoi.hasRoof ? <Home className="w-5 h-5 text-emerald-400" /> : <Home className="w-5 h-5 text-zinc-700" />}
                          {selectedPoi.hasElectricity ? <Zap className="w-5 h-5 text-yellow-400" /> : <Zap className="w-5 h-5 text-zinc-700" />}
                          {selectedPoi.hasFireplace ? <Flame className="w-5 h-5 text-red-400" /> : <Flame className="w-5 h-5 text-zinc-700" />}
                       </div>
                     </div>
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase mb-2">Descrizione</h4>
                    <p className="text-sm text-zinc-300 leading-relaxed bg-zinc-900/50 p-4 rounded-xl border border-zinc-800">{selectedPoi.description}</p>
                  </div>

                  {/* Connectivity Section (Outside Weather) */}
                  <div>
                      <h4 className="text-xs font-bold text-emerald-500 uppercase mb-2 flex items-center gap-2">
                        <Smartphone className="w-4 h-4"/> Connettività & Rete
                      </h4>
                      <div className="p-5 bg-zinc-900/80 border border-zinc-800 rounded-2xl">
                         {isLoadingLive ? (
                           <div className="text-center text-xs text-zinc-500 py-2">Verifica copertura in corso...</div>
                         ) : liveInfo?.data?.connectivity_info ? (
                             <div className="flex items-center justify-between">
                                 <div>
                                   <div className="text-2xl font-bold text-white flex items-end gap-2">
                                     {liveInfo.data.connectivity_info.type}
                                     <span className="text-xs text-zinc-400 font-normal mb-1">
                                       {liveInfo.data.connectivity_info.description}
                                     </span>
                                   </div>
                                 </div>
                                 <div className="flex flex-col items-center">
                                    {renderSignalIcon(liveInfo.data.connectivity_info.strength)}
                                    <span className="text-[10px] uppercase font-bold text-zinc-500 mt-1">Segnale</span>
                                 </div>
                             </div>
                         ) : (
                           <div className="text-center text-xs text-zinc-500 py-2">Dati non disponibili.</div>
                         )}
                      </div>
                  </div>

                  {/* Gemini Live Info Section (Weather) */}
                  <div className="space-y-4">
                     <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-blue-400 uppercase flex items-center gap-2"><Wind className="w-4 h-4"/> Meteo & Dati Solari</h4>
                        {isLoadingLive && <RefreshCw className="w-3 h-3 animate-spin"/>}
                     </div>
                     <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl overflow-hidden">
                        {isLoadingLive ? <div className="p-8 text-center text-xs text-zinc-500">Analisi in corso...</div> : liveInfo?.data ? (
                           <div className="p-5">
                             <div className="flex justify-between items-center mb-4">
                                <div className="text-3xl font-bold text-white flex items-center gap-2">
                                    <Thermometer className="w-6 h-6 text-orange-500" />
                                    {liveInfo.data.temperature}
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-zinc-500 uppercase">Vento</div>
                                  <div className="text-sm">{liveInfo.data.wind}</div>
                                </div>
                             </div>
                             
                             {/* Daylight Expanded Widget */}
                             {daylightInfo && (
                               <div className="grid grid-cols-2 gap-2 mb-4">
                                  <div className="bg-zinc-800/50 p-3 rounded-lg flex flex-col items-center justify-center">
                                      <div className="flex items-center gap-1 text-amber-500 mb-1">
                                          <Sunrise className="w-4 h-4" /> <span className="text-xs font-bold">Alba</span>
                                      </div>
                                      <span className="text-sm font-mono text-zinc-200">{liveInfo.data.sunrise}</span>
                                  </div>
                                  <div className="bg-zinc-800/50 p-3 rounded-lg flex flex-col items-center justify-center">
                                      <div className="flex items-center gap-1 text-indigo-400 mb-1">
                                          <Sunset className="w-4 h-4" /> <span className="text-xs font-bold">Tramonto</span>
                                      </div>
                                      <span className="text-sm font-mono text-zinc-200">{liveInfo.data.sunset}</span>
                                  </div>
                                  <div className="bg-zinc-800/50 p-3 rounded-lg flex flex-col items-center justify-center col-span-2">
                                      <div className="flex justify-between w-full px-4 text-xs">
                                          <span className="text-zinc-500">Ore totali: <span className="text-zinc-300">{daylightInfo.total}</span></span>
                                          <span className={`${daylightInfo.isDark ? 'text-zinc-600' : 'text-orange-400 font-bold'}`}>
                                              Residuo: {daylightInfo.remaining}
                                          </span>
                                      </div>
                                      <div className="w-full bg-zinc-700 h-1.5 rounded-full mt-2 overflow-hidden">
                                          {!daylightInfo.isDark && (
                                              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-600 w-1/2 animate-pulse"></div>
                                          )}
                                      </div>
                                  </div>
                               </div>
                             )}

                             <p className="text-xs text-zinc-300 italic">"{liveInfo.data.summary}"</p>
                           </div>
                        ) : <div className="p-8 text-center text-xs text-zinc-500">Dati meteo non disponibili.</div>}
                     </div>
                  </div>
                  
                  <div className="space-y-3">
                    <button 
                        onClick={handleNavigation}
                        className="w-full font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white transition-all transform active:scale-95"
                    >
                        <Navigation className="w-5 h-5" /> Avvia Navigazione
                    </button>
                    <button 
                        onClick={handleOpenReviews}
                        className="w-full font-bold py-3 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center gap-2 transition-all"
                    >
                        <ImageIcon className="w-4 h-4 text-blue-400" /> Vedi Foto e Recensioni
                    </button>
                  </div>

               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
