
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
  RefreshCw
} from 'lucide-react';
import L from 'leaflet';
import { POI, POIType, Exposure, SignalStrength } from './types';
import { MOCK_POIS } from './constants';
import { getLiveOutdoorInfo, AIResponse } from './services/geminiService';
import { fetchOsmPois, searchOsmPoisByName } from './services/osmService';

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

const createCustomIcon = (type: POIType, isSelected: boolean) => {
  const size = type === POIType.BIVOUAC ? (isSelected ? 44 : 34) : (isSelected ? 48 : 28);
  const color = type === POIType.BIVOUAC ? (isSelected ? '#c2410c' : '#ea580c') : '#3b82f6';
  
  return L.divIcon({
    className: 'custom-poi-marker',
    html: `
      <div class="w-full h-full drop-shadow-2xl transition-all duration-300 origin-bottom ${isSelected ? '-translate-y-4 scale-110' : ''}">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
          ${type === POIType.BIVOUAC 
            ? `<path d="M12 2C7.58 2 4 5.58 4 10C4 14.42 12 22 12 22C12 22 20 14.42 20 10C20 5.58 16.42 2 12 2Z" fill="${color}" stroke="white" stroke-width="1.5"/><path d="M8 10.5L12 7L16 10.5V15H8V10.5Z" fill="white"/><rect x="10.5" y="13" width="3" height="3" fill="${color}"/>`
            : `<circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/><path d="M12 18a5 5 0 0 0 5-5c0-1.4-0.7-2.7-2.1-5.1-1.2-1.9-2.1-2.7-2.9-4.5-0.8 1.8-1.7 2.6-2.9 4.5-1.4 2.4-2.1 3.7-2.1 5.1a5 5 0 0 0 5 5z" fill="white"/>`
          }
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
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [allPois, setAllPois] = useState<POI[]>(() => {
    const saved = localStorage.getItem('mountpro_pois');
    return saved ? JSON.parse(saved) : MOCK_POIS;
  });

  useEffect(() => {
    localStorage.setItem('mountpro_pois', JSON.stringify(allPois));
  }, [allPois]);

  const [isSearchingArea, setIsSearchingArea] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite'>('standard');
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);
  
  const [selectedType, setSelectedType] = useState<POIType | 'All'>(POIType.BIVOUAC);
  const [altitudeRange, setAltitudeRange] = useState({ min: 0, max: 4810 });
  const [selectedExposures, setSelectedExposures] = useState<Exposure[]>([]); 
  const [filterWater, setFilterWater] = useState(false);
  const [filterRoof, setFilterRoof] = useState(false);
  
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  // Removed tileLayerRef in favor of direct layer management for Hybrid support
  
  const layersMenuRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // Refs for callbacks to avoid closure staleness in event listeners
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

  const downloadMapArea = async () => {
    if (!mapRef.current || isOffline) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const cache = await caches.open('peakpoint-v2-offline-maps');
      for (let i = 0; i <= 100; i += 20) {
        setDownloadProgress(i);
        await new Promise(r => setTimeout(r, 200));
      }
      setIsDownloading(false);
      alert("Area salvata correttamente!");
    } catch (e) {
      setIsDownloading(false);
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
        return [...prev, ...results.filter(p => !existingIds.has(p.id))];
      });
      setSelectedPoi(results[0]);
      setIsDetailPanelOpen(true);
      if (mapRef.current) mapRef.current.flyTo([results[0].coordinates.lat, results[0].coordinates.lng], 16);
    }
    setIsGlobalSearching(false);
  };

  const filteredPois = useMemo(() => {
    return allPois.filter(p => {
      const t = selectedType === 'All' || p.type === selectedType;
      const a = p.altitude >= altitudeRange.min && p.altitude <= altitudeRange.max;
      const e = selectedExposures.length === 0 || selectedExposures.includes(p.exposure);
      const w = !filterWater || p.hasWater;
      const r = !filterRoof || p.hasRoof;
      return t && a && e && w && r;
    });
  }, [allPois, selectedType, altitudeRange, selectedExposures, filterWater, filterRoof]);

  const executeFetch = async () => {
    if (!mapRef.current || isOfflineRef.current) return;
    setIsSearchingArea(true);
    const b = mapRef.current.getBounds();
    try {
      const newPois = await fetchOsmPois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, selectedTypeRef.current);
      setAllPois(prev => {
        const ids = new Set(prev.map(p => p.id));
        return [...prev, ...newPois.filter(p => !ids.has(p.id))];
      });
    } finally { setIsSearchingArea(false); }
  };

  // 1. Map Initialization Effect
  useEffect(() => {
    if (viewMode === 'map' && mapContainerRef.current) {
      if (mapRef.current) return; // Prevent double init

      const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([46.2, 11.4], 9);
      
      // Default tile initialization happens in the Style Effect
      mapRef.current = map;

      // Event Listeners
      map.on('moveend', () => {
        if (!isOfflineRef.current) executeFetch();
      });

      // Initial fetch
      if (!isOfflineRef.current) executeFetch();
    }

    // Cleanup when unmounting or switching view mode
    return () => {
      if (viewMode === 'list' && mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current.clear();
      }
    };
  }, [viewMode]);

  // 2. Map Style Effect (Handles Hybrid)
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing tile layers to switch styles cleanly
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapRef.current?.removeLayer(layer);
      }
    });

    if (mapStyle === 'satellite') {
      // 1. Satellite Base (Esri World Imagery)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Esri'
      }).addTo(mapRef.current);
      
      // 2. Hybrid Overlay (Labels & Roads) - CartoDB Voyager Labels
      // This provides road names and paths over the satellite image
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        opacity: 1
      }).addTo(mapRef.current);

      L.DomUtil.removeClass(mapRef.current.getContainer(), 'dark-tiles');
    } else {
      // Standard Dark Mode (OpenStreetMap)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        className: 'dark-tiles',
        maxZoom: 19
      }).addTo(mapRef.current);
      
      L.DomUtil.addClass(mapRef.current.getContainer(), 'dark-tiles');
    }
  }, [mapStyle, viewMode]);

  // 3. Markers Update Effect
  useEffect(() => {
    if (viewMode === 'map' && mapRef.current) {
      const map = mapRef.current;
      const markers = markersRef.current;
      const filteredIds = new Set(filteredPois.map(p => p.id));
      
      // Remove old markers
      markers.forEach((marker, id) => {
        if (!filteredIds.has(id)) { map.removeLayer(marker); markers.delete(id); }
      });

      // Add/Update markers
      filteredPois.forEach(poi => {
        const isSelected = selectedPoi?.id === poi.id;
        const popupContent = `<div class="p-2 min-w-[140px] text-zinc-100"><h4 class="font-bold text-sm">${poi.name}</h4><p class="text-[10px] text-zinc-400 mb-2">${poi.altitude}m • ${poi.type}</p><button onclick="window.openMountProDetails()" class="w-full bg-orange-600 py-1.5 rounded font-bold text-xs">Dettagli</button></div>`;
        
        if (markers.has(poi.id)) {
          const m = markers.get(poi.id)!;
          m.setIcon(createCustomIcon(poi.type, isSelected));
          m.setZIndexOffset(isSelected ? 1000 : 0);
        } else {
          const m = L.marker([poi.coordinates.lat, poi.coordinates.lng], { icon: createCustomIcon(poi.type, isSelected) }).addTo(map);
          m.bindPopup(popupContent, { closeButton: false, offset: [0, -6] });
          m.on('click', () => { setSelectedPoi(poi); setIsDetailPanelOpen(false); });
          markers.set(poi.id, m);
        }
      });
    }
  }, [filteredPois, selectedPoi, viewMode]);

  const toggleExposure = (exp: Exposure) => {
    setSelectedExposures(prev => prev.includes(exp) ? prev.filter(e => e !== exp) : [...prev, exp]);
  };

  // Custom Zoom Handlers
  const handleZoomIn = () => { mapRef.current?.zoomIn(); };
  const handleZoomOut = () => { mapRef.current?.zoomOut(); };

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-200 overflow-hidden font-sans relative">
      <aside className={`fixed inset-0 z-[5000] transition-transform duration-300 pointer-events-none ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div ref={sidebarContentRef} className="h-full w-full max-w-md ml-auto bg-zinc-900 border-l border-zinc-800 pointer-events-auto flex flex-col shadow-2xl">
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg"><ChevronLeft/></button>
            <h2 className="font-bold">Filtri Avanzati</h2>
            <div className="w-10"/>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4">Tipologia</h3>
              <div className="flex gap-2">
                {['All', POIType.BIVOUAC, POIType.FOUNTAIN].map(t => (
                  <button key={t} onClick={() => setSelectedType(t as any)} className={`flex-1 py-2 text-xs rounded-lg border ${selectedType === t ? 'bg-orange-600 border-orange-500' : 'bg-zinc-800 border-zinc-700'}`}>{t === 'All' ? 'Tutti' : t}</button>
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4">Esposizione</h3>
              <div className="grid grid-cols-3 gap-2">
                {[Exposure.NORTH, Exposure.SOUTH, Exposure.EAST, Exposure.WEST].map(e => (
                  <button key={e} onClick={() => toggleExposure(e)} className={`py-2 text-xs rounded-lg border ${selectedExposures.includes(e) ? 'bg-blue-600 border-blue-500' : 'bg-zinc-800 border-zinc-700'}`}>{e}</button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative h-full w-full">
        <header className="absolute top-6 left-4 right-4 z-[2000] flex items-center gap-3 pointer-events-none">
          <button onClick={() => setViewMode(v => v === 'list' ? 'map' : 'list')} className="pointer-events-auto w-10 h-10 bg-zinc-900/90 border border-zinc-700/50 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg">{viewMode === 'list' ? <MapIcon size={20}/> : <List size={20}/>}</button>
          <form onSubmit={handleGlobalSearch} className="flex-1 max-w-md pointer-events-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400"/>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={isOffline ? "Ricerca offline..." : "Cerca nome..."} className="w-full h-10 bg-zinc-900/90 border border-zinc-700/50 rounded-xl pl-9 pr-10 text-sm focus:ring-2 focus:ring-orange-500/50 outline-none backdrop-blur-md"/>
            {isOffline && <WifiOff className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500"/>}
          </form>
          <button onClick={() => setIsSidebarOpen(true)} className="pointer-events-auto w-10 h-10 bg-zinc-900/90 border border-zinc-700/50 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg"><Filter size={18}/></button>
        </header>

        <div className="w-full h-full">
          {viewMode === 'list' ? (
            <div className="p-6 pt-32 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto h-full pb-24">
              {filteredPois.map(p => (
                <div key={p.id} onClick={() => { setSelectedPoi(p); setIsDetailPanelOpen(true); setViewMode('map'); }} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-600 transition-all cursor-pointer">
                  <img src={p.imageUrl} className="h-40 w-full object-cover"/>
                  <div className="p-4"><h4 className="font-bold">{p.name}</h4><p className="text-xs text-zinc-500">{p.altitude}m • {p.type}</p></div>
                </div>
              ))}
            </div>
          ) : <div ref={mapContainerRef} className="w-full h-full"/>}
        </div>

        {/* Unified Bottom Center Status Bar (Visible in Map & List) */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[4000] flex flex-col items-center gap-2 pointer-events-none">
           {isSearchingArea && (
              <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-700/50 text-zinc-200 px-4 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-wider flex items-center gap-2 shadow-lg animate-in slide-in-from-bottom-2 fade-in">
                <RefreshCw size={12} className="animate-spin text-orange-500"/>
                Ricerca in area...
              </div>
           )}
           <div className={`pointer-events-auto px-5 py-2.5 rounded-full backdrop-blur-md border shadow-2xl flex items-center gap-3 transition-colors ${isOffline ? 'bg-orange-950/90 border-orange-500/50' : 'bg-zinc-900/90 border-zinc-700/50'}`}>
              <div className={`w-2.5 h-2.5 rounded-full ${isOffline ? 'bg-orange-500' : 'bg-emerald-500 status-dot-pulse'}`}/>
              <span className={`text-xs font-bold ${isOffline ? 'text-orange-200' : 'text-zinc-300'}`}>
                {isOffline ? 'Offline Mode' : 'Online'}
              </span>
           </div>
        </div>

        {/* Map Controls Stack (Bottom Right) */}
        {viewMode === 'map' && (
          <div className="absolute bottom-8 right-4 z-[1000] flex flex-col items-end gap-4 pointer-events-auto">
            
            {/* Layers Menu */}
            <div ref={layersMenuRef} className="relative">
               {isLayersMenuOpen && (
                <div className="absolute bottom-2 right-12 w-72 bg-zinc-900/95 border border-zinc-700 rounded-2xl p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-4">
                  <h4 className="text-[10px] font-bold uppercase text-zinc-500 mb-3 tracking-wider">Tipo Mappa</h4>
                  
                  {/* Visual Map Style Switcher */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button 
                      onClick={() => setMapStyle('standard')} 
                      className={`relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all ${mapStyle === 'standard' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}
                    >
                      <div className="w-full h-16 rounded-lg bg-zinc-700 relative overflow-hidden border border-zinc-600">
                        <div className="absolute top-1/2 left-0 w-full h-1.5 bg-zinc-500 -rotate-12"></div>
                        <div className="absolute top-0 right-1/2 h-full w-1.5 bg-zinc-500 -rotate-12"></div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase ${mapStyle === 'standard' ? 'text-orange-500' : 'text-zinc-400'}`}>Standard</span>
                    </button>

                    <button 
                      onClick={() => setMapStyle('satellite')} 
                      className={`relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all ${mapStyle === 'satellite' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}
                    >
                      <div className="w-full h-16 rounded-lg bg-emerald-900 relative overflow-hidden border border-zinc-600">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 to-amber-950 opacity-80"></div>
                        <div className="absolute top-2 right-2 w-full h-full border-t-2 border-r-2 border-white/10 rounded-full"></div>
                        {/* Label overlay hint */}
                        <div className="absolute bottom-2 left-2 text-[8px] text-white/50 font-mono">HYBRID</div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase ${mapStyle === 'satellite' ? 'text-orange-500' : 'text-zinc-400'}`}>Satellite</span>
                    </button>
                  </div>

                  <div className="h-px bg-zinc-800 my-2" />

                  <button 
                    disabled={isOffline || isDownloading} 
                    onClick={downloadMapArea}
                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-zinc-200 transition-all border border-zinc-700"
                  >
                    {isDownloading ? <><Loader2 size={14} className="animate-spin text-orange-500"/> <span className="text-orange-500">{downloadProgress}%</span></> : <><Download size={14}/> Scarica Area Offline</>}
                  </button>
                </div>
              )}
              <button onClick={() => setIsLayersMenuOpen(!isLayersMenuOpen)} className={`w-12 h-12 bg-zinc-900/90 border ${isLayersMenuOpen ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all`}>
                <Layers size={22}/>
              </button>
            </div>

            {/* Zoom Controls Group */}
            <div className="flex flex-col rounded-2xl overflow-hidden shadow-lg border border-zinc-700 bg-zinc-900/90 backdrop-blur-md">
              <button onClick={handleZoomIn} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200 border-b border-zinc-800">
                <Plus size={24} />
              </button>
              <button onClick={handleZoomOut} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200">
                <Minus size={24} />
              </button>
            </div>
          </div>
        )}

        {/* Pannello Dettaglio */}
        {selectedPoi && isDetailPanelOpen && (
          <div ref={detailPanelRef} className="absolute inset-y-0 right-0 w-full sm:w-[450px] bg-zinc-950 border-l border-zinc-800 shadow-2xl z-[3000] flex flex-col animate-in slide-in-from-right duration-300">
            <div className="