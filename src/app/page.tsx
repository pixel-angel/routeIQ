"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GRID_SIZE = 15;

type Point = { x: number; y: number };

type Order = {
  id: number;
  origin: Point;
  destination: Point;
  stops?: Point[];
  payload: number;
  priority: "Low" | "Medium" | "High" | "Critical";
  status: "Pending" | "Assigned" | "In Transit" | "Delivered";
  driver: string | null;
  driver_id: number | null;
  distance: number | null;
  route: Point[];
  stop_sequence?: Point[];
};

type Driver = {
  id: number;
  name: string;
  capacity: number;
  available: boolean;
  current_order: number | null;
};

type State = {
  orders: Order[];
  drivers: Driver[];
  obstacles: Point[];
  metrics: {
    total_orders: number;
    active_orders: number;
    delivered_orders: number;
    available_drivers: number;
  };
};

type StrategyResult = {
  key: string;
  label: string;
  family: string;
  complexity: string;
  description: string;
  status: "ok" | "skipped" | "infeasible";
  exact: boolean;
  distance: number | null;
  time_ms: number;
  operations: number;
  gap_percent: number | null;
  stop_sequence: Point[];
  route: Point[];
};

type SearchSpace = {
  permutations: string;
  dp_states: number | string;
};

type RouteComparison = {
  stops: Point[];
  stops_count: number;
  stops_source: "planner" | "active_orders";
  strategies: StrategyResult[];
  best_strategy: string;
  best_distance: number | null;
  optimal_known: boolean;
  savings_vs_input_order: number | null;
  search_space: SearchSpace;
  recommendation: string;
  shortest_route: Point[];
  shortest_distance: number | null;
  alternative_route: Point[];
  alternative_distance: number | null;
};

type BenchmarkRow = {
  stops: number;
  requested_stops: number;
  best_distance: number | null;
  optimal_known: boolean;
  search_space: SearchSpace;
  total_ms: number;
  strategies: Pick<
    StrategyResult,
    | "key"
    | "label"
    | "status"
    | "distance"
    | "time_ms"
    | "operations"
    | "gap_percent"
    | "exact"
  >[];
};

const BENCHMARK_SIZES = [5, 10, 50, 100];

function formatMs(ms: number) {
  if (ms === 0) return "<0.001 ms";
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 10) return `${ms.toFixed(3)} ms`;
  return `${ms.toFixed(1)} ms`;
}

function formatCount(value: number | string) {
  if (typeof value === "string") return value;
  return value.toLocaleString();
}

const initialState: State = {
  orders: [],
  drivers: [],
  obstacles: [],
  metrics: {
    total_orders: 0,
    active_orders: 0,
    delivered_orders: 0,
    available_drivers: 0,
  },
};

const priorities = ["Low", "Medium", "High", "Critical"] as const;

const priorityColor: Record<string, string> = {
  Low: "#8b9aab",
  Medium: "#eab308",
  High: "#f97316",
  Critical: "#ef4444",
};

const statusColor: Record<string, string> = {
  Pending: "#eab308",
  Assigned: "#38bdf8",
  "In Transit": "#34d399",
  Delivered: "#8b9aab",
};

