"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

function circleIcon(color: string, size: number, selected: boolean) {
  const s = selected ? size + 6 : size;
  const border = selected
    ? `3px solid white; box-shadow: 0 0 0 3px ${color}88, 0 2px 6px rgba(0,0,0,0.4)`
    : `2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35)`;
  return L.divIcon({
    className: "",
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    html: `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${color};border:${border};cursor:pointer;transition:all 150ms;"></div>`,
  });
}

function squareIcon(color: string, label: string) {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:4px;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:12px;color:white;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;">${label}</div>`,
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function DispatchMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const { state, dispatch: dispatchAction } = useDispatch();
  const { workOrders, technicians, assignments, violations, selectedWorkOrder } = state;

  /* ---------- init map ---------- */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = L.map(mapContainer.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([50.85, 4.35], 8);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  /* ---------- update markers & polylines on state change ---------- */
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    const bounds = L.latLngBounds([]);

    // Build lookups
    const techIndex = new Map<string, number>();
    technicians.forEach((t, i) => techIndex.set(t.id, i));

    const violationWoIds = new Set<string>();
    for (const [woId, vList] of violations) {
      if (vList.length > 0) violationWoIds.add(woId);
    }

    const selectedAssignment = selectedWorkOrder ? assignments.get(selectedWorkOrder) : null;

    /* --- Technician home bases --- */
    for (const tech of technicians) {
      const idx = techIndex.get(tech.id) ?? 0;
      const marker = L.marker([tech.homeBase.latitude, tech.homeBase.longitude], {
        icon: squareIcon(techColor(idx), tech.name.charAt(0)),
        title: `${tech.name} — Home base`,
      });
      marker.addTo(layerGroup);
      bounds.extend([tech.homeBase.latitude, tech.homeBase.longitude]);
    }

    /* --- Work order markers --- */
    for (const wo of workOrders) {
      const assignment = assignments.get(wo.id);
      const hasViolation = violationWoIds.has(wo.id);
      const isSelected = wo.id === selectedWorkOrder;

      let color = "#a3a3a3"; // neutral — unplanned
      if (hasViolation) color = "#ef4444"; // red
      else if (assignment) {
        const idx = techIndex.get(assignment.technicianId) ?? 0;
        color = techColor(idx);
      }

      const size = isSelected ? 20 : 16;
      const marker = L.marker([wo.latitude, wo.longitude], {
        icon: circleIcon(color, size, isSelected),
        title: `${wo.customerName} — ${wo.serviceType}`,
      });

      marker.on("click", () => {
        dispatchAction({
          type: "SELECT_WORK_ORDER",
          workOrderId: wo.id === selectedWorkOrder ? null : wo.id,
        });
      });

      marker.addTo(layerGroup);
      bounds.extend([wo.latitude, wo.longitude]);
    }

    /* --- Route polylines per technician --- */
    const techRoutes = new Map<string, { sequence: number; woId: string }[]>();
    for (const [woId, a] of assignments) {
      const list = techRoutes.get(a.technicianId) ?? [];
      list.push({ sequence: a.sequence, woId });
      techRoutes.set(a.technicianId, list);
    }

    for (const [techId, route] of techRoutes) {
      const tech = technicians.find((t) => t.id === techId);
      if (!tech) continue;

      route.sort((a, b) => a.sequence - b.sequence);

      const coords: L.LatLngExpression[] = [
        [tech.homeBase.latitude, tech.homeBase.longitude],
      ];

      for (const r of route) {
        const wo = workOrders.find((w) => w.id === r.woId);
        if (wo) coords.push([wo.latitude, wo.longitude]);
      }

      if (coords.length < 2) continue;

      const idx = techIndex.get(techId) ?? 0;
      const isHighlighted = selectedAssignment?.technicianId === techId;

      L.polyline(coords, {
        color: techColor(idx),
        weight: isHighlighted ? 4 : 2,
        opacity: isHighlighted ? 1 : 0.5,
      }).addTo(layerGroup);
    }

    /* --- Fit bounds --- */
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [workOrders, technicians, assignments, violations, selectedWorkOrder, dispatchAction]);

  return (
    <div
      ref={mapContainer}
      className="h-full w-full rounded-lg border border-neutral-200 overflow-hidden"
      style={{ minHeight: "300px" }}
    />
  );
}
