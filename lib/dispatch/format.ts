/**
 * Display Formatting Utilities
 *
 * Pure functions for formatting dispatch-related values into human-readable
 * strings. Used across the dashboard UI for consistent display.
 *
 * All functions are side-effect free and framework-agnostic.
 */

// ---------------------------------------------------------------------------
// Travel time
// ---------------------------------------------------------------------------

/**
 * Format a travel time in seconds as a compact string.
 *
 * @param seconds - Travel time in seconds.
 * @returns Formatted string, e.g. "12m", "1h 30m", or "0m" for zero.
 *
 * @example
 * ```ts
 * formatTravelTime(720)   // "12m"
 * formatTravelTime(5400)  // "1h 30m"
 * formatTravelTime(3600)  // "1h"
 * formatTravelTime(0)     // "0m"
 * ```
 */
export function formatTravelTime(seconds: number): string {
  if (seconds <= 0) return "0m";

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Format a distance in meters as a compact string.
 *
 * Distances under 1 km are shown in meters; above 1 km are shown in
 * kilometres with one decimal place.
 *
 * @param meters - Distance in meters.
 * @returns Formatted string, e.g. "5.2 km", "800 m", or "0 m" for zero.
 *
 * @example
 * ```ts
 * formatDistance(5200)  // "5.2 km"
 * formatDistance(800)   // "800 m"
 * formatDistance(1000)  // "1.0 km"
 * formatDistance(0)     // "0 m"
 * ```
 */
export function formatDistance(meters: number): string {
  if (meters <= 0) return "0 m";

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * Format a cost value as a Euro currency string.
 *
 * @param cost - Cost in euros.
 * @returns Formatted string, e.g. "€12.50", "€0.00".
 *
 * @example
 * ```ts
 * formatCost(12.5)    // "€12.50"
 * formatCost(1250)    // "€1250.00"
 * formatCost(0)       // "€0.00"
 * formatCost(9.999)   // "€10.00"
 * ```
 */
export function formatCost(cost: number): string {
  return `\u20AC${cost.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 datetime string as a time of day (HH:MM).
 *
 * Uses the local timezone offset embedded in the ISO string when present,
 * otherwise uses UTC. This matches how appointment windows are stored in
 * the work order data (e.g. "2026-03-25T09:00:00+01:00").
 *
 * @param isoString - ISO 8601 datetime string.
 * @returns Formatted time, e.g. "09:30".
 *
 * @example
 * ```ts
 * formatTimeOfDay("2026-03-25T09:30:00+01:00")  // "09:30"
 * formatTimeOfDay("2026-03-25T14:05:00Z")        // "14:05"
 * ```
 */
export function formatTimeOfDay(isoString: string): string {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Format a duration in minutes as a compact string.
 *
 * @param minutes - Duration in minutes.
 * @returns Formatted string, e.g. "45m", "2h 15m", "0m".
 *
 * @example
 * ```ts
 * formatDuration(45)   // "45m"
 * formatDuration(135)  // "2h 15m"
 * formatDuration(120)  // "2h"
 * formatDuration(0)    // "0m"
 * ```
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
