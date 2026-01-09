// ... (imports remain the same)
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, 
  List, 
  Mountain, 
  Droplets, 
  Home, 
  Signal, 
  Sun, 
  Navigation,
  ChevronLeft,
  Info,
  Wind,
  Filter,
  Layers,
  CloudRain,
  Loader2,
  Search,
  Compass,
  ImageIcon,
  Zap,
  Flame,
  Smartphone,
  WifiOff,
  CloudOff,
  Download,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Plus,
  Minus,
  Globe,
  RefreshCw,
  X,
  ThermometerSun,
  Sunrise,
  Sunset,
  ArrowRight,
  Tent,
  Database,
  Heart // Imported Heart icon
} from 'lucide-react';
import L from 'leaflet';
import { POI, POIType, Exposure, SignalStrength } from './types';
import { MOCK_POIS } from './constants';
import { getLiveOutdoorInfo, AIResponse } from './services/geminiService';
import { fetchOsmPois, searchOsmPoisByName } from './services/osmService';
import { dbService } from './services/dbService';

function useOnClickOutside(ref: React.RefObject<HTMLElement>, handler: (event: MouseEvent | TouchEvent) => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

const createCustomIcon = (type: POIType, isSelected: boolean, isFavorite: boolean) => {
  const size = type === POIType.BIVOUAC ? (isSelected ? 44 : 34) : (isSelected ? 48 : 28);
  // If favorite, use a specific color or border, otherwise standard colors
  const baseColor = type === POIType.BIVOUAC ? (isSelected ? '#c2410c' : '#ea580c') : '#3b82f6';
  const color = isFavorite ? '#ef4444' : baseColor; // Red if favorite
  
  return L.divIcon({
    className: 'custom-poi-marker',
    html: `
      <div class="w-full h-full drop-shadow-2xl transition-all duration-300 origin-bottom ${isSelected ? '-translate-y-4 scale-110' : ''}">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
          ${type === POIType.BIVOUAC 
            ? `<path d="M12 2C7.58 2 4 5.58 4 10C4 14.42 12 22 12 22C12 22 20 14.42 20 10C20 5.58 16.42 2 12 2Z" fill="${color}" stroke="white" stroke-width="1.5"/><path d="M8 10.5L12 7L16 10.5V15H8V10.5Z" fill="white"/><rect x="10.5" y="13" width="3" height="3" fill="${color}"/>`
            : `<circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/><path d="M12 18a5 5 0 0 0 5-5c0-1.4-0.7-2.7-2.1-5.1-1.2-1.9-2.1-2.7-2.9-4.5-0.8 1.8-1.7 2.6-2.9 4.5-1.4 2.4-2.1 3.7-2.1 5.1a5 5 0 0 0 5 5z" fill="white"/>`
          }
          ${isFavorite ? `<circle cx="18" cy="6" r="3" fill="#ef4444" stroke="white" stroke-width="1"/>` : ''}
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 5]
  });
};

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('map'); 
  const [liveInfo, setLiveInfo] = useState<AIResponse | null>(null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<'idle' | 'fetching' | 'saving' | 'done'>('idle');
  const [downloadCount, setDownloadCount] = useState(0);

  // Initial state is empty, populated by DB on mount
  const [allPois, setAllPois] = useState<POI[]>([]);
  
  // Favorites State
  const [favorites, setFavorites] = useState<Set<string>>(() => {
     const saved = localStorage.getItem('mountpro_favorites');
     return new Set(saved ? JSON.parse(saved) : []);
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  // Store map state to persist across view changes
  const mapViewState = useRef({ center: { lat: 46.2, lng: 11.4 }, zoom: 9 });

  // Load from DB on start
  useEffect(() => {
    const loadData = async () => {
      try {
        const storedPois = await dbService.getAllPois();
        if (storedPois.length > 0) {
          setAllPois(storedPois);
        }
      } catch (e) {
        console.error("Failed to load from DB", e);
      }
    };
    loadData();
  }, []);

  // Sync state to DB whenever it changes significantly (optional, but good for persistence)
  // We prefer explicit saving, but this helps keep sync
  const saveToDb = async (pois: POI[]) => {
     if (pois.length > 0) {
        await dbService.savePois(pois);
     }
  };

  // Toggle Favorite Function
  const toggleFavorite = async (e: React.MouseEvent, poi: POI) => {
     e.stopPropagation();
     const newFavs = new Set(favorites);
     if (newFavs.has(poi.id)) {
        newFavs.delete(poi.id);
     } else {
        newFavs.add(poi.id);
        // CRITICAL: When favoring, ensure it is saved to Offline DB immediately
        await dbService.savePois([poi]);
     }
     setFavorites(newFavs);
     localStorage.setItem('mountpro_favorites', JSON.stringify([...newFavs]));
  };

  // Expose function for Leaflet Popups
  useEffect(() => {
    (window as any).openMountProDetails = (id: string) => {
      const p = allPois.find(item => item.id === id);
      if (p) {
        setSelectedPoi(p);
        setIsDetailPanelOpen(true);
      }
    };
  }, [allPois]);

  const [isSearchingArea, setIsSearchingArea] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite'>('standard');
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);
  
  // Filters - Default to BIVOUAC
  const [selectedType, setSelectedType] = useState<POIType | 'All'>(POIType.BIVOUAC);
  const [minAltitude, setMinAltitude] = useState(0);
  const [maxAltitude, setMaxAltitude] = useState(4810);
  const [selectedExposures, setSelectedExposures] = useState<Exposure[]>([]); 
  const [filterWater, setFilterWater] = useState(false);
  const [filterRoof, setFilterRoof] = useState(false);
  
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  
  const layersMenuRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // Refs for callbacks
  const isOfflineRef = useRef(isOffline);
  const selectedTypeRef = useRef(selectedType);

  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);
  useEffect(() => { selectedTypeRef.current = selectedType; }, [selectedType]);

  useOnClickOutside(layersMenuRef, () => setIsLayersMenuOpen(false));
  useOnClickOutside(sidebarContentRef, () => setIsSidebarOpen(false));
  useOnClickOutside(detailPanelRef, () => setIsDetailPanelOpen(false));

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

  // Fetch Live Info when POI is selected
  useEffect(() => {
    if (selectedPoi && isDetailPanelOpen && !isOffline) {
      setLiveInfo(null);
      setIsLoadingLive(true);
      getLiveOutdoorInfo(selectedPoi).then(data => {
        setLiveInfo(data);
        setIsLoadingLive(false);
      });
    } else {
      setLiveInfo(null);
    }
  }, [selectedPoi, isDetailPanelOpen, isOffline]);

  const downloadMapArea = async () => {
    if (!mapRef.current || isOffline) return;
    
    setIsDownloading(true);
    setDownloadProgress('fetching');
    setDownloadCount(0);

    const b = mapRef.current.getBounds();
    
    try {
      // 1. Fetch ALL types for the area, not just the selected filter
      const newPois = await fetchOsmPois({ 
        south: b.getSouth(), 
        west: b.getWest(), 
        north: b.getNorth(), 
        east: b.getEast() 
      }, 'All'); // Force 'All' to download everything in view

      setDownloadCount(newPois.length);
      setDownloadProgress('saving');

      // 2. Save to IndexedDB
      await dbService.savePois(newPois);

      // 3. Update State (Merge with existing)
      setAllPois(prev => {
        const ids = new Set(prev.map(p => p.id));
        const merged = [...prev, ...newPois.filter(p => !ids.has(p.id))];
        return merged;
      });

      setDownloadProgress('done');
      setTimeout(() => {
         setIsDownloading(false);
         setDownloadProgress('idle');
         setIsLayersMenuOpen(false);
      }, 2000);

    } catch (e) {
      console.error("Download failed", e);
      setIsDownloading(false);
      setDownloadProgress('idle');
      alert("Errore durante il download dell'area.");
    }
  };

  const handleGlobalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;

    if (isOffline) {
      const localResults = allPois.filter(p => p.name.toLowerCase().includes(query));
      if (localResults.length > 0) {
        setSelectedPoi(localResults[0]);
        setIsDetailPanelOpen(true);
        if (mapRef.current) mapRef.current.flyTo([localResults[0].coordinates.lat, localResults[0].coordinates.lng], 15);
      }
      return;
    }

    setIsGlobalSearching(true);
    const results = await searchOsmPoisByName(searchQuery);
    if (results.length > 0) {
      setAllPois(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const combined = [...prev, ...results.filter(p => !existingIds.has(p.id))];
        saveToDb(combined); // Persist search results
        return combined;
      });
      setSelectedPoi(results[0]);
      setIsDetailPanelOpen(true);
      if (mapRef.current) mapRef.current.flyTo([results[0].coordinates.lat, results[0].coordinates.lng], 16);
    }
    setIsGlobalSearching(false);
  };

  const filteredPois = useMemo(() => {
    return allPois.filter(p => {
      // Favorites Filter
      if (showFavoritesOnly && !favorites.has(p.id)) return false;

      const t = selectedType === 'All' || p.type === selectedType;
      const a = p.altitude >= minAltitude && p.altitude <= maxAltitude;
      const e = selectedExposures.length === 0 || selectedExposures.includes(p.exposure);
      const w = !filterWater || p.hasWater;
      const r = !filterRoof || p.hasRoof;
      return t && a && e && w && r;
    });
  }, [allPois, selectedType, minAltitude, maxAltitude, selectedExposures, filterWater, filterRoof, showFavoritesOnly, favorites]);

  const executeFetch = async () => {
    if (!mapRef.current || isOfflineRef.current) return;
    setIsSearchingArea(true);
    const b = mapRef.current.getBounds();
    try {
      const newPois = await fetchOsmPois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, selectedTypeRef.current);
      setAllPois(prev => {
        const ids = new Set(prev.map(p => p.id));
        const merged = [...prev, ...newPois.filter(p => !ids.has(p.id))];
        saveToDb(merged); 
        return merged;
      });
    } finally { setIsSearchingArea(false); }
  };

  // Map Init
  useEffect(() => {
    if (viewMode === 'map' && mapContainerRef.current) {
      if (mapRef.current) return; 

      const { center, zoom } = mapViewState.current;

      const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([center.lat, center.lng], zoom);
      mapRef.current = map;
      
      L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map);

      map.on('moveend', () => {
        const c = map.getCenter();
        mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() };
        if (!isOfflineRef.current) executeFetch();
      });

      // Initial fetch if online, otherwise we already loaded DB data in the top useEffect
      if (!isOfflineRef.current) executeFetch();
    }

    return () => {
      if (mapRef.current) {
        // Save state one last time before destruction (though moveend usually catches it)
        const c = mapRef.current.getCenter();
        mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: mapRef.current.getZoom() };
        
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current.clear();
      }
    };
  }, [viewMode]);

  // Map Style
  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapRef.current?.removeLayer(layer);
      }
    });

    if (mapStyle === 'satellite') {
      // 1. Base Layer: World Imagery (Satellite)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        maxZoom: 19, 
        attribution: 'Esri' 
      }).addTo(mapRef.current);

      // 2. Overlay Layer: World Transportation (Roads & Streets)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }).addTo(mapRef.current);

      // 3. Overlay Layer: World Boundaries and Places (Cities, Labels, Points)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }).addTo(mapRef.current);

      // Removed container class manipulation to avoid flipping marker/popup colors
    } else {
      // className 'dark-tiles' is applied ONLY to the tile layer images by Leaflet
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'dark-tiles', maxZoom: 19 }).addTo(mapRef.current);
      // Removed L.DomUtil.addClass(mapRef.current.getContainer(), 'dark-tiles'); which was inverting the whole map
    }
  }, [mapStyle, viewMode]);

  // Markers
  useEffect(() => {
    if (viewMode === 'map' && mapRef.current) {
      const map = mapRef.current;
      const markers = markersRef.current;
      const filteredIds = new Set(filteredPois.map(p => p.id));
      
      markers.forEach((marker, id) => {
        if (!filteredIds.has(id)) { map.removeLayer(marker); markers.delete(id); }
      });

      filteredPois.forEach(poi => {
        const isSelected = selectedPoi?.id === poi.id;
        const isFav = favorites.has(poi.id);
        
        const popupContent = `
          <div class="px-3 py-2 min-w-[160px] text-zinc-100 font-sans">
            <h4 class="font-bold text-sm mb-0.5 pr-4">${poi.name} ${isFav ? '❤️' : ''}</h4>
            <div class="flex items-center gap-2 text-[11px] text-zinc-400 mb-2">
              <span class="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 border border-zinc-700">${poi.altitude}m</span>
              <span>${poi.type}</span>
            </div>
            <button onclick="window.openMountProDetails('${poi.id}')" class="w-full bg-orange-600 hover:bg-orange-700 transition-colors py-1.5 rounded-md font-bold text-[11px] text-white">
              Vedi Dettagli
            </button>
          </div>
        `;
        
        if (markers.has(poi.id)) {
          const m = markers.get(poi.id)!;
          m.setIcon(createCustomIcon(poi.type, isSelected, isFav));
          m.setZIndexOffset(isSelected ? 1000 : (isFav ? 500 : 0));
        } else {
          const m = L.marker([poi.coordinates.lat, poi.coordinates.lng], { icon: createCustomIcon(poi.type, isSelected, isFav) }).addTo(map);
          m.bindPopup(popupContent, { closeButton: false, offset: [0, -12] });
          m.on('click', () => { 
             setIsDetailPanelOpen(false);
             setSelectedPoi(poi); 
          });
          markers.set(poi.id, m);
        }
      });
    }
  }, [filteredPois, selectedPoi, viewMode, favorites]);

  const toggleExposure = (exp: Exposure) => {
    setSelectedExposures(prev => prev.includes(exp) ? prev.filter(e => e !== exp) : [...prev, exp]);
  };

  const handleZoomIn = () => { mapRef.current?.zoomIn(); };
  const handleZoomOut = () => { mapRef.current?.zoomOut(); };

  const handleShowOnMap = () => {
    if (!selectedPoi) return;
    
    // Update map state to focus on POI
    mapViewState.current = { 
       center: { lat: selectedPoi.coordinates.lat, lng: selectedPoi.coordinates.lng }, 
       zoom: 16 
    };

    if (viewMode === 'list') {
       setViewMode('map');
    } else {
       // If already in map view, fly to it
       mapRef.current?.flyTo([selectedPoi.coordinates.lat, selectedPoi.coordinates.lng], 16);
    }
    
    setIsDetailPanelOpen(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-200 overflow-hidden font-sans relative">
      <style>{`
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background-color: #18181b !important;
          color: #e4e4e7 !important;
          border: 1px solid #3f3f46;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 12px !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          line-height: 1.5;
        }
        .leaflet-container a.leaflet-popup-close-button {
          color: #a1a1aa !important;
          font-size: 18px !important;
          padding: 8px !important;
        }
        .leaflet-container a.leaflet-popup-close-button:hover {
          color: #fff !important;
        }
        
        /* Force Touch Scroll on iOS */
        .touch-scroll {
           -webkit-overflow-scrolling: touch;
        }
      `}</style>

      {/* FILTER SIDEBAR */}
      <aside className={`fixed inset-0 z-[5000] transition-transform duration-300 pointer-events-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div ref={sidebarContentRef} className="h-full w-full max-w-sm mr-auto bg-zinc-900 border-r border-zinc-800 pointer-events-auto flex flex-col shadow-2xl">
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur">
            <h2 className="font-bold text-lg flex items-center gap-2"><Filter size={18} className="text-orange-500"/> Filtri</h2>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            
            <section>
              <button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${showFavoritesOnly ? 'bg-red-900/30 border-red-500' : 'bg-zinc-800 border-zinc-700'}`}>
                 <span className="flex items-center gap-3 font-bold text-sm"><Heart size={18} className={showFavoritesOnly ? "text-red-500 fill-red-500" : "text-zinc-400"}/> Solo i miei Preferiti</span>
                 <div className={`w-10 h-5 rounded-full relative transition-colors ${showFavoritesOnly ? 'bg-red-500' : 'bg-zinc-600'}`}>
                       <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showFavoritesOnly ? 'left-6' : 'left-1'}`}/>
                 </div>
              </button>
            </section>

            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4 tracking-wider">Tipologia</h3>
              <div className="grid grid-cols-2 gap-2">
                {['All', POIType.BIVOUAC, POIType.FOUNTAIN].map(t => (
                  <button key={t} onClick={() => setSelectedType(t as any)} className={`py-2 px-3 text-xs font-medium rounded-lg border transition-all ${selectedType === t ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>{t === 'All' ? 'Tutti' : t}</button>
                ))}
              </div>
            </section>
            
            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4 tracking-wider">Altitudine (m)</h3>
              <div className="space-y-4 px-2">
                 <div className="flex justify-between text-xs font-mono text-zinc-300">
                    <span>{minAltitude}m</span>
                    <span>{maxAltitude}m</span>
                 </div>
                 <div className="space-y-4">
                    <input type="range" min="0" max="4810" value={maxAltitude} onChange={(e) => setMaxAltitude(Number(e.target.value))} className="accent-orange-500 w-full"/>
                 </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4 tracking-wider">Caratteristiche</h3>
              <div className="space-y-3">
                 <button onClick={() => setFilterWater(!filterWater)} className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${filterWater ? 'bg-blue-900/30 border-blue-500' : 'bg-zinc-800 border-zinc-700'}`}>
                    <span className="flex items-center gap-2 text-sm"><Droplets size={16} className={filterWater ? "text-blue-400" : "text-zinc-500"}/> Acqua presente</span>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${filterWater ? 'bg-blue-500' : 'bg-zinc-600'}`}>
                       <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${filterWater ? 'left-6' : 'left-1'}`}/>
                    </div>
                 </button>
                 <button onClick={() => setFilterRoof(!filterRoof)} className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${filterRoof ? 'bg-orange-900/30 border-orange-500' : 'bg-zinc-800 border-zinc-700'}`}>
                    <span className="flex items-center gap-2 text-sm"><Home size={16} className={filterRoof ? "text-orange-400" : "text-zinc-500"}/> Struttura chiusa</span>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${filterRoof ? 'bg-orange-500' : 'bg-zinc-600'}`}>
                       <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${filterRoof ? 'left-6' : 'left-1'}`}/>
                    </div>
                 </button>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4 tracking-wider">Esposizione</h3>
              <div className="grid grid-cols-4 gap-2">
                {[Exposure.NORTH, Exposure.SOUTH, Exposure.EAST, Exposure.WEST].map(e => (
                  <button key={e} onClick={() => toggleExposure(e)} className={`py-2 text-[10px] font-bold rounded-lg border uppercase ${selectedExposures.includes(e) ? 'bg-zinc-200 text-zinc-900 border-white' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>{e.substring(0, 1)}</button>
                ))}
              </div>
            </section>

             <section>
               <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4 tracking-wider">Gestione Dati</h3>
               <button onClick={async () => {
                  if(confirm("Sei sicuro di voler cancellare tutti i dati salvati?")) {
                     await dbService.clearAll();
                     setAllPois([]);
                     alert("Database svuotato.");
                  }
               }} className="w-full py-2 bg-red-900/30 border border-red-800 text-red-400 rounded-lg text-xs font-bold hover:bg-red-900/50">
                  Svuota Database Locale
               </button>
            </section>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 relative h-full w-full">
        {/* NEW HEADER DESIGN - Solid Colors, No Transparency */}
        <header className="absolute top-4 left-4 right-4 z-[2000] flex flex-col gap-3 pointer-events-none">
          <div className="flex items-center gap-2 w-full max-w-lg mx-auto pointer-events-auto">
             
             {/* LEFT: View Mode Toggle */}
             <button onClick={() => setViewMode(v => v === 'list' ? 'map' : 'list')} className="w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center shadow-xl text-zinc-300 hover:text-white transition-all shrink-0">
                {viewMode === 'list' ? <MapIcon size={20}/> : <List size={20}/>}
             </button>

             {/* CENTER: Search Bar - Removed transparency */}
             <div className="flex-1 relative shadow-xl">
               <form onSubmit={handleGlobalSearch} className="w-full relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400"/>
                 <input 
                   type="text" 
                   value={searchQuery} 
                   onChange={e => setSearchQuery(e.target.value)} 
                   placeholder={isOffline ? "Cerca offline..." : "Cerca..."} 
                   className="w-full h-11 bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-10 text-sm focus:ring-2 focus:ring-orange-500 outline-none text-zinc-200 placeholder:text-zinc-500 transition-all"
                 />
                 {isOffline && <WifiOff className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500"/>}
               </form>
             </div>
             
             {/* RIGHT: Filter Button */}
             <button onClick={() => setIsSidebarOpen(true)} className={`w-11 h-11 bg-zinc-900 border rounded-xl flex items-center justify-center shadow-xl transition-all shrink-0 ${selectedType !== 'All' || minAltitude > 0 || maxAltitude < 4810 || filterWater || filterRoof || showFavoritesOnly ? 'border-orange-500 text-orange-500' : 'border-zinc-800 text-zinc-300 hover:text-white'}`}>
                <Filter size={18}/>
             </button>
          </div>
          
          {/* Active Filter Chips - Solid colors */}
          {(selectedType !== 'All' || filterWater || filterRoof || showFavoritesOnly) && (
            <div className="flex justify-center gap-2 animate-in fade-in slide-in-from-top-2 pointer-events-auto">
               {showFavoritesOnly && (
                 <span className="px-3 py-1 bg-red-600 shadow-md rounded-full text-[10px] font-bold text-white border border-red-500 flex items-center gap-1">
                   <Heart size={10} className="fill-white"/> Preferiti
                 </span>
               )}
               {selectedType !== 'All' && (
                 <span className="px-3 py-1 bg-orange-600 shadow-md rounded-full text-[10px] font-bold text-white border border-orange-500 flex items-center gap-1">
                   <Tent size={10}/> {selectedType}
                 </span>
               )}
               {filterWater && <span className="px-3 py-1 bg-blue-600 shadow-md rounded-full text-[10px] font-bold text-white border border-blue-500">Acqua</span>}
               {filterRoof && <span className="px-3 py-1 bg-zinc-700 shadow-md rounded-full text-[10px] font-bold text-white border border-zinc-600">Chiuso</span>}
            </div>
          )}
        </header>

        {viewMode === 'list' ? (
          <div className="h-full w-full bg-zinc-950 overflow-y-auto touch-scroll">
            <div className="pt-32 px-6 pb-40 min-h-full">
              {filteredPois.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredPois.map(p => (
                    <div key={p.id} onClick={() => { setSelectedPoi(p); setIsDetailPanelOpen(true); }} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-600 transition-all cursor-pointer group shadow-lg relative">
                      <div className="h-40 w-full overflow-hidden relative">
                        <img src={p.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy"/>
                        <div className="absolute top-2 right-2 flex gap-2">
                           <button onClick={(e) => toggleFavorite(e, p)} className={`w-7 h-7 flex items-center justify-center rounded-full backdrop-blur border transition-all ${favorites.has(p.id) ? 'bg-red-500/90 text-white border-red-400' : 'bg-black/40 text-white border-white/20 hover:bg-black/60'}`}>
                              <Heart size={14} className={favorites.has(p.id) ? "fill-white" : ""}/>
                           </button>
                           <div className="bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] font-bold border border-white/10 text-white">{p.type}</div>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="flex justify-between items-start">
                            <h4 className="font-bold text-zinc-100">{p.name}</h4>
                            <span className="text-orange-500 font-mono text-xs">{p.altitude}m</span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{p.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                  {showFavoritesOnly ? <Heart size={48} className="mb-4 text-zinc-700"/> : <Tent size={48} className="mb-4 text-zinc-700"/>}
                  <p className="text-sm font-medium">Nessun punto di interesse trovato.</p>
                  <p className="text-xs mt-2">{showFavoritesOnly ? "Non hai ancora aggiunto preferiti." : "Prova a cambiare filtri o zoomare sulla mappa."}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full relative">
             <div ref={mapContainerRef} className="w-full h-full"/>
          </div>
        )}

        {/* STATUS BAR */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[4000] flex flex-col items-center gap-2 pointer-events-none">
           {isSearchingArea && (
              <div className="bg-zinc-900 border border-zinc-800 text-zinc-200 px-4 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-wider flex items-center gap-2 shadow-lg animate-in slide-in-from-bottom-2 fade-in">
                <RefreshCw size={12} className="animate-spin text-orange-500"/>
                Ricerca in area...
              </div>
           )}
           <div className={`pointer-events-auto px-5 py-2.5 rounded-full border shadow-2xl flex items-center gap-3 transition-colors ${isOffline ? 'bg-orange-950 border-orange-500' : 'bg-zinc-900 border-zinc-800'}`}>
              <div className={`w-2.5 h-2.5 rounded-full ${isOffline ? 'bg-orange-500' : 'bg-emerald-500 status-dot-pulse'}`}/>
              <span className={`text-xs font-bold ${isOffline ? 'text-orange-200' : 'text-zinc-300'}`}>
                {isOffline ? 'Offline Mode' : 'Online'}
              </span>
           </div>
        </div>

        {/* CONTROLS */}
        {viewMode === 'map' && (
          <div className="absolute bottom-6 right-4 z-[1000] flex flex-col items-end gap-3 pointer-events-auto">
            <div ref={layersMenuRef} className="relative">
               {isLayersMenuOpen && (
                <div className="absolute bottom-full right-0 mb-4 w-72 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-right-4">
                  <h4 className="text-[10px] font-bold uppercase text-zinc-500 mb-3 tracking-wider">Tipo Mappa</h4>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button onClick={() => setMapStyle('standard')} className={`relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all ${mapStyle === 'standard' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}>
                      <div className="w-full h-16 rounded-lg bg-zinc-700 relative overflow-hidden border border-zinc-600">
                        <div className="absolute top-1/2 left-0 w-full h-1.5 bg-zinc-500 -rotate-12"></div>
                        <div className="absolute top-0 right-1/2 h-full w-1.5 bg-zinc-500 -rotate-12"></div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase ${mapStyle === 'standard' ? 'text-orange-500' : 'text-zinc-400'}`}>Standard</span>
                    </button>
                    <button onClick={() => setMapStyle('satellite')} className={`relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all ${mapStyle === 'satellite' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}>
                      <div className="w-full h-16 rounded-lg bg-emerald-900 relative overflow-hidden border border-zinc-600">
                         <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 to-amber-950 opacity-80"></div>
                         <div className="absolute top-2 right-2 w-full h-full border-t-2 border-r-2 border-white/10 rounded-full"></div>
                         <div className="absolute bottom-2 left-2 text-[8px] text-white/50 font-mono">HYBRID</div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase ${mapStyle === 'satellite' ? 'text-orange-500' : 'text-zinc-400'}`}>Satellite</span>
                    </button>
                  </div>
                  <div className="h-px bg-zinc-800 my-2" />
                  <button disabled={isOffline || isDownloading} onClick={downloadMapArea} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-zinc-200 transition-all border border-zinc-700">
                    {isDownloading ? 
                      (
                        downloadProgress === 'fetching' ? 
                          <><Loader2 size={14} className="animate-spin text-orange-500"/> Scarico dati...</> :
                        downloadProgress === 'saving' ?
                          <><Database size={14} className="animate-pulse text-emerald-500"/> Salvo {downloadCount} Punti...</> :
                          <><CheckCircle2 size={14} className="text-emerald-500"/> Completato!</>
                      )
                      : <><Download size={14}/> Scarica Area Offline</>
                    }
                  </button>
                </div>
              )}
              <button onClick={() => setIsLayersMenuOpen(!isLayersMenuOpen)} className={`w-12 h-12 bg-zinc-900 border ${isLayersMenuOpen ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all`}>
                <Layers size={22}/>
              </button>
            </div>
            <div className="flex flex-col rounded-2xl overflow-hidden shadow-lg border border-zinc-700 bg-zinc-900">
              <button onClick={handleZoomIn} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200 border-b border-zinc-800"><Plus size={24} /></button>
              <button onClick={handleZoomOut} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200"><Minus size={24} /></button>
            </div>
          </div>
        )}
      </main>

      {/* DETAIL PANEL OVERLAY */}
      <div ref={detailPanelRef} className={`fixed inset-y-0 right-0 z-[6000] w-full md:w-[450px] bg-zinc-900 border-l border-zinc-800 shadow-2xl transition-transform duration-300 ${isDetailPanelOpen && selectedPoi ? 'translate-x-0' : 'translate-x-full'}`}>
          {selectedPoi && (
            <div className="h-full flex flex-col relative">
             <div className="absolute top-4 right-4 z-10 flex gap-2">
                 <button onClick={(e) => toggleFavorite(e, selectedPoi)} className={`w-8 h-8 flex items-center justify-center rounded-full backdrop-blur border transition-all ${favorites.has(selectedPoi.id) ? 'bg-red-500/90 text-white border-red-400' : 'bg-black/40 text-white border-white/20 hover:bg-black/60'}`}>
                    <Heart size={16} className={favorites.has(selectedPoi.id) ? "fill-white" : ""}/>
                 </button>
                 <button onClick={() => setIsDetailPanelOpen(false)} className="w-8 h-8 flex items-center justify-center bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors backdrop-blur border border-white/10"><X size={18}/></button>
             </div>
             
             {/* Header Image */}
             <div className="h-64 relative shrink-0">
               <img src={selectedPoi.imageUrl} className="w-full h-full object-cover"/>
               <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent"></div>
               <div className="absolute bottom-4 left-6">
                 <div className="flex gap-2 mb-2">
                    <span className="bg-orange-600 px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wide">{selectedPoi.type}</span>
                    <span className="bg-zinc-800/80 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-zinc-300 border border-zinc-700">{selectedPoi.altitude}m</span>
                 </div>
                 <h2 className="text-2xl font-bold text-white leading-tight">{selectedPoi.name}</h2>
               </div>
             </div>

             <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* AI Status Card */}
                {!isOffline && (
                   <div className="bg-zinc-800/50 rounded-2xl p-4 border border-zinc-700/50">
                     <div className="flex items-center gap-2 mb-3">
                        <Zap size={16} className="text-orange-500 fill-orange-500"/>
                        <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Analisi AI Live</h3>
                     </div>
                     {isLoadingLive ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin"/> Analisi meteo e segnale in corso...</div>
                     ) : liveInfo?.data ? (
                        <div className="space-y-4">
                           <div className="grid grid-cols-2 gap-3">
                              <div className="bg-zinc-900/50 rounded-xl p-3 flex items-center gap-3">
                                 <ThermometerSun className="text-yellow-500" size={20}/>
                                 <div>
                                    <div className="text-sm font-bold text-white">{liveInfo.data.temperature}</div>
                                    <div className="text-[10px] text-zinc-500">{liveInfo.data.condition}</div>
                                 </div>
                              </div>
                              <div className="bg-zinc-900/50 rounded-xl p-3 flex items-center gap-3">
                                 <Wind className="text-blue-400" size={20}/>
                                 <div>
                                    <div className="text-sm font-bold text-white text-ellipsis overflow-hidden whitespace-nowrap">{liveInfo.data.wind.split(' ')[0]}</div>
                                    <div className="text-[10px] text-zinc-500">Vento</div>
                                 </div>
                              </div>
                           </div>
                           
                           <div className="bg-zinc-900/50 rounded-xl p-3 flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <Sunrise size={16} className="text-orange-300"/>
                                <span className="text-xs font-mono">{liveInfo.data.sunrise}</span>
                              </div>
                              <div className="w-px h-4 bg-zinc-700"></div>
                              <div className="flex items-center gap-2">
                                <Sunset size={16} className="text-purple-300"/>
                                <span className="text-xs font-mono">{liveInfo.data.sunset}</span>
                              </div>
                           </div>

                           <div className="border-t border-zinc-700/50 pt-3">
                              <div className="flex items-start gap-2">
                                 <Signal size={16} className={liveInfo.data.connectivity_info.strength > 0 ? "text-emerald-500" : "text-red-500"}/>
                                 <div>
                                    <div className="text-xs font-bold text-zinc-200">{liveInfo.data.connectivity_info.type} - {liveInfo.data.connectivity_info.description}</div>
                                    <div className="text-[10px] text-zinc-500 mt-0.5">Stima copertura cellulare</div>
                                 </div>
                              </div>
                           </div>

                           <p className="text-xs text-zinc-400 italic bg-zinc-900/30 p-2 rounded border-l-2 border-orange-500">
                             "{liveInfo.data.summary}"
                           </p>
                        </div>
                     ) : (
                        <div className="text-xs text-zinc-500">Impossibile recuperare dati live.</div>
                     )}
                   </div>
                )}

                {/* Main Info */}
                <div className="space-y-4">
                   <h3 className="text-sm font-bold text-white">Informazioni</h3>
                   <p className="text-sm text-zinc-400 leading-relaxed">{selectedPoi.description}</p>
                   
                   <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
                         {selectedPoi.hasWater ? <CheckCircle2 className="text-emerald-500" size={18}/> : <X className="text-red-500" size={18}/>}
                         <span className="text-xs text-zinc-300">Acqua Potabile</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
                         {selectedPoi.hasRoof ? <CheckCircle2 className="text-emerald-500" size={18}/> : <X className="text-red-500" size={18}/>}
                         <span className="text-xs text-zinc-300">Struttura Chiusa</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
                         {selectedPoi.hasFireplace ? <CheckCircle2 className="text-emerald-500" size={18}/> : <X className="text-red-500" size={18}/>}
                         <span className="text-xs text-zinc-300">Stufa/Fuoco</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
                         <Compass className="text-zinc-400" size={18}/>
                         <span className="text-xs text-zinc-300">Esposizione {selectedPoi.exposure}</span>
                      </div>
                   </div>
                </div>

             </div>

             <div className="p-4 border-t border-zinc-800 bg-zinc-900 pb-8 space-y-3">
               <button onClick={handleShowOnMap} className="w-full py-3 bg-zinc-800 text-zinc-300 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-700 transition-colors border border-zinc-700">
                  <MapIcon size={18}/> Vedi in Mappa
               </button>
               <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.coordinates.lat},${selectedPoi.coordinates.lng}`)} className="w-full py-3.5 bg-orange-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-700 transition-colors shadow-lg shadow-orange-900/20">
                  <Navigation size={18}/> Naviga verso {selectedPoi.name}
               </button>
             </div>
            </div>
          )}
      </div>
    </div>
  );
}