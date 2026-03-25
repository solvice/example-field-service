"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useDispatch } from "./DispatchProvider";

/* ------------------------------------------------------------------ */
/*  Palette — 5 technician colours                                     */
/* ------------------------------------------------------------------ */
const TECH_COLORS = [
  "#f97316", // orange-500
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
] as const;

export function techColor(index: number) {
  return TECH_COLORS[index % TECH_COLORS.length];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function DispatchMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const { state, dispatch: dispatchAction } = useDispatch();
  const {
    workOrders,
    technicians,
    assignments,
    violations,
    selectedWorkOrder,
  } = state;

  /* ---------- init map ---------- */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [0, 0],
      zoom: 2,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ---------- update markers & polylines on state change ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      // Clear existing markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const bounds = new maplibregl.LngLatBounds();
      let hasPoints = false;

      // Build lookups
      const techIndex = new Map<string, number>();
      technicians.forEach((t, i) => techIndex.set(t.id, i));

      // Violation set — workOrderIds that have violations
      const violationWoIds = new Set<string>();
      for (const [woId, vList] of violations) {
        if (vList.length > 0) violationWoIds.add(woId);
      }

      // Selected work order's technician (for route highlighting)
      const selectedAssignment = selectedWorkOrder
        ? assignments.get(selectedWorkOrder)
        : null;

      /* --- Technician home bases --- */
      for (const tech of technicians) {
        const idx = techIndex.get(tech.id) ?? 0;
        const el = document.createElement("div");
        el.style.cssText = `
          width: 24px; height: 24px; border-radius: 4px;
          background: ${techColor(idx)}; border: 2px solid white;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; color: white; font-weight: 700;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer;
        `;
        el.textContent = tech.name.charAt(0);
        el.title = `${tech.name} — Home base`;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([tech.homeBase.longitude, tech.homeBase.latitude])
          .addTo(map);

        markersRef.current.push(marker);
        bounds.extend([tech.homeBase.longitude, tech.homeBase.latitude]);
        hasPoints = true;
      }

      /* --- Work order markers --- */
      for (const wo of workOrders) {
        const assignment = assignments.get(wo.id);
        const hasViolation = violationWoIds.has(wo.id);
        const isSelected = wo.id === selectedWorkOrder;

        let color = "#a3a3a3"; // neutral-400 — unplanned
        if (hasViolation) color = "#ef4444"; // red-500
        else if (assignment) {
          const idx = techIndex.get(assignment.technicianId) ?? 0;
          color = techColor(idx);
        }

        const size = isSelected ? 18 : 12;
        const el = document.createElement("div");
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: ${color}; border: 2px solid ${isSelected ? "#fff" : "rgba(255,255,255,0.7)"};
          box-shadow: ${isSelected ? `0 0 0 3px ${color}66,` : ""} 0 1px 4px rgba(0,0,0,0.3);
          cursor: pointer; transition: all 150ms;
        `;
        el.title = `${wo.customerName} — ${wo.serviceType}`;

        el.addEventListener("click", () => {
          dispatchAction({
            type: "SELECT_WORK_ORDER",
            workOrderId: wo.id === selectedWorkOrder ? null : wo.id,
          });
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([wo.longitude, wo.latitude])
          .addTo(map);

        markersRef.current.push(marker);
        bounds.extend([wo.longitude, wo.latitude]);
        hasPoints = true;
      }

      /* --- Route polylines per technician --- */
      // Remove existing route layers and sources
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if (layer.id.startsWith("route-")) {
            map.removeLayer(layer.id);
          }
        }
      }
      if (style?.sources) {
        for (const sourceId of Object.keys(style.sources)) {
          if (sourceId.startsWith("route-")) {
            map.removeSource(sourceId);
          }
        }
      }

      // Group assignments by technician and build polylines
      const techRoutes = new Map<string, { sequence: number; woId: string }[]>();
      for (const [woId, a] of assignments) {
        const list = techRoutes.get(a.technicianId) ?? [];
        list.push({ sequence: a.sequence, woId });
        techRoutes.set(a.technicianId, list);
      }

      for (const [techId, route] of techRoutes) {
        const tech = technicians.find((t) => t.id === techId);
        if (!tech) continue;

        // Sort by sequence
        route.sort((a, b) => a.sequence - b.sequence);

        // Build coordinate array: home -> wo1 -> wo2 -> ...
        const coords: [number, number][] = [
          [tech.homeBase.longitude, tech.homeBase.latitude],
        ];

        for (const r of route) {
          const wo = workOrders.find((w) => w.id === r.woId);
          if (wo) coords.push([wo.longitude, wo.latitude]);
        }

        if (coords.length < 2) continue;

        const idx = techIndex.get(techId) ?? 0;
        const isHighlighted = selectedAssignment?.technicianId === techId;
        const sourceId = `route-${techId}`;

        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
          },
        });

        map.addLayer({
          id: sourceId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": techColor(idx),
            "line-width": isHighlighted ? 4 : 2,
            "line-opacity": isHighlighted ? 1 : 0.5,
          },
        });
      }

      /* --- Fit bounds --- */
      if (hasPoints) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [workOrders, technicians, assignments, violations, selectedWorkOrder, dispatchAction]);

  return (
    <div
      ref={mapContainer}
      className="h-full w-full rounded-lg border border-neutral-200 overflow-hidden"
    />
  );
}