function pointKey(point: Point) {
  return `${point.x},${point.y}`;
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

// Converts a sequential path of coordinates to SVG percentage coordinates (0-100)
function pointsToSvgPath(
  points: Point[],
  gridSize: number = GRID_SIZE,
): string {
  if (!points || points.length === 0) return "";
  return points
    .map((pt) => {
      const cx = ((pt.x + 0.5) / gridSize) * 100;
      const cy = ((pt.y + 0.5) / gridSize) * 100;
      return `${cx.toFixed(2)},${cy.toFixed(2)}`;
    })
    .join(" ");
}

export default function RouteIQDashboard() {
  const [data, setData] = useState<State>(initialState);

  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });
  const [destination, setDestination] = useState<Point>({
    x: 14,
    y: 14,
  });
  const [stops, setStops] = useState<Point[]>([]);

  const [payload, setPayload] = useState(8);
  const [priority, setPriority] = useState<(typeof priorities)[number]>("High");

  const [mapMode, setMapMode] = useState<
    "origin" | "destination" | "stop" | "obstacle"
  >("obstacle");

  const [comparison, setComparison] = useState<RouteComparison | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(
    null,
  );
  const [benchmark, setBenchmark] = useState<BenchmarkRow[] | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  const [showAlternative, setShowAlternative] = useState(false);
  const [showObstacles, setShowObstacles] = useState(true);

  const [loading, setLoading] = useState(false);
  const [loadingState, setLoadingState] = useState(true);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">(
    "info",
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const notify = useCallback(
    (text: string, type: "success" | "error" | "info" = "info") => {
      setMessage(text);
      setMessageType(type);
    },
    [],
  );

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/state`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Could not load dashboard state.");
      }

      const result: State = await response.json();
      setData(result);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Backend connection failed.",
        "error",
      );
    } finally {
      setLoadingState(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  async function apiRequest(path: string, method: string, body?: unknown) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.detail || result.message || "Request failed.");
    }

    return result;
  }

  async function createOrder() {
    setLoading(true);

    try {
      const result = await apiRequest("/api/orders", "POST", {
        origin,
        destination,
        stops,
        payload,
        priority,
      });

      await fetchState();

      setComparison(null);
      setStops([]);

      notify(`Order #${result.id} created — ${result.status}.`, "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Order creation failed.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(order: Order, nextStatus: string) {
    setLoading(true);

    try {
      await apiRequest(
        `/api/orders/${order.id}/status?status=${encodeURIComponent(nextStatus)}`,
        "PATCH",
      );

      await fetchState();

      notify(`Order #${order.id} updated to ${nextStatus}.`, "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Status update failed.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  async function clearOrders() {
    const confirmed = window.confirm(
      "Clear all delivery orders and reset driver assignments?",
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      await apiRequest("/api/orders", "DELETE");

      setComparison(null);

      await fetchState();

      notify("All orders have been cleared.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Reset failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function compareRoutes() {
    setLoading(true);

    try {
      const result: RouteComparison = await apiRequest(
        "/api/route/compare",
        "POST",
        {
          origin,
          destination,
          stops,
        },
      );

      setComparison(result);
      setSelectedStrategy(result.best_strategy);
      setShowAlternative(true);

      notify(
        result.stops_source === "active_orders"
          ? `Compared strategies over ${result.stops_count} active order stops.`
          : `Compared strategies over ${result.stops_count} planner stops.`,
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Route comparison failed.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  async function runBenchmark() {
    setBenchmarkLoading(true);

    try {
      const result: { benchmarks: BenchmarkRow[] } = await apiRequest(
        "/api/benchmark",
        "POST",
        { stop_counts: BENCHMARK_SIZES },
      );
      setBenchmark(result.benchmarks);
      notify("Scalability benchmark completed.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Benchmark failed.",
        "error",
      );
    } finally {
      setBenchmarkLoading(false);
    }
  }

  async function updateObstacles(nextObstacles: Point[]) {
    setLoading(true);

    try {
      await apiRequest("/api/obstacles", "POST", {
        cells: nextObstacles,
      });

      setComparison(null);

      await fetchState();

      notify("Map obstacles updated.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Obstacle update failed.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCellClick(point: Point) {
    if (samePoint(point, origin) || samePoint(point, destination)) {
      if (mapMode === "obstacle" || mapMode === "stop") {
        notify(
          "Origin and destination cannot be blocked or used as a stop.",
          "error",
        );
        return;
      }
    }

    if (mapMode === "origin") {
      setOrigin(point);
      setStops((prev) => prev.filter((p) => !samePoint(p, point)));
      setComparison(null);
      notify(`Origin set to (${point.x}, ${point.y}).`, "success");
      return;
    }

    if (mapMode === "destination") {
      setDestination(point);
      setStops((prev) => prev.filter((p) => !samePoint(p, point)));
      setComparison(null);
      notify(`Destination set to (${point.x}, ${point.y}).`, "success");
      return;
    }

    if (mapMode === "stop") {
      if (data.obstacles.some((p) => samePoint(p, point))) {
        notify("Cannot place a delivery stop on an obstacle.", "error");
        return;
      }

      const exists = stops.findIndex((item) => samePoint(item, point));

      const next =
        exists !== -1
          ? stops.filter((_, i) => i !== exists)
          : [...stops, point];

      setStops(next);
      setComparison(null);
      return;
    }

    if (mapMode === "obstacle") {
      if (stops.some((p) => samePoint(p, point))) {
        notify("Cannot place an obstacle on a delivery stop.", "error");
        return;
      }

      const current = data.obstacles;
      const exists = current.some((item) => samePoint(item, point));

      const next = exists
        ? current.filter((item) => !samePoint(item, point))
        : [...current, point];

      updateObstacles(next);
    }
  }

  // Raw coordinate sequences for drawing continuous vector lines
  const activeOrderRoute = useMemo(() => {
    return (
      data.orders.find(
        (order) =>
          samePoint(order.origin, origin) &&
          samePoint(order.destination, destination) &&
          order.status !== "Delivered",
      )?.route ?? []
    );
  }, [data.orders, origin, destination]);

  const activeStrategy = useMemo(() => {
    if (!comparison) return null;
    return (
      comparison.strategies.find((s) => s.key === selectedStrategy) ??
      comparison.strategies.find((s) => s.key === comparison.best_strategy) ??
      null
    );
  }, [comparison, selectedStrategy]);

  const rawShortestRoute = useMemo(() => {
    if (activeStrategy && activeStrategy.route.length > 0) {
      return activeStrategy.route;
    }
    return comparison?.shortest_route ?? activeOrderRoute;
  }, [comparison, activeStrategy, activeOrderRoute]);

  // Stops shown on the map: the compared instance (may come from active orders) or the planner stops
  const displayStops = useMemo(() => {
    return comparison ? comparison.stops : stops;
  }, [comparison, stops]);

  // Number each stop by its position in the selected strategy's visiting order
  const visitNumber = useMemo(() => {
    const map = new Map<string, number>();
    if (activeStrategy && activeStrategy.stop_sequence.length > 0) {
      activeStrategy.stop_sequence.forEach((p, i) => map.set(pointKey(p), i + 1));
    } else {
      displayStops.forEach((p, i) => map.set(pointKey(p), i + 1));
    }
    return map;
  }, [activeStrategy, displayStops]);

  const rawAlternativeRoute = useMemo(() => {
    return comparison?.alternative_route ?? [];
  }, [comparison]);

  // Set lookups for subtle background highlighting on individual cells
  const shortestPath = useMemo(() => {
    return new Set(rawShortestRoute.map(pointKey));
  }, [rawShortestRoute]);

  const alternativePath = useMemo(() => {
    return new Set(rawAlternativeRoute.map(pointKey));
  }, [rawAlternativeRoute]);

  const filteredOrders = useMemo(() => {
    return data.orders.filter((order) => {
      const matchesSearch =
        String(order.id).includes(search) ||
        (order.driver || "").toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "All" || order.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [data.orders, search, statusFilter]);

  const estimatedDistance = useMemo(() => {
    let dist = 0;
    let curr = origin;
    for (const stop of stops) {
      dist += Math.abs(stop.x - curr.x) + Math.abs(stop.y - curr.y);
      curr = stop;
    }
    dist += Math.abs(destination.x - curr.x) + Math.abs(destination.y - curr.y);
    return dist;
  }, [origin, destination, stops]);

  function getCellClass(point: Point) {
    const key = pointKey(point);

    if (samePoint(point, origin)) return "map-cell origin-cell";
    if (samePoint(point, destination)) return "map-cell destination-cell";

    if (showObstacles && data.obstacles.some((p) => samePoint(p, point))) {
      return "map-cell obstacle-cell";
    }

    if (displayStops.some((p) => samePoint(p, point))) {
      return "map-cell stop-cell";
    }

    if (showAlternative && alternativePath.has(key)) {
      return "map-cell alternative-cell";
    }

    if (shortestPath.has(key)) {
      return "map-cell route-cell";
    }

    return "map-cell";
  }

  function getAction(order: Order) {
    if (order.status === "Pending") {
      return {
        label: "ASSIGN",
        next: "Assigned",
        className: "action-assign",
      };
    }

    if (order.status === "Assigned") {
      return {
        label: "START",
        next: "In Transit",
        className: "action-start",
      };
    }

    if (order.status === "In Transit") {
      return {
        label: "DELIVER",
        next: "Delivered",
        className: "action-deliver",
      };
    }

    return null;
  }

  return (
    <main className="routeiq-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <h1>RouteIQ</h1>
            <span>LOGISTICS INTELLIGENCE</span>
          </div>
        </div>

        <div className="sidebar-section-label">OPERATIONS</div>

        <nav className="sidebar-nav">
          <a href="#overview" className="nav-item active">
            <span>◫</span> Overview
          </a>
          <a href="#dispatch" className="nav-item">
            <span>⌁</span> Dispatch Center
          </a>
          <a href="#route-map" className="nav-item">
            <span>⌖</span> Route Planner
          </a>
          <a href="#orders" className="nav-item">
            <span>▤</span> Delivery Queue
          </a>
          <a href="#drivers" className="nav-item">
            <span>♙</span> Driver Fleet
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="system-card">
            <span className="live-dot" />
            <div>
              <strong>System operational</strong>
              <p>C++ route engine</p>
            </div>
          </div>

          <div className="sidebar-footer">
            ROUTEIQ <span>·</span> V1.0
          </div>
        </div>
      </aside>

      <section className="dashboard">
        <header className="topbar">
          <div>
            <div className="eyebrow">CONTROL TOWER / LIVE OPERATIONS</div>
            <h2>Dispatch Overview</h2>
          </div>

          <div className="topbar-right">
            <div className="connection-status">
              <span className="live-dot" />
              API CONNECTED
            </div>

            <button
              className="icon-button"
              onClick={fetchState}
              title="Refresh dashboard"
            >
              ↻
            </button>
          </div>
        </header>

        {message && (
          <div className={`notification ${messageType}`}>
            <span>
              {messageType === "success"
                ? "✓"
                : messageType === "error"
                  ? "!"
                  : "i"}
            </span>
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}

        <div id="overview" className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">TOTAL ORDERS</div>
            <div className="metric-value">{data.metrics.total_orders}</div>
            <div className="metric-foot">All delivery requests</div>
          </div>

          <div className="metric-card">
            <div className="metric-label">ACTIVE DELIVERIES</div>
            <div className="metric-value">{data.metrics.active_orders}</div>
            <div className="metric-foot">
              <span className="metric-accent">●</span> In operation
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">AVAILABLE DRIVERS</div>
            <div className="metric-value">
              {data.metrics.available_drivers}
              <span className="metric-unit">/{data.drivers.length}</span>
            </div>
            <div className="metric-foot">Ready for assignment</div>
          </div>

          <div className="metric-card">
            <div className="metric-label">DELIVERED</div>
            <div className="metric-value">{data.metrics.delivered_orders}</div>
            <div className="metric-foot">Completed orders</div>
          </div>
        </div>

        <div className="main-layout">
          <section id="route-map" className="panel map-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">LIVE GRID / 15 × 15</div>
                <h3>Route Visualization</h3>
              </div>

              <div className="map-heading-actions">
                <button
                  className="small-button"
                  onClick={() => setShowObstacles((value) => !value)}
                >
                  {showObstacles ? "Hide obstacles" : "Show obstacles"}
                </button>
                <button
                  className="small-button"
                  onClick={() => setStops([])}
                  disabled={stops.length === 0}
                >
                  Clear stops
                </button>
              </div>
            </div>

            <div className="map-toolbar">
              <button
                className={
                  mapMode === "origin" ? "mode-button selected" : "mode-button"
                }
                onClick={() => setMapMode("origin")}
              >
                <span className="legend-origin" /> Set origin
              </button>

              <button
                className={
                  mapMode === "destination"
                    ? "mode-button selected"
                    : "mode-button"
                }
                onClick={() => setMapMode("destination")}
              >
                <span className="legend-destination" /> Set destination
              </button>

              <button
                className={
                  mapMode === "stop" ? "mode-button selected" : "mode-button"
                }
                onClick={() => setMapMode("stop")}
              >
                <span className="legend-stop" /> Add Stop
              </button>

              <button
                className={
                  mapMode === "obstacle"
                    ? "mode-button selected"
                    : "mode-button"
                }
                onClick={() => setMapMode("obstacle")}
              >
                <span className="legend-obstacle" /> Edit obstacles
              </button>
            </div>

            <div className="grid-wrapper">
              <div className="grid-axis y-axis">
                {Array.from({ length: GRID_SIZE }, (_, i) => (
                  <span key={i}>{i}</span>
                ))}
              </div>

              {/* Grid cell matrix with relative positioning for SVG vector line alignment */}
              <div className="route-grid" style={{ position: "relative" }}>
                {/* SVG Route Line Overlay */}
                <svg
                  className="route-svg-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    zIndex: 15,
                  }}
                >
                  <defs>
                    <filter
                      id="emeraldLineGlow"
                      x="-20%"
                      y="-20%"
                      width="140%"
                      height="140%"
                    >
                      <feDropShadow
                        dx="0"
                        dy="0"
                        stdDeviation="0.8"
                        floodColor="#10b981"
                      />
                    </filter>
                    <filter
                      id="amberLineGlow"
                      x="-20%"
                      y="-20%"
                      width="140%"
                      height="140%"
                    >
                      <feDropShadow
                        dx="0"
                        dy="0"
                        stdDeviation="0.6"
                        floodColor="#f59e0b"
                      />
                    </filter>
                  </defs>

                  {/* Alternative Route Polyline (Dashed Amber) */}
                  {showAlternative && rawAlternativeRoute.length > 1 && (
                    <polyline
                      points={pointsToSvgPath(rawAlternativeRoute)}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="1.2"
                      strokeDasharray="2.5 1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#amberLineGlow)"
                      opacity="0.85"
                    />
                  )}

                  {/* Shortest Route Polyline: Outer Glow/Underline (Cyan) */}
                  {rawShortestRoute.length > 1 && (
                    <polyline
                      points={pointsToSvgPath(rawShortestRoute)}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity="0.25"
                    />
                  )}

                  {/* Shortest Route Polyline: Main Core Path (Emerald Green) */}
                  {rawShortestRoute.length > 1 && (
                    <polyline
                      points={pointsToSvgPath(rawShortestRoute)}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#emeraldLineGlow)"
                      className="route-animated-path"
                    />
                  )}
                </svg>

                {/* Grid Cells */}
                {Array.from({ length: GRID_SIZE }, (_, y) =>
                  Array.from({ length: GRID_SIZE }, (_, x) => {
                    const point = { x, y };
                    const stopNumber = visitNumber.get(pointKey(point));

                    return (
                      <button
                        key={`${x}-${y}`}
                        className={getCellClass(point)}
                        onClick={() => handleCellClick(point)}
                        title={`(${x}, ${y})`}
                        aria-label={`Grid cell ${x}, ${y}`}
                      >
                        {samePoint(point, origin)
                          ? "O"
                          : samePoint(point, destination)
                            ? "D"
                            : showObstacles &&
                                data.obstacles.some((p) => samePoint(p, point))
                              ? "×"
                              : stopNumber !== undefined
                                ? stopNumber.toString()
                                : ""}
                      </button>
                    );
                  }),
                )}
              </div>
            </div>

            <div className="map-legend">
              <span>
                <i className="legend-origin" /> Origin
              </span>
              <span>
                <i className="legend-destination" /> Destination
              </span>
              <span>
                <i className="legend-route" />{" "}
                {activeStrategy ? activeStrategy.label : "Shortest route"}
              </span>
              <span>
                <i className="legend-alternative" /> Input-order baseline
              </span>
              <span>
                <i className="legend-stop" /> Delivery Stop
              </span>
              <span>
                <i className="legend-obstacle" /> Obstacle
              </span>
            </div>

            <div className="map-coordinates">
              <span>
                ORIGIN: [{origin.x}, {origin.y}]
              </span>
              <span>
                DESTINATION: [{destination.x}, {destination.y}]
              </span>
              <span>STOPS: {stops.length}</span>
              <span>
                GRID: {GRID_SIZE} × {GRID_SIZE}
              </span>
            </div>
          </section>

          <section id="dispatch" className="panel dispatch-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">NEW REQUEST</div>
                <h3>Dispatch Order</h3>
              </div>
              <span className="panel-number">01</span>
            </div>

            <div className="form-section">
              <label>ORIGIN COORDINATES</label>
              <div className="coordinate-inputs">
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={origin.x}
                  onChange={(e) =>
                    setOrigin({
                      ...origin,
                      x: Math.max(0, Math.min(14, Number(e.target.value))),
                    })
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={origin.y}
                  onChange={(e) =>
                    setOrigin({
                      ...origin,
                      y: Math.max(0, Math.min(14, Number(e.target.value))),
                    })
                  }
                />
              </div>
            </div>

            <div className="form-section">
              <label>DESTINATION COORDINATES</label>
              <div className="coordinate-inputs">
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={destination.x}
                  onChange={(e) =>
                    setDestination({
                      ...destination,
                      x: Math.max(0, Math.min(14, Number(e.target.value))),
                    })
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={destination.y}
                  onChange={(e) =>
                    setDestination({
                      ...destination,
                      y: Math.max(0, Math.min(14, Number(e.target.value))),
                    })
                  }
                />
              </div>
            </div>

            <div className="form-section">
              <div className="label-row">
                <label>PAYLOAD WEIGHT</label>
                <strong>{payload} kg</strong>
              </div>

              <input
                className="range-input"
                type="range"
                min={1}
                max={30}
                value={payload}
                onChange={(e) => setPayload(Number(e.target.value))}
              />

              <div className="range-labels">
                <span>1 kg</span>
                <span>30 kg</span>
              </div>
            </div>

            <div className="form-section">
              <label>DELIVERY PRIORITY</label>
              <div className="priority-options">
                {priorities.map((item) => (
                  <button
                    key={item}
                    className={
                      priority === item
                        ? "priority-option active"
                        : "priority-option"
                    }
                    style={
                      {
                        "--priority-color": priorityColor[item],
                      } as React.CSSProperties
                    }
                    onClick={() => setPriority(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="dispatch-summary">
              <div>
                <span>EST. MANHATTAN DISTANCE</span>
                <strong>{estimatedDistance} units</strong>
              </div>
              <div>
                <span>DELIVERY STOPS</span>
                <strong>{stops.length}</strong>
              </div>
              <div>
                <span>PRIORITY</span>
                <strong style={{ color: priorityColor[priority] }}>
                  {priority.toUpperCase()}
                </strong>
              </div>
            </div>

            <button
              className="primary-button"
              onClick={createOrder}
              disabled={loading || samePoint(origin, destination)}
            >
              {loading ? "PROCESSING..." : "＋ CREATE DELIVERY ORDER"}
            </button>

            <button
              className="secondary-button"
              onClick={compareRoutes}
              disabled={loading || samePoint(origin, destination)}
            >
              ⇄ COMPARE ROUTES
            </button>
          </section>
        </div>

        {comparison && (
          <section className="panel comparison-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">
                  C++ ROUTE ENGINE · {comparison.stops_count} STOPS ·{" "}
                  {comparison.stops_source === "active_orders"
                    ? "FROM ACTIVE ORDERS"
                    : "FROM PLANNER"}
                </div>
                <h3>Route Strategy Comparison</h3>
              </div>
              <div className="map-heading-actions">
                <button
                  className="small-button"
                  onClick={() => setShowAlternative((value) => !value)}
                >
                  {showAlternative ? "Hide baseline" : "Show baseline"}
                </button>
                <button
                  className="small-button"
                  onClick={() => setComparison(null)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="comparison-grid">
              <div className="comparison-card shortest">
                <span>
                  {comparison.optimal_known ? "OPTIMAL TOUR" : "BEST KNOWN TOUR"}
                </span>
                <strong>
                  {comparison.best_distance ?? "—"}
                  <small> units</small>
                </strong>
                <p>
                  {comparison.optimal_known
                    ? "Proven optimal by exact search"
                    : "Heuristic: exact search is infeasible at this size"}
                </p>
              </div>

              <div className="comparison-card alternate">
                <span>SAVED VS INPUT ORDER</span>
                <strong>
                  {comparison.savings_vs_input_order ?? 0}
                  <small> units</small>
                </strong>
                <p>
                  Baseline (FIFO):{" "}
                  {comparison.alternative_distance ?? "—"} units
                </p>
              </div>

              <div className="comparison-card recommendation">
                <span>SEARCH SPACE FOR {comparison.stops_count} STOPS</span>
                <strong>
                  {formatCount(comparison.search_space.permutations)} orders
                </strong>
                <p>
                  n! permutations · Held-Karp states:{" "}
                  {formatCount(comparison.search_space.dp_states)}
                </p>
              </div>
            </div>

            <p className="comparison-recommendation">
              {comparison.recommendation}
            </p>

            <div className="orders-table-wrap">
              <table className="orders-table strategy-table">
                <thead>
                  <tr>
                    <th>STRATEGY</th>
                    <th>COMPLEXITY</th>
                    <th>DISTANCE</th>
                    <th>GAP</th>
                    <th>TIME</th>
                    <th>OPERATIONS</th>
                    <th>VISIT ORDER</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.strategies.map((s) => {
                    const isBest =
                      s.distance !== null &&
                      s.distance === comparison.best_distance;
                    const selected = activeStrategy?.key === s.key;
                    return (
                      <tr
                        key={s.key}
                        className={
                          selected ? "strategy-row selected" : "strategy-row"
                        }
                        onClick={() =>
                          s.status === "ok" && setSelectedStrategy(s.key)
                        }
                        title={s.description}
                      >
                        <td>
                          <strong className="strategy-name">{s.label}</strong>
                          <small>{s.family}</small>
                        </td>
                        <td>
                          <code>{s.complexity}</code>
                        </td>
                        <td>
                          {s.status === "ok" ? (
                            <span className={isBest ? "best-value" : ""}>
                              {s.distance} units
                            </span>
                          ) : (
                            <span className="muted-text">
                              {s.status === "skipped"
                                ? "Skipped: too large"
                                : "No route"}
                            </span>
                          )}
                        </td>
                        <td>
                          {s.gap_percent === null
                            ? "—"
                            : s.gap_percent === 0
                              ? comparison.optimal_known
                                ? "optimal"
                                : "best"
                              : `+${s.gap_percent}%`}
                        </td>
                        <td>{s.status === "ok" ? formatMs(s.time_ms) : "—"}</td>
                        <td>
                          {s.status === "ok"
                            ? s.operations.toLocaleString()
                            : "—"}
                        </td>
                        <td className="sequence-cell">
                          {s.status === "ok" ? (
                            <StopSequence stops={s.stop_sequence} />
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="table-hint">
              Click a strategy to draw its route on the map. The dashed line
              is the unoptimised input-order baseline.
            </p>
          </section>
        )}

        <section className="panel comparison-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">
                SCALABILITY · {BENCHMARK_SIZES.join(" / ")} DELIVERY LOCATIONS
              </div>
              <h3>Why Optimal Routing Gets Hard</h3>
            </div>
            <button
              className="small-button"
              onClick={runBenchmark}
              disabled={benchmarkLoading}
            >
              {benchmarkLoading ? "Running..." : "Run benchmark"}
            </button>
          </div>

          {!benchmark && (
            <p className="table-hint">
              Generates random instances with {BENCHMARK_SIZES.join(", ")}{" "}
              stops on an empty grid and solves each with every strategy.
              Exact methods (brute force n!, Held-Karp 2ⁿ·n²) are skipped once
              they become infeasible; heuristics keep scaling but lose the
              optimality guarantee.
            </p>
          )}

          {benchmark && (
            <div className="orders-table-wrap">
              <table className="orders-table strategy-table">
                <thead>
                  <tr>
                    <th>STOPS</th>
                    <th>PERMUTATIONS (n!)</th>
                    <th>DP STATES</th>
                    {benchmark[0]?.strategies.map((s) => (
                      <th key={s.key}>{s.label.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {benchmark.map((row) => (
                    <tr key={row.requested_stops}>
                      <td>
                        <strong className="order-id">{row.stops}</strong>
                      </td>
                      <td>{formatCount(row.search_space.permutations)}</td>
                      <td>{formatCount(row.search_space.dp_states)}</td>
                      {row.strategies.map((s) => (
                        <td key={s.key}>
                          {s.status === "ok" ? (
                            <>
                              <span
                                className={
                                  s.distance === row.best_distance
                                    ? "best-value"
                                    : ""
                                }
                              >
                                {s.distance} u
                                {s.gap_percent ? ` (+${s.gap_percent}%)` : ""}
                              </span>
                              <small>
                                {formatMs(s.time_ms)} ·{" "}
                                {s.operations.toLocaleString()} ops
                              </small>
                            </>
                          ) : (
                            <span className="muted-text">
                              {s.status === "skipped" ? "infeasible" : "no route"}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="orders" className="panel orders-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">DISPATCH MANAGEMENT</div>
              <h3>Delivery Queue</h3>
            </div>

            <button
              className="danger-button"
              onClick={clearOrders}
              disabled={loading || data.orders.length === 0}
            >
              Reset orders
            </button>
          </div>

          <div className="queue-toolbar">
            <input
              className="search-input"
              placeholder="Search order ID or driver..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="Pending">Pending</option>
              <option value="Assigned">Assigned</option>
              <option value="In Transit">In Transit</option>
              <option value="Delivered">Delivered</option>
            </select>
          </div>

          <div className="orders-table-wrap">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>ROUTE</th>
                  <th>PAYLOAD</th>
                  <th>PRIORITY</th>
                  <th>DRIVER</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>

              <tbody>
                {filteredOrders.map((order) => {
                  const action = getAction(order);

                  return (
                    <tr key={order.id}>
                      <td>
                        <strong className="order-id">
                          #{String(order.id).padStart(3, "0")}
                        </strong>
                      </td>

                      <td className="route-column">
                        <RoutePath order={order} />
                        <small>
                          {order.distance ?? "—"} units ·{" "}
                          {(order.stop_sequence ?? order.stops ?? []).length}{" "}
                          stop
                          {(order.stop_sequence ?? order.stops ?? []).length ===
                          1
                            ? ""
                            : "s"}
                        </small>
                      </td>

                      <td>{order.payload} kg</td>

                      <td>
                        <span
                          className="priority-badge"
                          style={{
                            color: priorityColor[order.priority],
                            borderColor: `${priorityColor[order.priority]}55`,
                          }}
                        >
                          {order.priority}
                        </span>
                      </td>

                      <td>
                        {order.driver || (
                          <span className="muted-text">Unassigned</span>
                        )}
                      </td>

                      <td>
                        <span
                          className="status-badge"
                          style={{
                            color: statusColor[order.status],
                            borderColor: `${statusColor[order.status]}55`,
                          }}
                        >
                          <i
                            style={{ background: statusColor[order.status] }}
                          />
                          {order.status}
                        </span>
                      </td>

                      <td>
                        {action ? (
                          <button
                            className={`order-action ${action.className}`}
                            disabled={loading}
                            onClick={() => updateStatus(order, action.next)}
                          >
                            {action.label}
                          </button>
                        ) : (
                          <span className="completed-label">✓ DONE</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No orders found. Create a delivery to populate the queue.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="drivers" className="panel drivers-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">FLEET MONITORING</div>
              <h3>Driver Availability</h3>
            </div>
            <span className="panel-number">03</span>
          </div>

          <div className="drivers-grid">
            {data.drivers.map((driver) => {
              const assignedOrder = data.orders.find(
                (order) => order.id === driver.current_order,
              );

              return (
                <div className="driver-card" key={driver.id}>
                  <div className="driver-avatar">
                    {driver.name
                      .split(" ")
                      .map((word) => word[0])
                      .join("")}
                  </div>

                  <div className="driver-info">
                    <strong>{driver.name}</strong>
                    <span>CAPACITY · {driver.capacity} KG</span>
                    <span>
                      {assignedOrder
                        ? `ORDER #${String(assignedOrder.id).padStart(3, "0")}`
                        : "NO ACTIVE ORDER"}
                    </span>
                  </div>

                  <span
                    className={
                      driver.available
                        ? "driver-status available"
                        : "driver-status busy"
                    }
                  >
                    {driver.available ? "AVAILABLE" : "BUSY"}
                  </span>
                </div>
              );
            })}

            {data.drivers.length === 0 && (
              <div className="empty-state">No driver data available.</div>
            )}
          </div>
        </section>

        <footer className="dashboard-footer">
          <span>ROUTEIQ DISPATCH INTELLIGENCE</span>
          <span>DIJKSTRA · GREEDY ASSIGNMENT · PRIORITY QUEUE</span>
          <span>{loadingState ? "SYNCING..." : "SYSTEM READY"}</span>
        </footer>
      </section>
    </main>
  );
}

// Origin → each stop in visiting order → destination
function RoutePath({ order }: { order: Order }) {
  const sequence = order.stop_sequence ?? order.stops ?? [];
  return (
    <div className="route-cell-text route-path">
      <span className="route-node origin" title="Origin">
        O ({order.origin.x},{order.origin.y})
      </span>
      {sequence.map((stop, i) => (
        <span key={`${stop.x}-${stop.y}-${i}`} className="route-step">
          <span className="route-arrow">→</span>
          <span className="route-node stop" title={`Stop ${i + 1}`}>
            {i + 1} ({stop.x},{stop.y})
          </span>
        </span>
      ))}
      <span className="route-step">
        <span className="route-arrow">→</span>
        <span className="route-node destination" title="Destination">
          D ({order.destination.x},{order.destination.y})
        </span>
      </span>
    </div>
  );
}

function StopSequence({ stops }: { stops: Point[] }) {
  if (stops.length === 0) return <span className="muted-text">Direct</span>;
  return (
    <div className="route-cell-text route-path">
      {stops.map((stop, i) => (
        <span key={`${stop.x}-${stop.y}-${i}`} className="route-step">
          {i > 0 && <span className="route-arrow">→</span>}
          <span className="route-node stop">
            ({stop.x},{stop.y})
          </span>
        </span>
      ))}
    </div>
  );
}