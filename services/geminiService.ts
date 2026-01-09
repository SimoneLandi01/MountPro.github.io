
import { GoogleGenAI, Type } from "@google/genai";
import { POI, LiveConditions } from "../types";

export interface AIResponse {
  data: LiveConditions | null;
  sources: { title: string; uri: string }[];
}

// In-memory cache: Key = POI.id, Value = AIResponse
const infoCache = new Map<string, AIResponse>();

export const getLiveOutdoorInfo = async (poi: POI): Promise<AIResponse> => {
  // Check cache first
  if (infoCache.has(poi.id)) {
    return infoCache.get(poi.id)!;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const prompt = `Analizza la località outdoor "${poi.name}" a ${poi.altitude}m.
    Fornisci meteo attuale stimato, orario ALBA e TRAMONTO di oggi, e se trovi un link diretto a Google Maps.
    
    IMPORTANTE - COPERTURA MOBILE: 
    Stima la copertura cellulare usando SOLO questi valori per il campo 'type': "5G", "4G", "3G", "H+", "/".
    Usa "/" se non c'è segnale.
    Indica la potenza da 0 (assente) a 4 (pieno).`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            temperature: { type: Type.STRING, description: "Temperatura attuale stimata (es. '-2°C')" },
            condition: { type: Type.STRING, description: "Condizione meteo breve (es. 'Nuvoloso', 'Soleggiato')" },
            wind: { type: Type.STRING, description: "Velocità vento stimata (es. '15 km/h N')" },
            sunrise: { type: Type.STRING, description: "Orario alba formato HH:MM" },
            sunset: { type: Type.STRING, description: "Orario tramonto formato HH:MM" },
            
            connectivity_info: {
               type: Type.OBJECT,
               properties: {
                  type: { type: Type.STRING, description: "Tipo di rete: '5G', '4G', '3G', 'H+', '/'" },
                  strength: { type: Type.INTEGER, description: "Potenza segnale da 0 (nessuno) a 4 (pieno)" },
                  description: { type: Type.STRING, description: "Breve descrizione (es. 'Tim prende bene', 'Solo emergenza')" }
               },
               required: ["type", "strength", "description"]
            },

            google_maps_url: { type: Type.STRING, description: "Link diretto a Google Maps se trovato, altrimenti stringa vuota" },
            snow_ice_alert: { type: Type.BOOLEAN, description: "True se probabile presenza di neve o ghiaccio" },
            summary: { type: Type.STRING, description: "Breve consiglio tecnico per l'escursionista (max 150 caratteri)" }
          },
          required: ["temperature", "condition", "wind", "sunrise", "sunset", "connectivity_info", "snow_ice_alert", "summary"]
        }
      },
    });

    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.filter(chunk => chunk.web)
      .map(chunk => ({
        title: chunk.web?.title || "Fonte Web",
        uri: chunk.web?.uri || ""
      })) || [];

    let parsedData: LiveConditions | null = null;
    if (response.text) {
      parsedData = JSON.parse(response.text) as LiveConditions;
    }

    const result: AIResponse = {
      data: parsedData,
      sources: sources
    };

    // Store in cache if successful
    if (parsedData) {
      infoCache.set(poi.id, result);
    }

    return result;
  } catch (error) {
    console.error("Gemini Error:", error);
    return {
      data: null,
      sources: []
    };
  }
};
