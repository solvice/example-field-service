"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WorkOrder, Technician } from "@/lib/types";
import type { DistanceMatrix } from "@/lib/dispatch/types";
import {
  extractCoordinates,
  buildDistanceMatrix,
  type Coordinate,
} from "@/lib/dispatch/distance-matrix";

interface UseDistanceMatrixResult {
  matrix: DistanceMatrix | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches a distance matrix from `/api/dispatch/matrix` on mount and caches
 * the result for the duration of the component's lifecycle.
 *
 * Coordinates are extracted from work orders (service locations) and
 * technicians (home base start/end depots) using the shared
 * `extractCoordinates` utility. The API response (NxN durations + distances)
 * is combined with the coordinate list into a `DistanceMatrix` with O(1)
 * key-based lookups via `coordIndex`.
 */
export function useDistanceMatrix(
  workOrders: WorkOrder[],
  technicians: Technician[],
): UseDistanceMatrixResult {
  const [matrix, setMatrix] = useState<DistanceMatrix | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session cache — survives re-renders but not unmount/remount
  const cacheRef = useRef<DistanceMatrix | null>(null);
  // Track whether we have already kicked off a fetch for this set of locations
  const fetchedKeyRef = useRef<string | null>(null);

  const fetchMatrix = useCallback(async (coordinates: Coordinate[]) => {
    // Build a stable cache key from sorted coordinate keys
    const key = coordinates
      .map((c) => c.key)
      .sort()
      .join(",");

    // Return cached result if the location set hasn't changed
    if (fetchedKeyRef.current === key && cacheRef.current) {
      setMatrix(cacheRef.current);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Send coordinates as [lng, lat] pairs — the standard for matrix APIs
      const res = await fetch("/api/dispatch/matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: coordinates.map((c) => ({
            key: c.key,
            lng: c.lng,
            lat: c.lat,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Matrix API responded with ${res.status}`);
      }

      const apiResponse = (await res.json()) as {
        durations: number[][];
        distances: number[][];
      };

      // Build the DistanceMatrix with coordIndex for O(1) lookups
      const built = buildDistanceMatrix(coordinates, apiResponse);

      cacheRef.current = built;
      fetchedKeyRef.current = key;
      setMatrix(built);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch distance matrix",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workOrders.length === 0 && technicians.length === 0) return;

    const coordinates = extractCoordinates(workOrders, technicians);
    fetchMatrix(coordinates);
  }, [workOrders, technicians, fetchMatrix]);

  return { matrix, isLoading, error };
}
