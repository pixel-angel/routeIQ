from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
from pathlib import Path
import subprocess
import heapq
import time
import random
import math

app = FastAPI(title="RouteIQ API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

GRID_SIZE = 15
BASE_DIR = Path(__file__).resolve().parent

# Check for Windows .exe or POSIX executable binary
if (BASE_DIR / "algorithm.exe").exists():
    ALGORITHM_EXECUTABLE = BASE_DIR / "algorithm.exe"
else:
    ALGORITHM_EXECUTABLE = BASE_DIR / "algorithm"

# --------------------------------------------------
# MODELS
# --------------------------------------------------

class Point(BaseModel):
    x: int = Field(ge=0, lt=GRID_SIZE)
    y: int = Field(ge=0, lt=GRID_SIZE)


class CreateOrderRequest(BaseModel):
    origin: Point
    destination: Point
    stops: list[Point] = Field(default_factory=list)
    payload: int = Field(gt=0)
    priority: Literal["Low", "Medium", "High", "Critical"]


class ObstacleRequest(BaseModel):
    cells: list[Point]


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    stops: list[Point] = Field(default_factory=list)


class BenchmarkRequest(BaseModel):
    stop_counts: list[int] = Field(default=[5, 10, 50, 100])


# --------------------------------------------------
# IN-MEMORY DATA STORE
# --------------------------------------------------

drivers = [
    {"id": 1, "name": "Aarav Mehta", "capacity": 25, "available": True, "current_order": None},
    {"id": 2, "name": "Isha Verma", "capacity": 18, "available": True, "current_order": None},
    {"id": 3, "name": "Kabir Rao", "capacity": 30, "available": True, "current_order": None},
]

orders = []
obstacles: set[tuple[int, int]] = set()
next_order_id = 1

PRIORITY_RANK = {"Critical": 1, "High": 2, "Medium": 3, "Low": 4}


# --------------------------------------------------
# HELPERS
# --------------------------------------------------

def point_dict(point):
    if isinstance(point, Point):
        return point.model_dump()
    return {"x": int(point["x"]), "y": int(point["y"])}


def point_key(point):
    point = point_dict(point)
    return (point["x"], point["y"])


def collect_active_order_stops(exclude_order_id=None):
    """Every delivery point (intermediate stops + destination) of active orders,
    sorted by urgency then order ID."""
    active = [
        order for order in orders
        if order["id"] != exclude_order_id
        and order["status"] in ["Pending", "Assigned", "In Transit"]
    ]
    active.sort(key=lambda order: (PRIORITY_RANK[order["priority"]], order["id"]))

    stops = []
    seen = set()
    for order in active:
        points = order.get("stop_sequence") or order.get("stops", [])
        for point in [*points, order["destination"]]:
            key = point_key(point)
            if key not in seen:
                seen.add(key)
                stops.append(point_dict(point))
    return stops


def dedupe_stops(origin, destination, stops):
    """Drop stops that repeat each other or coincide with the origin/destination."""
    seen = {point_key(origin), point_key(destination)}
    filtered = []
    for stop in stops:
        key = point_key(stop)
        if key not in seen:
            seen.add(key)
            filtered.append(point_dict(stop))
    return filtered


def call_engine(origin, destination, stops, mode="route", blocked=None):
    """Run the C++ engine and return its stdout tokens."""
    blocked = obstacles if blocked is None else blocked
    lines = [
        f"{origin['x']} {origin['y']}",
        f"{destination['x']} {destination['y']}",
        str(len(stops)),
    ]
    lines.extend(f"{stop['x']} {stop['y']}" for stop in stops)
    lines.append(str(len(blocked)))
    lines.extend(f"{x} {y}" for x, y in sorted(blocked))
    input_data = "\n".join(lines) + "\n"

    if not ALGORITHM_EXECUTABLE.exists():
        raise HTTPException(
            status_code=500,
            detail="Compiled route algorithm binary not found. Compile backend/algorithm.cpp first.",
        )

    args = [str(ALGORITHM_EXECUTABLE)]
    if mode != "route":
        args.append(mode)

    try:
        result = subprocess.run(
            args,
            input=input_data,
            text=True,
            capture_output=True,
            check=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="C++ route algorithm timed out.")
    except subprocess.CalledProcessError as error:
        raise HTTPException(
            status_code=500,
            detail=error.stderr.strip() or "C++ route algorithm failed.",
        )
    return result.stdout.split()


class TokenReader:
    def __init__(self, tokens):
        self.tokens = tokens
        self.index = 0

    def done(self):
        return self.index >= len(self.tokens)

    def next(self):
        value = self.tokens[self.index]
        self.index += 1
        return value

    def int(self):
        return int(self.next())

    def path(self):
        if self.done():
            return []
        return [{"x": self.int(), "y": self.int()} for _ in range(self.int())]

    def order(self):
        if self.done():
            return []
        return [self.int() for _ in range(self.int())]


def run_cpp_algorithm(origin, destination, stops=None):
    """Plan the best route origin -> all stops -> destination (Dijkstra + DP / 2-opt)."""
    origin = point_dict(origin)
    destination = point_dict(destination)
    filtered_stops = dedupe_stops(origin, destination, stops or [])

    reader = TokenReader(call_engine(origin, destination, filtered_stops))
    try:
        shortest = reader.path()
        alternative = reader.path()
        visit_order = reader.order()
    except (ValueError, IndexError):
        raise HTTPException(status_code=500, detail="Invalid output from C++ route algorithm.")

    return {
        "shortest_route": shortest,
        "alternative_route": alternative,
        "shortest_distance": len(shortest) - 1 if shortest else None,
        "alternative_distance": len(alternative) - 1 if alternative else None,
        # Stops in the order the driver actually visits them
        "stop_sequence": [filtered_stops[i] for i in visit_order if 0 <= i < len(filtered_stops)],
    }


STRATEGY_INFO = {
    "input_order": {
        "label": "Input order (FIFO)",
        "family": "Baseline",
        "complexity": "O(n)",
        "description": "Visits stops in the order they were queued. No optimisation.",
    },
    "nearest_neighbor": {
        "label": "Greedy nearest neighbour",
        "family": "Greedy heuristic",
        "complexity": "O(n²)",
        "description": "Always drives to the closest unvisited stop. Fast but can be short-sighted.",
    },
    "two_opt": {
        "label": "2-opt + Or-opt local search",
        "family": "TSP heuristic",
        "complexity": "O(k·n³)",
        "description": "Starts from the greedy tour, then reverses segments and relocates stop chains while that shortens it.",
    },
    "held_karp": {
        "label": "Held-Karp bitmask DP",
        "family": "Dynamic programming (exact)",
        "complexity": "O(2ⁿ·n²)",
        "description": "Guaranteed optimal. Memory and time double with every extra stop.",
    },
    "brute_force": {
        "label": "Brute force permutations",
        "family": "Exhaustive search (exact)",
        "complexity": "O(n!)",
        "description": "Tries every possible visiting order. Only feasible for a handful of stops.",
    },
}
EXACT_STRATEGIES = {"held_karp", "brute_force"}


def run_cpp_comparison(origin, destination, stops, blocked=None):
    """Run every routing strategy on the same instance and score them against each other."""
    origin = point_dict(origin)
    destination = point_dict(destination)
    filtered_stops = dedupe_stops(origin, destination, stops)

    reader = TokenReader(call_engine(origin, destination, filtered_stops, "compare", blocked))
    strategies = []
    try:
        while not reader.done():
            if reader.next() != "STRATEGY":
                raise ValueError("expected STRATEGY")
            key = reader.next()
            status = reader.next()
            distance = reader.int()
            time_ns = reader.int()
            work = reader.int()
            order = reader.order()
            route = reader.path()
            strategies.append({
                "key": key,
                **STRATEGY_INFO.get(key, {"label": key}),
                "status": status,
                "exact": key in EXACT_STRATEGIES,
                "distance": distance if status == "ok" else None,
                "time_ms": round(time_ns / 1e6, 4),
                "operations": work,
                "stop_sequence": [filtered_stops[i] for i in order if 0 <= i < len(filtered_stops)],
                "route": route,
            })
    except (ValueError, IndexError):
        raise HTTPException(status_code=500, detail="Invalid output from C++ comparison engine.")

    solved = [s for s in strategies if s["distance"] is not None]
    exact = [s for s in solved if s["exact"]]
    best_distance = min((s["distance"] for s in solved), default=None)
    optimal_known = bool(exact) or len(filtered_stops) <= 1

    for s in strategies:
        s["gap_percent"] = (
            round((s["distance"] - best_distance) / best_distance * 100, 1)
            if s["distance"] is not None and best_distance
            else (0.0 if s["distance"] is not None else None)
        )

    return filtered_stops, strategies, best_distance, optimal_known


def search_space(n):
    """Size of the problem each exact method has to explore for n stops."""
    return {
        "permutations": str(math.factorial(n)) if n <= 20 else f"{math.factorial(n):.2e}",
        "dp_states": (2 ** n) * n * n if n <= 30 else f"{float(2 ** n) * n * n:.2e}",
    }


# --------------------------------------------------
# DRIVER MANAGEMENT
# --------------------------------------------------

def assign_driver(payload):
    """Greedy best-fit: smallest available capacity >= payload."""
    eligible = [
        driver for driver in drivers
        if driver["available"] and driver["capacity"] >= payload
    ]
    if not eligible:
        return None

    eligible.sort(key=lambda driver: driver["capacity"])
    selected = eligible[0]
    selected["available"] = False
    return selected


def release_driver(driver_id):
    for driver in drivers:
        if driver["id"] == driver_id:
            driver["available"] = True
            driver["current_order"] = None
            return


# --------------------------------------------------
# HEALTH & STATE
# --------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "running",
        "service": "RouteIQ",
        "algorithm": "C++ Dijkstra + Bitmask DP / 2-Opt Heuristics",
    }


