"use client";

import { Clock, Route, DollarSign, Loader2 } from "lucide-react";
import { useDispatch } from "./DispatchProvider";

function Metric({
  icon: Icon,
  label,
  value,
  unit,
  estimated,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  unit: string;
  estimated: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <Icon className="h-4 w-4 text-neutral-400 shrink-0" />
      <div>
        <div className="text-[11px] text-neutral-400 uppercase tracking-wide">
          {label}
        </div>
        <div className="text-sm font-semibold text-neutral-800 tabular-nums">
          {estimated ? "~" : ""}
          {value}
          <span className="text-neutral-400 font-normal ml-0.5">{unit}</span>
        </div>
      </div>
    </div>
  );
}

export function DispatchKpiBar() {
  const { state } = useDispatch();
  const { metrics, metricsSource, isLoading } = state;

  const isEstimated = metricsSource === "estimate";

  // Format seconds to rounded minutes
  const travelMinutes = metrics
    ? Math.round(metrics.travelTimeSeconds / 60)
    : 0;
  const distanceKm = metrics ? (metrics.distanceMeters / 1000).toFixed(1) : "0.0";
  const cost = metrics ? metrics.cost.toFixed(0) : "0";

  return (
    <div className="flex items-center rounded-lg border border-neutral-200 bg-white divide-x divide-neutral-100">
      <Metric
        icon={Clock}
        label="Travel Time"
        value={travelMinutes}
        unit="min"
        estimated={isEstimated}
      />
      <Metric
        icon={Route}
        label="Distance"
        value={distanceKm}
        unit="km"
        estimated={isEstimated}
      />
      <Metric
        icon={DollarSign}
        label="Est. Cost"
        value={cost}
        unit="EUR"
        estimated={isEstimated}
      />
      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-2 text-orange-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Optimizing...</span>
        </div>
      )}
    </div>
  );
}
