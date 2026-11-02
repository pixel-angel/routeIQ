from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import subprocess
import time

app = FastAPI()

class Location(BaseModel):
    id: str
    x: int
    y: int
    weight: int
    priority: int

class RouteRequest(BaseModel):
    max_weight: int
    locations: list[Location]
    
# Inside optimize_route(): Format data for C++ -> [max_weight] \n [N] \n [id x y w p]

@app.post("/api/optimize")
async def optimize_route(req: RouteRequest):
    if not req.locations:
        raise HTTPException(status_code=400, detail="Locations array cannot be empty")

    # Format input strictly for the C++ cin stream: [N] \n [id] [x] [y] ...
    input_data = f"{len(req.locations)}\n"
    for loc in req.locations:
        input_data += f"{loc.id} {loc.x} {loc.y}\n"
        
    start_time = time.perf_counter()
    
    try:
        # Execute the compiled C++ binary
        process = subprocess.run(
            ['./optimizer'], 
            input=input_data.encode(), 
            capture_output=True,
            check=True
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail="C++ Engine failure")
        
    execution_time_ms = (time.perf_counter() - start_time) * 1000
    
    # Parse the space-separated stdout back into a Python list
    optimized_path = process.stdout.decode().strip().split(" ")
    
    # Filter out any empty strings resulting from trailing spaces
    optimized_path = [node for node in optimized_path if node]
    
    return {
        "optimized_route": optimized_path,
        "execution_time_ms": round(execution_time_ms, 3)
    }