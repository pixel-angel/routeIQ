import { NextResponse } from "next/server";
// import { createClient } from '@supabase/supabase-js' // Supabase client

// 1. Max-Heap Implementation for Order Prioritization
class OrderHeap {
  heap: any[];
  constructor() {
    this.heap = [];
  }

  // Push based on composite priority score (Urgency + Deadline)
  push(order: any) {
    this.heap.push(order);
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 1) return this.heap.pop();
    const max = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.sinkDown(0);
    return max;
  }

  bubbleUp(idx: number) {
    while (idx > 0) {
      let parent = Math.floor((idx - 1) / 2);
      if (this.heap[parent].priority >= this.heap[idx].priority) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  sinkDown(idx: number) {
    const length = this.heap.length;
    while (true) {
      let left = 2 * idx + 1,
        right = 2 * idx + 2;
      let largest = idx;
      if (
        left < length &&
        this.heap[left].priority > this.heap[largest].priority
      )
        largest = left;
      if (
        right < length &&
        this.heap[right].priority > this.heap[largest].priority
      )
        largest = right;
      if (largest === idx) break;
      [this.heap[idx], this.heap[largest]] = [
        this.heap[largest],
        this.heap[idx],
      ];
      idx = largest;
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawOrders = body.orders; // e.g., fetched from Supabase
    const vehicleCapacity = body.vehicleCapacity || 50;

    // 2. Feed raw orders into the Priority Queue
    const pq = new OrderHeap();
    rawOrders.forEach((order: any) => pq.push(order));

    // Extract ordered list
    const prioritizedOrders = [];
    while (pq.heap.length > 0) {
      prioritizedOrders.push(pq.pop());
    }

    // 3. The Bridge: Send to Member 2's Python/C++ Microservice
    // We include weight and priority for the C++ DP Knapsack logic
    const response = await fetch("http://127.0.0.1:8000/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_weight: vehicleCapacity,
        locations: prioritizedOrders.map((o) => ({
          id: o.id,
          x: o.x,
          y: o.y,
          weight: o.weight,
          priority: o.priority,
        })),
      }),
    });

    const data = await response.json();

    // 4. Update Supabase with assigned driver status here...

    return NextResponse.json({
      success: true,
      route: data.optimized_route,
      time_ms: data.execution_time_ms,
    });
  } catch (error) {
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
