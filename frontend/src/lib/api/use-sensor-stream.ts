import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./client";

export interface SensorReading {
  asset_id: string;
  timestamp: string;
  temperature: number;
  vibration: number;
  pressure: number;
  current: number;
  health_score: number;
  is_anomaly: boolean;
}

// Global state for shared SSE connection
const MAX_HISTORY = 60;
let eventSource: EventSource | null = null;
const latestByAsset = new Map<string, SensorReading>();
const historyByAsset = new Map<string, SensorReading[]>();
const listeners = new Set<(data: SensorReading[]) => void>();
let isConnecting = false;
let reconnectTimeout: any = null;
let reconnectAttempts = 0;
let lastInvalidateMs = 0;
const INVALIDATE_THROTTLE_MS = 30_000;

function connect(queryClient: any) {
  if (eventSource || isConnecting) return;
  isConnecting = true;

  const url = `${API_BASE}/api/v1/stream/sensors`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    isConnecting = false;
    reconnectAttempts = 0; // reset backoff on a good connection
  };

  eventSource.onmessage = (event) => {
    try {
      const readings: SensorReading[] = JSON.parse(event.data);
      let hasAnomaly = false;

      readings.forEach((reading) => {
        const id = reading.asset_id;
        
        // Save latest
        latestByAsset.set(id, reading);
        
        // Save history
        let history = historyByAsset.get(id) || [];
        history = [...history, reading];
        if (history.length > MAX_HISTORY) {
          history.shift();
        }
        historyByAsset.set(id, history);

        if (reading.is_anomaly) {
          hasAnomaly = true;
        }
      });

      // Notify listeners
      listeners.forEach((listener) => listener(readings));

      // Invalidate dashboard/alerts/assets at most once per 30s to avoid jarring re-renders
      if (hasAnomaly && Date.now() - lastInvalidateMs >= INVALIDATE_THROTTLE_MS) {
        lastInvalidateMs = Date.now();
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
    } catch (err) {
      console.error("Failed to parse SSE data", err);
    }
  };

  eventSource.onerror = () => {
    // Benign: EventSource fires onerror on disconnect before auto-reconnecting.
    // Exponential backoff (5s→10s→20s→max 30s) so a brief backend blip doesn't
    // hammer the server or flood the console with reconnect attempts.
    isConnecting = false;
    cleanup();
    if (!reconnectTimeout) {
      const delay = Math.min(5000 * 2 ** reconnectAttempts, 30000);
      reconnectAttempts += 1;
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect(queryClient);
      }, delay);
    }
  };
}

function cleanup() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function useSensorStream() {
  const queryClient = useQueryClient();
  const [latest, setLatest] = useState<Map<string, SensorReading>>(new Map(latestByAsset));
  const [history, setHistory] = useState<Map<string, SensorReading[]>>(new Map(historyByAsset));
  const [isConnected, setIsConnected] = useState<boolean>(Boolean(eventSource && eventSource.readyState === EventSource.OPEN));

  useEffect(() => {
    // Initiate connection if needed
    connect(queryClient);

    const checkConnection = setInterval(() => {
      setIsConnected(Boolean(eventSource && eventSource.readyState === EventSource.OPEN));
    }, 2000);

    const listener = () => {
      // Create new Maps to trigger re-renders in components
      setLatest(new Map(latestByAsset));
      setHistory(new Map(historyByAsset));
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      clearInterval(checkConnection);
    };
  }, [queryClient]);

  const getAssetHistory = (assetId: string): SensorReading[] => {
    return history.get(assetId) || [];
  };

  const getAssetLatest = (assetId: string): SensorReading | undefined => {
    return latest.get(assetId);
  };

  return {
    latestByAsset: latest,
    historyByAsset: history,
    isConnected,
    getAssetHistory,
    getAssetLatest,
  };
}