@app.get("/api/state")
def get_state():
    priority_queue = []
    order_lookup = {order["id"]: order for order in orders}

    for order in orders:
        if order["status"] in ["Pending", "Assigned", "In Transit"]:
            heapq.heappush(
                priority_queue,
                (PRIORITY_RANK[order["priority"]], order["id"]),
            )

    sorted_active_orders = []
    while priority_queue:
        _, order_id = heapq.heappop(priority_queue)
        if order_id in order_lookup:
            sorted_active_orders.append(order_lookup[order_id])

    delivered = [order for order in orders if order["status"] == "Delivered"]
    active = [order for order in orders if order["status"] != "Delivered"]

    return {
        "orders": sorted_active_orders + delivered,
        "drivers": drivers,
        "obstacles": [{"x": x, "y": y} for x, y in sorted(obstacles)],
        "metrics": {
            "total_orders": len(orders),
            "active_orders": len(active),
            "delivered_orders": len(delivered),
            "available_drivers": sum(driver["available"] for driver in drivers),
        },
    }


# --------------------------------------------------
# CREATE ORDER
# --------------------------------------------------

@app.post("/api/orders")
def create_order(request: CreateOrderRequest):
    global next_order_id

    origin = request.origin.model_dump()
    destination = request.destination.model_dump()
    stops = [stop.model_dump() for stop in request.stops]

    if origin == destination:
        raise HTTPException(status_code=400, detail="Origin and destination cannot be the same.")

    if point_key(origin) in obstacles or point_key(destination) in obstacles:
        raise HTTPException(status_code=400, detail="Origin or destination is blocked by an obstacle.")

    if any(point_key(stop) in obstacles for stop in stops):
        raise HTTPException(status_code=400, detail="One or more stops are blocked by an obstacle.")

    route_result = run_cpp_algorithm(origin, destination, stops)
    shortest_route = route_result["shortest_route"]

    if not shortest_route:
        raise HTTPException(status_code=400, detail="No valid route exists for this delivery.")

    driver = assign_driver(request.payload)
    if driver:
        status = "Assigned"
        driver_name = driver["name"]
        driver_id = driver["id"]
    else:
        status = "Pending"
        driver_name = None
        driver_id = None

    order = {
        "id": next_order_id,
        "origin": origin,
        "destination": destination,
        "stops": stops,
        "payload": request.payload,
        "priority": request.priority,
        "status": status,
        "driver": driver_name,
        "driver_id": driver_id,
        "distance": route_result["shortest_distance"],
        "route": shortest_route,
        "stop_sequence": route_result["stop_sequence"],
        "created_at": next_order_id,
    }

    if driver:
        driver["current_order"] = next_order_id

    orders.append(order)
    next_order_id += 1
    return order


