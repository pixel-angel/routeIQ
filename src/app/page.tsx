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

type RouteComparison = {
  shortest_route: Point[];
  shortest_distance: number | null;
  alternative_route: Point[];
  alternative_distance: number | null;
  distance_difference: number | null;
  recommendation: string;
};

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
      setShowAlternative(true);

      notify("Route comparison completed.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Route comparison failed.",
        "error",
      );
    } finally {
      setLoading(false);
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

  const shortestPath = useMemo(() => {
    const path =
      comparison?.shortest_route ??
      data.orders.find(
        (order) =>
          samePoint(order.origin, origin) &&
          samePoint(order.destination, destination) &&
          order.status !== "Delivered",
      )?.route ??
      [];

    return new Set(path.map(pointKey));
  }, [comparison, data.orders, origin, destination]);

  const alternativePath = useMemo(
    () => new Set((comparison?.alternative_route ?? []).map(pointKey)),
    [comparison],
  );

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

    if (stops.some((p) => samePoint(p, point))) {
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

              <div className="route-grid">
                {Array.from({ length: GRID_SIZE }, (_, y) =>
                  Array.from({ length: GRID_SIZE }, (_, x) => {
                    const point = { x, y };
                    const stopIdx = stops.findIndex((p) => samePoint(p, point));

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
                              : stopIdx !== -1
                                ? (stopIdx + 1).toString()
                                : showAlternative &&
                                    alternativePath.has(pointKey(point))
                                  ? "·"
                                  : shortestPath.has(pointKey(point))
                                    ? "·"
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
                <i className="legend-route" /> Shortest route
              </span>
              <span>
                <i className="legend-alternative" /> Alternative
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
                <div className="eyebrow">C++ ROUTE ENGINE</div>
                <h3>Route Comparison</h3>
              </div>
              <button
                className="small-button"
                onClick={() => setComparison(null)}
              >
                Close
              </button>
            </div>

            <div className="comparison-grid">
              <div className="comparison-card shortest">
                <span>SHORTEST ROUTE</span>
                <strong>
                  {comparison.shortest_distance ?? "—"}
                  <small> units</small>
                </strong>
                <p>Optimized path using Dijkstra</p>
              </div>

              <div className="comparison-card alternate">
                <span>ALTERNATIVE ROUTE</span>
                <strong>
                  {comparison.alternative_distance ?? "—"}
                  <small> units</small>
                </strong>
                <p>
                  {comparison.alternative_distance === null
                    ? "No alternate route found"
                    : `${comparison.distance_difference ?? 0} units difference`}
                </p>
              </div>

              <div className="comparison-card recommendation">
                <span>RECOMMENDATION</span>
                <strong>{comparison.recommendation}</strong>
                <button
                  className="small-button"
                  onClick={() => setShowAlternative((value) => !value)}
                >
                  {showAlternative
                    ? "Show shortest route"
                    : "Show alternate route"}
                </button>
              </div>
            </div>
          </section>
        )}

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

                      <td>
                        <div className="route-cell-text">
                          <span>
                            {order.origin.x},{order.origin.y}
                          </span>
                          <span className="route-arrow">→</span>
                          <span>
                            {order.destination.x},{order.destination.y}
                          </span>
                        </div>
                        <small>{order.distance ?? "—"} units</small>
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
