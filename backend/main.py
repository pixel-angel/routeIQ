from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
from pathlib import Path
import subprocess
import heapq
import time
import random

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
    stop_counts: list[int] = Field(default=[5, 10, 15, 20])


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
    """Unique destinations for active orders, sorted by urgency then order ID."""
    active = [
        order for order in orders
        if order["id"] != exclude_order_id
        and order["status"] in ["Pending", "Assigned", "In Transit"]
    ]
    active.sort(key=lambda order: (PRIORITY_RANK[order["priority"]], order["id"]))

    stops = []
    seen = set()
    for order in active:
        destination = order["destination"]
        key = point_key(destination)
        if key not in seen:
            seen.add(key)
            stops.append(destination)
    return stops


def run_cpp_algorithm(origin, destination, stops=None):
    """Pass start, endpoint, intermediate order stops and obstacles to C++."""
    origin = point_dict(origin)
    destination = point_dict(destination)
    stops = [point_dict(stop) for stop in (stops or [])]

    # Exclude duplicate stops and endpoints
    seen = {point_key(origin), point_key(destination)}
    filtered_stops = []
    for stop in stops:
        key = point_key(stop)
        if key not in seen:
            seen.add(key)
            filtered_stops.append(stop)

    lines = [
        f"{origin['x']} {origin['y']}",
        f"{destination['x']} {destination['y']}",
        str(len(filtered_stops)),
    ]
    lines.extend(f"{stop['x']} {stop['y']}" for stop in filtered_stops)
    lines.append(str(len(obstacles)))
    lines.extend(f"{x} {y}" for x, y in sorted(obstacles))
    input_data = "\n".join(lines) + "\n"

    if not ALGORITHM_EXECUTABLE.exists():
        raise HTTPException(
            status_code=500,
            detail="Compiled route algorithm binary not found. Compile backend/algorithm.cpp first.",
        )

    try:
        result = subprocess.run(
            [str(ALGORITHM_EXECUTABLE)],
            input=input_data,
            text=True,
            capture_output=True,
            check=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="C++ route algorithm timed out.")
    except subprocess.CalledProcessError as error:
        raise HTTPException(
            status_code=500,
            detail=error.stderr.strip() or "C++ route algorithm failed.",
        )

    output = result.stdout.split()
    index = 0
    routes = []

    try:
        for _ in range(2):
            if index >= len(output):
                routes.append([])
                continue

            count = int(output[index])
            index += 1
            route = []

            for _ in range(count):
                x = int(output[index])
                y = int(output[index + 1])
                index += 2
                route.append({"x": x, "y": y})

            routes.append(route)
    except (ValueError, IndexError):
        raise HTTPException(status_code=500, detail="Invalid output from C++ route algorithm.")

    shortest = routes[0] if routes else []
    alternative = routes[1] if len(routes) > 1 else []

    return {
        "shortest_route": shortest,
        "alternative_route": alternative,
        "shortest_distance": len(shortest) - 1 if shortest else None,
        "alternative_distance": len(alternative) - 1 if alternative else None,
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
    origin = request.origin.model_dump()
    destination = request.destination.model_dump()

    stops = [stop.model_dump() for stop in request.stops]
    if not stops:
        stops = collect_active_order_stops()

    result = run_cpp_algorithm(origin, destination, stops)

    if not result["shortest_route"]:
        raise HTTPException(status_code=404, detail="No valid route found through all delivery stops.")

    shortest_distance = result["shortest_distance"]
    alternative_distance = result["alternative_distance"]

    difference = (
        alternative_distance - shortest_distance
        if alternative_distance is not None and shortest_distance is not None
        else None
    )

    return {
        **result,
        "stops": stops,
        "stops_count": len(stops),
        "distance_difference": difference,
        "recommendation": (
            "Shortest route is optimal"
            if result["alternative_route"]
            else "No alternate route available"
        ),
    }


# --------------------------------------------------
# SCALABILITY / BENCHMARK ENDPOINT
# --------------------------------------------------

@app.post("/api/benchmark")
def run_benchmark(request: BenchmarkRequest):
    """
    Benchmarks TSP computation time across various stop counts.
    Demonstrates NP-hard scaling (DP for small N vs Heuristics for large N).
    """
    benchmarks = []
    origin = {"x": 0, "y": 0}
    destination = {"x": 14, "y": 14}

    for count in request.stop_counts:
        # Generate random unique stop points
        sample_stops = []
        occupied = {(0, 0), (14, 14)} | obstacles

        while len(sample_stops) < min(count, 50):
            p = (random.randint(0, 14), random.randint(0, 14))
            if p not in occupied:
                occupied.add(p)
                sample_stops.append({"x": p[0], "y": p[1]})

        start_time = time.perf_counter()
        result = run_cpp_algorithm(origin, destination, sample_stops)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        benchmarks.append({
            "stops": len(sample_stops),
            "algorithm": "Bitmask DP" if len(sample_stops) <= 12 else "2-Opt Heuristic",
            "distance": result["shortest_distance"],
            "execution_time_ms": duration_ms,
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