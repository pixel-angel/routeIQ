import React from "react";
import { Stop } from "../types";

interface Props {
  selectedCell: string;
  depot: string;
  stops: Map<string, Stop>;
  inputWeight: number;
  inputPriority: number;
  isCalculating: boolean;
  onWeightChange: (val: number) => void;
  onPriorityChange: (val: number) => void;
  onSaveStop: () => void;
  onRemoveStop: () => void;
  onSetDepot: () => void;
  onOptimize: () => void;
  onClear: () => void;
}

export default function DispatchDesk({
  selectedCell,
  depot,
  stops,
  inputWeight,
  inputPriority,
  isCalculating,
  onWeightChange,
  onPriorityChange,
  onSaveStop,
  onRemoveStop,
  onSetDepot,
  onOptimize,
  onClear,
}: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-200">
        <h2 className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-6">
          Dispatch Desk
        </h2>

        <div className="flex items-end justify-between mb-6 pb-4 border-b border-neutral-200">
          <span className="text-5xl font-black text-black tracking-tighter">
            {selectedCell}
          </span>
          {selectedCell === depot && (
            <span className="bg-orange-100 text-orange-700 border border-orange-300 text-[10px] font-bold px-3 py-1 rounded uppercase tracking-widest">
              Depot
            </span>
          )}
          {stops.has(selectedCell) && (
            <span className="bg-neutral-100 text-neutral-800 border border-neutral-300 text-[10px] font-bold px-3 py-1 rounded uppercase tracking-widest">
              Stop
            </span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs text-black font-bold uppercase tracking-wider mb-2">
              Payload (kg)
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={inputWeight}
              onChange={(e) => onWeightChange(Number(e.target.value))}
              className="hide-arrows w-full bg-[#FDFBF7] border border-neutral-300 rounded-lg p-3 text-black font-mono font-bold focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs text-black font-bold uppercase tracking-wider mb-2">
              Priority (1-5)
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={inputPriority}
              onChange={(e) => onPriorityChange(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
            <div className="flex justify-between text-[10px] text-neutral-600 mt-2 font-mono font-bold">
              <span>LVL 1</span>
              <span>LVL {inputPriority}</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {selectedCell !== depot ? (
            <button
              onClick={onSaveStop}
              className="w-full py-3 bg-black hover:bg-neutral-800 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-md transition-colors"
            >
              {stops.has(selectedCell) ? "Update Node" : "Inject Order"}
            </button>
          ) : (
            <div className="w-full py-3 bg-neutral-100 text-neutral-500 text-xs font-bold uppercase tracking-widest text-center rounded-lg border border-neutral-200">
              Active Origin
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onSetDepot}
              className="flex-1 py-3 bg-white border border-neutral-300 hover:bg-neutral-50 text-black text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors"
            >
              Set Origin
            </button>
            {stops.has(selectedCell) && (
              <button
                onClick={onRemoveStop}
                className="flex-1 py-3 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors"
              >
                Purge
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-200">
        <div className="flex justify-between items-end mb-6">
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">
              Pending Dispatches
            </p>
            <p className="text-3xl font-black text-black">{stops.size}</p>
          </div>
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-neutral-400 hover:text-black uppercase tracking-widest transition-colors"
          >
            Wipe Grid
          </button>
        </div>
        <button
          onClick={onOptimize}
          disabled={stops.size === 0 || isCalculating}
          className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-200 disabled:text-neutral-500 text-white font-black text-sm uppercase tracking-widest rounded-xl shadow-[0_4px_14px_rgba(249,115,22,0.4)] transition-all"
        >
          {isCalculating ? "Computing Sequence..." : "Execute Engine"}
        </button>
      </div>
    </div>
  );
}
