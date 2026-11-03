"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';

const COLS = Array.from({ length: 15 }, (_, i) => String.fromCharCode(65 + i));
const ROWS = Array.from({ length: 15 }, (_, i) => 15 - i);

export default function RoutePlanner() {
    const [depot, setDepot] = useState("A1");
    // Using a Map to store stops: key is cell ID (e.g., "C4"), value is { weight, priority }
    const [stops, setStops] = useState(new Map());
    const [route, setRoute] = useState([]);
    const [svgPoints, setSvgPoints] = useState("");
    
    const [selectedCell, setSelectedCell] = useState("A1");
    const [inputWeight, setInputWeight] = useState(5);
    const [inputPriority, setInputPriority] = useState(3);
    
    const [execTime, setExecTime] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const gridRef = useRef(null);

    // 1. Grid Interaction Logic
    const handleCellClick = (id) => {
        setSelectedCell(id);
        if (stops.has(id)) {
            const data = stops.get(id);
            setInputWeight(data.weight);
            setInputPriority(data.priority);
        } else {
            setInputWeight(5);
            setInputPriority(3);
        }
    };

    const handleSaveStop = () => {
        if (selectedCell === depot) return;
        setStops(prev => {
            const newMap = new Map(prev);
            newMap.set(selectedCell, { id: selectedCell, weight: inputWeight, priority: inputPriority });
            return newMap;
        });
    };

    const handleRemoveStop = () => {
        setStops(prev => {
            const newMap = new Map(prev);
            newMap.delete(selectedCell);
            return newMap;
        });
    };

    const handleSetDepot = () => {
        setStops(prev => {
            const newMap = new Map(prev);
            newMap.delete(selectedCell); // Depot can't be a delivery stop
            return newMap;
        });
        setDepot(selectedCell);
    };

    // 2. SVG Line Calculation (Fixes the alignment issue)
    const drawLines = useCallback(() => {
        if (route.length === 0 || !gridRef.current) {
            setSvgPoints(""); 
            return;
        }
        const gridRect = gridRef.current.getBoundingClientRect();
        
        const points = route.map(id => {
            const cell = document.getElementById(`cell-${id}`);
            if (!cell) return null;
            const rect = cell.getBoundingClientRect();
            // Calculate absolute center of the cell relative to the grid container
            const x = (rect.left - gridRect.left) + (rect.width / 2);
            const y = (rect.top - gridRect.top) + (rect.height / 2);
            return `${x},${y}`;
        }).filter(Boolean).join(" ");
        
        setSvgPoints(points);
    }, [route]);

    // Redraw lines if window resizes so they stay attached to the grid cells
    useEffect(() => {
        drawLines();
        window.addEventListener('resize', drawLines);
        return () => window.removeEventListener('resize', drawLines);
    }, [drawLines]);

    // 3. Local JS Optimization Trigger
    const handleOptimize = async () => {
        setIsCalculating(true);
        setRoute([]); 
        
        // Simulate a slight delay to show the loading state
        setTimeout(() => {
            // For now, we generate a mock route. 
            // In the next step, we will import the DAA algorithms from algorithms/nearestNeighbour.js
            const mockRoute = [depot, ...Array.from(stops.keys()), depot];
            setRoute(mockRoute);
            setExecTime(12.4); // Mock execution time
            setIsCalculating(false);
        }, 600);
    };

    return (
        <div className="flex flex-col xl:flex-row gap-6 p-8 h-full bg-slate-50">
            
            {/* LEFT PANEL: Stop Configuration Form */}
            <div className="w-full xl:w-1/4 flex flex-col gap-4">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Location Details</h2>
                    
                    <div className="flex items-end justify-between mb-6 pb-4 border-b border-slate-100">
                        <span className="text-4xl font-bold text-slate-800 tracking-tight">{selectedCell}</span>
                        {selectedCell === depot && <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Depot</span>}
                        {stops.has(selectedCell) && <span className="bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Stop</span>}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-slate-500 font-medium mb-1.5">Package Weight (kg)</label>
                            <input 
                                type="number" min="1" max="50" value={inputWeight} 
                                onChange={(e) => setInputWeight(Number(e.target.value))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 font-medium focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 font-medium mb-1.5">Priority Level (1-5)</label>
                            <input 
                                type="range" min="1" max="5" value={inputPriority} 
                                onChange={(e) => setInputPriority(Number(e.target.value))}
                                className="w-full accent-blue-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                                <span>Low</span><span>High ({inputPriority})</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 flex flex-col gap-2">
                        {selectedCell !== depot ? (
                            <button onClick={handleSaveStop} className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition-colors">
                                {stops.has(selectedCell) ? 'Update Stop' : 'Add Stop'}
                            </button>
                        ) : (
                            <div className="w-full py-2.5 bg-slate-100 text-slate-400 text-sm font-medium text-center rounded-lg cursor-not-allowed">
                                Current Origin
                            </div>
                        )}
                        
                        <div className="flex gap-2">
                            <button onClick={handleSetDepot} className="flex-1 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-colors">
                                Set as Depot
                            </button>
                            {stops.has(selectedCell) && (
                                <button onClick={handleRemoveStop} className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg transition-colors">
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Global Controls */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mt-auto">
                    <div className="flex justify-between items-end mb-4">
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pending Orders</p>
                            <p className="text-3xl font-bold text-slate-800">{stops.size}</p>
                        </div>
                        <button onClick={() => { setRoute([]); setStops(new Map()); setExecTime(null); }} className="text-[10px] font-medium text-slate-500 hover:text-slate-800 transition-colors">
                            Clear Map
                        </button>
                    </div>
                    <button 
                        onClick={handleOptimize}
                        disabled={stops.size === 0 || isCalculating}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold text-sm rounded-lg shadow-sm transition-all"
                    >
                        {isCalculating ? 'Calculating...' : 'Optimize Route'}
                    </button>
                </div>
            </div>

            {/* CENTER PANEL: The Grid Map */}
            <div className="w-full xl:w-2/4 flex justify-center items-center">
                <div 
                    ref={gridRef} 
                    className="relative w-full max-w-2xl aspect-square bg-white border border-slate-200 rounded-xl shadow-sm p-2 overflow-hidden"
                >
                    {/* SVG Layer */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                        {svgPoints && (
                            <polyline 
                                points={svgPoints} 
                                fill="none" 
                                className="stroke-blue-500 stroke-[3px] drop-shadow-[0_2px_4px_rgba(59,130,246,0.3)] path-anim"
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                            />
                        )}
                    </svg>

                    {/* CSS Grid - Using Inline Styles so it NEVER breaks */}
                    <div 
                        className="w-full h-full" 
                        style={{ display: 'grid', gridTemplateColumns: 'repeat(15, minmax(0, 1fr))', gap: '2px' }}
                    >
                        {ROWS.map(row => 
                            COLS.map(col => {
                                const id = `${col}${row}`;
                                const isDepot = id === depot;
                                const isStop = stops.has(id);
                                const isSelected = id === selectedCell;
                                
                                return (
                                    <div 
                                        key={id} id={`cell-${id}`}
                                        onClick={() => handleCellClick(id)}
                                        className={`
                                            flex items-center justify-center text-[9px] font-mono cursor-pointer rounded-[4px] transition-all duration-150
                                            ${isSelected ? 'ring-2 ring-blue-500 z-10' : ''}
                                            ${isDepot ? 'bg-blue-600 text-white font-bold shadow-md' : 
                                              isStop ? 'bg-slate-800 text-white font-semibold' : 
                                              'bg-slate-50 hover:bg-slate-100 text-slate-400'}
                                        `}
                                    >
                                        <span>{id}</span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* RIGHT PANEL: Results & Analytics */}
            <div className="w-full xl:w-1/4">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-full">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 pb-4 border-b border-slate-100">
                        Route Results
                    </h2>
                    
                    <div className="space-y-6">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1 font-semibold">Engine Speed</p>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-3xl font-bold text-slate-800 tracking-tight">
                                    {execTime !== null ? execTime : '--'}
                                </span>
                                <span className="text-slate-500 text-sm font-medium">ms</span>
                            </div>
                        </div>

                        {route.length > 0 && (
                            <div className="max-h-[350px] overflow-y-auto">
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Delivery Sequence</p>
                                <div className="flex flex-col gap-2 pr-2">
                                    {route.map((node, i) => (
                                        <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg border ${node === depot ? 'bg-blue-50 border-blue-100' : 'bg-white border-slate-200 shadow-sm'}`}>
                                            <span className={`text-[10px] font-mono font-bold w-4 ${node === depot ? 'text-blue-500' : 'text-slate-400'}`}>{i + 1}</span>
                                            <span className="text-sm font-semibold text-slate-700">{node}</span>
                                            {stops.has(node) && (
                                                <span className="ml-auto text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                                                    P{stops.get(node).priority}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}