# --------------------------------------------------
# GREEDY AUTO-DISPATCH (FLEET ASSIGNMENT)
# --------------------------------------------------

@app.post("/api/dispatch/auto-assign")
def auto_assign_orders():
    """
    Assign pending orders using priority ranking (Critical -> High -> Medium -> Low).
    Matches each order with the best available driver capacity.
    """
    pending = [o for o in orders if o["status"] == "Pending"]
    if not pending:
        return {"message": "No pending orders to assign.", "assigned_count": 0}

    # Sort orders by urgency first, then payload size
    pending.sort(key=lambda o: (PRIORITY_RANK[o["priority"]], -o["payload"]))

    assigned_count = 0
    for order in pending:
        driver = assign_driver(order["payload"])
        if driver:
            order["status"] = "Assigned"
            order["driver"] = driver["name"]
            order["driver_id"] = driver["id"]
            driver["current_order"] = order["id"]
            assigned_count += 1

    return {
        "message": f"Successfully auto-assigned {assigned_count} orders via greedy dispatch.",
        "assigned_count": assigned_count,
    }


# --------------------------------------------------
# ROUTE CALCULATION & COMPARISON
# --------------------------------------------------

@app.post("/api/route")
def calculate_route(request: RouteRequest):
    origin = request.origin.model_dump()
    destination = request.destination.model_dump()

    stops = [stop.model_dump() for stop in request.stops]
    if not stops:
        stops = collect_active_order_stops()

    result = run_cpp_algorithm(origin, destination, stops)

    if not result["shortest_route"]:
        raise HTTPException(status_code=404, detail="No route found through all delivery stops.")

    return {
        **result,
        "stops": stops,
        "stops_count": len(stops),
    }


