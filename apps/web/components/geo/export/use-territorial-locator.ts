"use client";

import { useEffect, useMemo, useState } from "react";

import type { GeoBounds } from "@/lib/geo-export-data";

import {
  selectTerritory,
  type TerritoryFeature,
  type TerritoryGeometry,
  type TerritoryPoint,
} from "./territorial-geometry";

interface TerritoryResponse {
  features?: Array<{
    code?: unknown;
    name?: unknown;
    geometry?: unknown;
  }>;
  message?: string;
  source?: string;
}

interface UseTerritorialLocatorInput {
  point: TerritoryPoint;
  bounds?: GeoBounds | null;
}

export interface TerritorialLocatorData {
  provinces: TerritoryFeature[];
  cantons: TerritoryFeature[];
  province: TerritoryFeature | null;
  canton: TerritoryFeature | null;
  loading: boolean;
  error: string | null;
  source: string;
}

const requestCache = new Map<string, Promise<{ features: TerritoryFeature[]; source: string }>>();

function isTerritoryGeometry(value: unknown): value is TerritoryGeometry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return (
    (candidate.type === "Polygon" || candidate.type === "MultiPolygon") &&
    Array.isArray(candidate.coordinates)
  );
}

async function loadTerritories(url: string) {
  const cached = requestCache.get(url);
  if (cached) return cached;

  const request = fetch(url)
    .then(async (response) => {
      const payload = (await response.json()) as TerritoryResponse;
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      const features = (payload.features ?? []).flatMap<TerritoryFeature>((feature) => {
        if (
          typeof feature.code !== "string" ||
          typeof feature.name !== "string" ||
          !isTerritoryGeometry(feature.geometry)
        ) {
          return [];
        }
        return [{ code: feature.code, name: feature.name, geometry: feature.geometry }];
      });
      return {
        features,
        source: payload.source || "INEC · División Político Administrativa",
      };
    })
    .catch((error) => {
      requestCache.delete(url);
      throw error;
    });
  requestCache.set(url, request);
  return request;
}

export function useTerritorialLocator({
  point,
  bounds,
}: UseTerritorialLocatorInput): TerritorialLocatorData {
  const [provinces, setProvinces] = useState<TerritoryFeature[]>([]);
  const [cantons, setCantons] = useState<TerritoryFeature[]>([]);
  const [source, setSource] = useState("INEC · División Político Administrativa");
  const [provinceLoading, setProvinceLoading] = useState(true);
  const [cantonLoading, setCantonLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProvinceLoading(true);
    loadTerritories("/api/geo/territories?level=provinces")
      .then((result) => {
        if (!active) return;
        setProvinces(result.features);
        setSource(result.source);
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setProvinceLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const province = useMemo(
    () => selectTerritory(provinces, point, bounds),
    [bounds, point, provinces],
  );
  const provinceCode = province?.code ?? null;

  useEffect(() => {
    let active = true;
    if (!provinceCode) {
      setCantons([]);
      setCantonLoading(false);
      return () => {
        active = false;
      };
    }

    setCantons([]);
    setCantonLoading(true);
    loadTerritories(
      `/api/geo/territories?level=cantons&province=${encodeURIComponent(provinceCode)}`,
    )
      .then((result) => {
        if (!active) return;
        setCantons(result.features);
        setSource(result.source);
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setCantonLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provinceCode]);

  const canton = useMemo(
    () => selectTerritory(cantons, point, bounds),
    [bounds, cantons, point],
  );

  return {
    provinces,
    cantons,
    province,
    canton,
    loading: provinceLoading || cantonLoading,
    error,
    source,
  };
}
