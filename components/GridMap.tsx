"use client";
import React, { useState, useRef, useEffect } from "react";

// Grid Configuration (A-O, 15-1 to match the PDF layout)
const COLS = Array.from({ length: 15 }, (_, i) => String.fromCharCode(65 + i)); // ['A', 'B', ..., 'O']
const ROWS = Array.from({ length: 15 }, (_, i) => 15 - i); // [15, 14, ..., 1]

export default function GridMap() {
  const [depot, setDepot] = useState<string | null>("A1");
  const [stops, setStops] = useState<Set<string>>(new Set(["D3", "H15", "M9"]));
  const [route, setRoute] = useState<string[]>([]);
  const [svgPoints, setSvgPoints] = useState<string>("");

  const gridRef = useRef<HTMLDivElement>(null);

  // Toggle stops on grid click
  const handleCellClick = (id: string) => {
    if (id === depot) return; // Can't remove the depot
    setStops((prev) => {
      const newStops = new Set(prev);
      if (newStops.has(id)) newStops.delete(id);
      else newStops.add(id);
      return newStops;
    });
  };

  // Calculate absolute X/Y coordinates for the SVG path whenever the route changes
  useEffect(() => {
    if (route.length === 0 || !gridRef.current) {
      setSvgPoints("");
      return;
    }

    const gridRect = gridRef.current.getBoundingClientRect();

    const points = route
      .map((id) => {
        const cell = document.getElementById(`cell-${id}`);
        if (!cell) return null;

        const rect = cell.getBoundingClientRect();
        // Calculate center of the cell relative to the grid container
        const x = rect.left - gridRect.left + rect.width / 2;
        const y = rect.top - gridRect.top + rect.height / 2;

        return `${x},${y}`;
      })
      .filter(Boolean)
      .join(" ");

    setSvgPoints(points);
  }, [route]);

  // Dummy API call to simulate connecting to Member 2 & 3
  const handleOptimize = async () => {
    // In reality, this posts to Member 3's API.
    // We simulate the C++ engine returning a sorted array here.
    const simulatedEngineResponse = [depot, ...Array.from(stops), depot];
    setRoute(simulatedEngineResponse as string[]);
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 min-h-screen bg-[#064e3b] text-white font-sans">
      {/* LEFT PANEL: Controls */}
      <div className="w-full md:w-1/4 space-y-6">
        <div className="bg-[#0f766e] p-5 rounded-xl shadow-lg border border-teal-600">
          <h2 className="text-xl font-bold text-teal-50 tracking-wide mb-4">
            DISPATCH DESK
          </h2>
          <p className="text-sm text-teal-200 mb-4">
            Total Stops: {stops.size}
          </p>

          <button
            onClick={handleOptimize}
            className="w-full py-3 bg-[#a3e635] hover:bg-[#84cc16] text-teal-950 font-bold rounded shadow-[0_0_15px_rgba(163,230,53,0.4)] transition-all"
          >
            OPTIMIZE ROUTE
          </button>

          <button
            onClick={() => setRoute([])}
            className="w-full py-2 mt-3 bg-teal-800 hover:bg-teal-700 text-teal-100 font-semibold rounded transition-all"
          >
            CLEAR ROUTE
          </button>
        </div>
      </div>

      {/* CENTER PANEL: The 15x15 Grid */}
      <div className="w-full md:w-3/4 flex justify-center items-start">
        <div
          ref={gridRef}
          className="relative w-full max-w-3xl aspect-square bg-[#022c22] p-4 rounded-xl shadow-2xl border border-teal-800"
        >
          {/* SVG OVERLAY (Invisible but holds the drawing) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
            {svgPoints && (
              <polyline
                points={svgPoints}
                fill="none"
                className="stroke-[#a3e635] stroke-[3px] drop-shadow-[0_0_8px_rgba(163,230,53,0.8)] path-anim"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* CSS GRID */}
          <div className="w-full h-full grid grid-cols-15 gap-1 relative z-0">
            {ROWS.map((row) =>
              COLS.map((col) => {
                const id = `${col}${row}`;
                const isDepot = id === depot;
                const isStop = stops.has(id);

                return (
                  <div
                    key={id}
                    id={`cell-${id}`}
                    onClick={() => handleCellClick(id)}
                    className={`
                                            flex items-center justify-center text-[10px] font-mono cursor-pointer rounded-sm transition-all duration-200
                                            ${
                                              isDepot
                                                ? "bg-teal-400 text-teal-950 font-bold border-2 border-white"
                                                : isStop
                                                  ? "bg-rose-500 text-white border border-rose-300"
                                                  : "bg-teal-900/50 text-teal-700 hover:bg-teal-700 hover:text-teal-200 border border-teal-800/50"
                                            }
                                        `}
                  >
                    {id}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
