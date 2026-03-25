import { NextResponse } from "next/server";

const ROUTING_BASE = "https://routing.solvice.io";

/**
 * POST /api/dispatch/matrix
 *
 * Proxies distance matrix requests to the Solvice routing API.
 *
 * Request body:
 *   { coordinates: [number, number][] }
 *   Coordinates are [longitude, latitude] pairs (GeoJSON order).
 *
 * Response:
 *   { durations: number[][], distances: number[][] }
 *   durations in seconds, distances in metres.
 */
export async function POST(request: Request) {
  const apiKey = process.env.SOLVICE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "SOLVICE_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: { coordinates?: [number, number][] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { coordinates } = body;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return NextResponse.json(
      { error: "At least 2 coordinates are required" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${ROUTING_BASE}/table/sync`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates,
        vehicleType: "CAR",
        annotations: ["duration", "distance"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Distance matrix request failed",
          details: `${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ""}`,
        },
        { status: response.status },
      );
    }

    const data = await response.json();

    if (!Array.isArray(data.durations) || !Array.isArray(data.distances)) {
      return NextResponse.json(
        { error: "Invalid response from routing API: missing durations or distances" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      durations: data.durations,
      distances: data.distances,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch distance matrix", details: message },
      { status: 500 },
    );
  }
}
