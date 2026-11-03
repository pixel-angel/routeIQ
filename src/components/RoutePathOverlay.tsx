// components/RoutePathOverlay.tsx
"use client";

import React from "react";

export interface GridCoord {
  r: number; // 0 to 14
  c: number; // 0 to 14
}

interface RoutePathOverlayProps {
  gridSize?: number; // Default: 15
  primaryRoute?: GridCoord[];
  alternativeRoute?: GridCoord[];
  showAlternative?: boolean;
}

export const RoutePathOverlay: React.FC<RoutePathOverlayProps> = ({
  gridSize = 15,
  primaryRoute = [],
  alternativeRoute = [],
  showAlternative = false,
}) => {
  // Convert discrete grid coordinates (r, c) to SVG viewBox percentages (0 to 100)
  const coordsToSvgPoints = (path: GridCoord[]): string => {
    return path
      .map(({ r, c }) => {
        const x = ((c + 0.5) / gridSize) * 100;
        const y = ((r + 0.5) / gridSize) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        {/* Glow filter for the primary emerald/cyan route */}
        <filter id="emerald-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Glow filter for alternative route */}
        <filter id="amber-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Direction arrows */}
        <marker
          id="arrow-primary"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="3"
          markerHeight="3"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
        </marker>
      </defs>

      {/* Alternative Route: Dashed Amber/Muted Line */}
      {showAlternative && alternativeRoute.length > 1 && (
        <polyline
          points={coordsToSvgPoints(alternativeRoute)}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="0.75"
          strokeDasharray="1.5, 1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.65"
          filter="url(#amber-glow)"
        />
      )}

      {/* Primary Route: Outer Translucent Underglow */}
      {primaryRoute.length > 1 && (
        <polyline
          points={coordsToSvgPoints(primaryRoute)}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.25"
        />
      )}

      {/* Primary Route: Core Animated Emerald/Cyan Line */}
      {primaryRoute.length > 1 && (
        <polyline
          points={coordsToSvgPoints(primaryRoute)}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#emerald-glow)"
          className="route-path-primary"
          markerMid="url(#arrow-primary)"
        />
      )}
    </svg>
  );
};