@app.post("/api/route/compare")
def compare_routes(request: RouteRequest):
    """
    Solve the same delivery instance with every strategy (baseline, greedy,
    2-opt, Held-Karp DP, brute force) and compare distance, runtime and work.
    """
    origin = request.origin.model_dump()
    destination = request.destination.model_dump()

    stops = [stop.model_dump() for stop in request.stops]
    source = "planner"
    if not stops:
        stops = collect_active_order_stops()
        source = "active_orders"

    filtered_stops, strategies, best_distance, optimal_known = run_cpp_comparison(
        origin, destination, stops
    )

    if best_distance is None:
        raise HTTPException(status_code=404, detail="No valid route found through all delivery stops.")

    solved = [s for s in strategies if s["distance"] is not None]
    # Best = shortest distance; ties go to the fastest strategy
    best = min(solved, key=lambda s: (s["distance"], s["time_ms"]))
    baseline = next((s for s in strategies if s["key"] == "input_order"), None)
    savings = (
        baseline["distance"] - best["distance"]
        if baseline and baseline["distance"] is not None
        else None
    )

    n = len(filtered_stops)
    if n == 0:
        recommendation = "No delivery stops: direct Dijkstra shortest path is optimal."
    elif optimal_known:
        recommendation = (
            f"{best['label']} gives the optimal tour of {best['distance']} units"
            + (f", saving {savings} units vs input order." if savings else ".")
        )
    else:
        recommendation = (
            f"{n} stops is too many for exact search; {best['label']} is the best "
            f"heuristic tour ({best['distance']} units)"
            + (f", saving {savings} units vs input order." if savings else ".")
        )

    return {
        "stops": filtered_stops,
        "stops_count": n,
        "stops_source": source,
        "strategies": strategies,
        "best_strategy": best["key"],
        "best_distance": best_distance,
        "optimal_known": optimal_known,
        "savings_vs_input_order": savings,
        "search_space": search_space(n),
        "recommendation": recommendation,
        # Map overlay: optimised route vs the naive (input order) route
        "shortest_route": best["route"],
        "shortest_distance": best["distance"],
        "alternative_route": baseline["route"] if baseline else [],
        "alternative_distance": baseline["distance"] if baseline else None,
        "distance_difference": savings,
    }


# --------------------------------------------------
# SCALABILITY / BENCHMARK ENDPOINT
# --------------------------------------------------

