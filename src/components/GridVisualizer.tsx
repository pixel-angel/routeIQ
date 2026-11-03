"use client";
import React, { useRef, useEffect, useState, useCallback } from "react";
import { Stop } from "../types";

const COLS = Array.from({ length: 15 }, (_, i) => String.fromCharCode(65 + i));
const ROWS = Array.from({ length: 15 }, (_, i) => 15 - i);

interface Props {
  depot: string;
  stops: Map<string, Stop>;
  route: string[];
  selectedCell: string;
  onCellClick: (id: string) => void;
}

interface Segment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

export default function GridVisualizer({
  depot,
  stops,
  route,
  selectedCell,
  onCellClick,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);

  const drawLines = useCallback(() => {
    if (route.length < 2 || !gridRef.current) {
      setSegments([]);
      return;
    }

    const gridRect = gridRef.current.getBoundingClientRect();
    const getCenter = (id: string) => {
      const cell = document.getElementById(`cell-${id}`);
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      return {
        x: rect.left - gridRect.left + rect.width / 2,
        y: rect.top - gridRect.top + rect.height / 2,
      };
    };

    const newSegments: Segment[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const p1 = getCenter(route[i]);
      const p2 = getCenter(route[i + 1]);

      if (p1 && p2) {
        // Calculate exact pixel distance between nodes to fix the animation bug
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        newSegments.push({
          id: `${route[i]}-${route[i + 1]}-${i}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          length: dist,
        });
      }
    }

    setSegments(newSegments);
  }, [route]);

  useEffect(() => {
    drawLines();
    window.addEventListener("resize", drawLines);
    return () => window.removeEventListener("resize", drawLines);
  }, [drawLines]);

  return (
    <div
      ref={gridRef}
      className="relative w-full max-w-2xl mx-auto aspect-square bg-white p-3 rounded-3xl shadow-xl border border-orange-200"
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
                @keyframes drawRealLine {
                    to { stroke-dashoffset: 0; }
                }
            `,
        }}
      />

      <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="16"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f97316" />
          </marker>
        </defs>

        {segments.map((seg, index) => (
          <line
            key={seg.id}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            className="stroke-orange-500 stroke-[3px] drop-shadow-[0_2px_8px_rgba(249,115,22,0.6)]"
            strokeLinecap="round"
            markerEnd="url(#arrow)"
            style={{
              strokeDasharray: seg.length,
              strokeDashoffset: seg.length,
              // Uses the exact length to smoothly animate the line drawing
              animation: `drawRealLine 0.3s ease-out forwards ${index * 0.15}s`,
            }}
          />
        ))}
      </svg>

      <div
        className="w-full h-full relative z-10"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(15, 1fr)",
          gridTemplateRows: "repeat(15, 1fr)",
          gap: "4px",
        }}
      >
        {ROWS.map((row) =>
          COLS.map((col) => {
            const id = `${col}${row}`;
            const isDepot = id === depot;
            const isStop = stops.has(id);
            const isSelected = id === selectedCell;

            return (
              <div
                key={id}
                id={`cell-${id}`}
                onClick={() => onCellClick(id)}
                className={`
                                    flex items-center justify-center text-[10px] font-mono font-bold cursor-pointer rounded-md transition-all duration-150 relative
                                    ${isSelected ? "ring-2 ring-orange-500 ring-offset-2 z-30" : ""}
                                    ${
                                      isDepot
                                        ? "bg-orange-500 text-white shadow-md z-20"
                                        : isStop
                                          ? "bg-neutral-900 text-white shadow-sm z-20"
                                          : "bg-[#FDFBF7] hover:bg-orange-50 text-neutral-400 hover:text-orange-500 border border-neutral-100"
                                    }
                                `}
              >
                <span>{id}</span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