@app.post("/api/benchmark")
def run_benchmark(request: BenchmarkRequest):
    """
    Generate random instances with 5, 10, 50, 100... delivery locations and run
    every strategy on each, showing how exact methods blow up (n!, 2^n * n^2)
    while heuristics stay fast but lose the optimality guarantee.
    Benchmarks run on an obstacle-free grid so every random instance is solvable.
    """
    origin = {"x": 0, "y": 0}
    destination = {"x": GRID_SIZE - 1, "y": GRID_SIZE - 1}
    free_cells = [
        (x, y)
        for x in range(GRID_SIZE)
        for y in range(GRID_SIZE)
        if (x, y) not in {(0, 0), (GRID_SIZE - 1, GRID_SIZE - 1)}
    ]

    rng = random.Random()
    benchmarks = []
    for requested in request.stop_counts:
        count = max(0, min(requested, len(free_cells)))
        sample = [{"x": x, "y": y} for x, y in rng.sample(free_cells, count)]

        start_time = time.perf_counter()
        _, strategies, best_distance, optimal_known = run_cpp_comparison(
            origin, destination, sample, blocked=set()
        )
        total_ms = round((time.perf_counter() - start_time) * 1000, 2)

        benchmarks.append({
            "stops": count,
            "requested_stops": requested,
            "best_distance": best_distance,
            "optimal_known": optimal_known,
            "search_space": search_space(count),
            "total_ms": total_ms,
            "strategies": [
                {key: s[key] for key in (
                    "key", "label", "status", "distance", "time_ms", "operations", "gap_percent", "exact"
                )}
                for s in strategies
            ],
        })

    return {"benchmarks": benchmarks}


# --------------------------------------------------
# UPDATE STATUS & LIFECYCLE
# --------------------------------------------------

@app.patch("/api/orders/{order_id}/status")
def update_order_status(
    order_id: int,
    status: Literal["Pending", "Assigned", "In Transit", "Delivered"],
):
    order = next((item for item in orders if item["id"] == order_id), None)

    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    allowed_transitions = {
        "Pending": ["Assigned"],
        "Assigned": ["In Transit"],
        "In Transit": ["Delivered"],
        "Delivered": [],
    }

    current_status = order["status"]
    if status not in allowed_transitions[current_status]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transition: {current_status} -> {status}",
        )

    if status == "Assigned":
        driver = assign_driver(order["payload"])
        if not driver:
            raise HTTPException(status_code=400, detail="No available driver with sufficient capacity.")

        order["driver"] = driver["name"]
        order["driver_id"] = driver["id"]
        driver["current_order"] = order_id

    if status == "Delivered" and order["driver_id"] is not None:
        release_driver(order["driver_id"])

    order["status"] = status
    return order


# --------------------------------------------------
# OBSTACLE MANAGEMENT
# --------------------------------------------------

@app.post("/api/obstacles")
def update_obstacles(request: ObstacleRequest):
    new_obstacles = {(cell.x, cell.y) for cell in request.cells}

    for order in orders:
        if order["status"] in ["Assigned", "In Transit"]:
            order_stops = order.get("stops", [])
            if (
                point_key(order["origin"]) in new_obstacles
                or point_key(order["destination"]) in new_obstacles
                or any(point_key(stop) in new_obstacles for stop in order_stops)
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Cannot block an active order's origin, destination, or delivery stops.",
                )

    obstacles.clear()
    obstacles.update(new_obstacles)

    for order in orders:
        if order["status"] in ["Pending", "Assigned"]:
            result = run_cpp_algorithm(order["origin"], order["destination"], order.get("stops", []))
            if not result["shortest_route"]:
                order["route"] = []
                order["distance"] = None
            else:
                order["route"] = result["shortest_route"]
                order["distance"] = result["shortest_distance"]
                order["stop_sequence"] = result["stop_sequence"]

    return {
        "message": "Obstacles updated.",
        "obstacles": [{"x": x, "y": y} for x, y in sorted(obstacles)],
    }


# --------------------------------------------------
# RESET ORDERS
# --------------------------------------------------

@app.delete("/api/orders")
def clear_orders():
    global next_order_id

    orders.clear()
    next_order_id = 1

    for driver in drivers:
        driver["available"] = True
        driver["current_order"] = None

    return {"message": "All orders cleared and driver fleet reset.", "orders": []}