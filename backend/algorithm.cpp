// RouteIQ C++ route engine
//
// Usage:
//   algorithm            -> "route" mode (default, used for orders / routing)
//   algorithm compare    -> "compare" mode (runs every TSP strategy and reports cost + time)
//
// Input (stdin, both modes):
//   ox oy
//   dx dy
//   n
//   n lines of "x y"           (delivery stops)
//   m
//   m lines of "x y"           (obstacles)
//
// Output, route mode:
//   <shortest path>            "len" followed by len lines "x y"
//   <alternative path>         same format (best route avoiding one cell of the shortest)
//   <visit order>              "k" followed by k stop indices (0-based, into the input stops)
//
// Output, compare mode (one block per strategy):
//   STRATEGY <key>
//   <status> <distance> <time_ns> <work>     status: ok | skipped | infeasible
//   <visit order>                            "k idx idx ..."
//   <path>                                   "len" followed by len lines "x y"

#include <iostream>
#include <vector>
#include <queue>
#include <set>
#include <string>
#include <algorithm>
#include <numeric>
#include <chrono>

using namespace std;
typedef long long ll;

const int GRID = 15;
const ll INF = (ll)1e15;

// Exact solvers are only run when the instance is small enough to finish quickly.
const int DP_LIMIT = 16;          // Held-Karp: O(2^n * n^2)
const int BRUTE_FORCE_LIMIT = 10; // Permutations: O(n!)
const int ROUTE_DP_LIMIT = 12;    // Route mode: use DP up to this many stops, 2-opt above it

struct Point {
    int x, y;
    bool operator==(const Point& o) const { return x == o.x && y == o.y; }
};

bool valid(Point p) { return p.x >= 0 && p.x < GRID && p.y >= 0 && p.y < GRID; }
int cellId(Point p) { return p.x * GRID + p.y; }
Point cellPoint(int v) { return {v / GRID, v % GRID}; }

// ---------------------------------------------------------------------------
// Dijkstra (single source -> every cell) on the 4-connected grid
// ---------------------------------------------------------------------------
struct ShortestPathTree {
    vector<ll> dist;
    vector<int> parent;
};

ShortestPathTree dijkstra(Point start, const set<int>& blocked) {
    ShortestPathTree t{vector<ll>(GRID * GRID, INF), vector<int>(GRID * GRID, -1)};
    if (!valid(start) || blocked.count(cellId(start))) return t;

    priority_queue<pair<ll, int>, vector<pair<ll, int>>, greater<pair<ll, int>>> pq;
    int src = cellId(start);
    t.dist[src] = 0;
    pq.push({0, src});

    const int dx[] = {-1, 1, 0, 0};
    const int dy[] = {0, 0, -1, 1};

    while (!pq.empty()) {
        auto [d, cur] = pq.top();
        pq.pop();
        if (d != t.dist[cur]) continue;
        Point p = cellPoint(cur);
        for (int i = 0; i < 4; i++) {
            Point nx = {p.x + dx[i], p.y + dy[i]};
            if (!valid(nx)) continue;
            int nid = cellId(nx);
            if (blocked.count(nid)) continue;
            if (t.dist[nid] > d + 1) {
                t.dist[nid] = d + 1;
                t.parent[nid] = cur;
                pq.push({t.dist[nid], nid});
            }
        }
    }
    return t;
}

vector<Point> extractPath(const ShortestPathTree& t, Point start, Point target) {
    int tid = cellId(target);
    if (t.dist[tid] >= INF) return {};
    vector<Point> path;
    int cur = tid;
    while (cur != -1) {
        path.push_back(cellPoint(cur));
        if (cur == cellId(start)) break;
        cur = t.parent[cur];
    }
    reverse(path.begin(), path.end());
    return path;
}

// ---------------------------------------------------------------------------
// Distance matrix between origin (0), stops (1..n) and destination (n+1)
// ---------------------------------------------------------------------------
struct Instance {
    int n;                              // number of stops
    vector<Point> nodes;                // origin, stops..., destination
    vector<vector<ll>> dist;            // (n+2) x (n+2)
    vector<ShortestPathTree> trees;     // one Dijkstra tree per node
};

Instance buildInstance(Point start, Point dest, const vector<Point>& stops, const set<int>& blocked) {
    Instance inst;
    inst.n = stops.size();
    inst.nodes.push_back(start);
    for (auto& s : stops) inst.nodes.push_back(s);
    inst.nodes.push_back(dest);

    int total = inst.n + 2;
    inst.dist.assign(total, vector<ll>(total, INF));
    for (int i = 0; i < total; i++) {
        inst.trees.push_back(dijkstra(inst.nodes[i], blocked));
        for (int j = 0; j < total; j++) {
            inst.dist[i][j] = inst.trees[i].dist[cellId(inst.nodes[j])];
        }
    }
    return inst;
}

// Cost of visiting stops in `order` (0-based stop indices): origin -> ... -> destination
ll tourCost(const Instance& inst, const vector<int>& order) {
    ll cost = 0;
    int prev = 0;
    for (int s : order) {
        if (inst.dist[prev][s + 1] >= INF) return INF;
        cost += inst.dist[prev][s + 1];
        prev = s + 1;
    }
    if (inst.dist[prev][inst.n + 1] >= INF) return INF;
    return cost + inst.dist[prev][inst.n + 1];
}

vector<Point> stitchPath(const Instance& inst, const vector<int>& order) {
    vector<int> seq = {0};
    for (int s : order) seq.push_back(s + 1);
    seq.push_back(inst.n + 1);

    vector<Point> full;
    for (size_t i = 0; i + 1 < seq.size(); i++) {
        vector<Point> seg = extractPath(inst.trees[seq[i]], inst.nodes[seq[i]], inst.nodes[seq[i + 1]]);
        if (seg.empty()) return {};
        for (size_t j = 0; j < seg.size(); j++) {
            if (!full.empty() && j == 0) continue;
            full.push_back(seg[j]);
        }
    }
    return full;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

// 1. Baseline: visit stops in the order they were given (queue / FIFO order)
vector<int> solveInputOrder(const Instance& inst, ll& work) {
    vector<int> order(inst.n);
    iota(order.begin(), order.end(), 0);
    work = inst.n;
    return order;
}

// 2. Greedy nearest neighbour: always drive to the closest unvisited stop
vector<int> solveNearestNeighbor(const Instance& inst, ll& work) {
    int n = inst.n;
    vector<int> order;
    vector<bool> used(n, false);
    int cur = 0;
    work = 0;
    for (int step = 0; step < n; step++) {
        int best = -1;
        ll bestD = INF;
        for (int i = 0; i < n; i++) {
            work++;
            if (!used[i] && inst.dist[cur][i + 1] < bestD) {
                bestD = inst.dist[cur][i + 1];
                best = i;
            }
        }
        if (best == -1) return {};
        used[best] = true;
        order.push_back(best);
        cur = best + 1;
    }
    return order;
}

// 3. Local search starting from the nearest-neighbour tour:
//    2-opt (reverse a segment) + Or-opt (move a chain of 1-3 stops elsewhere),
//    repeated until neither move shortens the route.
vector<int> solveTwoOpt(const Instance& inst, ll& work) {
    ll nnWork = 0;
    vector<int> tour = solveNearestNeighbor(inst, nnWork);
    work = nnWork;
    if ((int)tour.size() < 2) return tour;

    ll current = tourCost(inst, tour);
    bool improved = true;
    int passes = 0;
    while (improved && passes < 1000) {
        improved = false;
        passes++;
        int n = tour.size();
        auto node = [&](int pos) -> int {
            if (pos < 0) return 0;               // origin
            if (pos >= n) return inst.n + 1;     // destination
            return tour[pos] + 1;
        };

        // 2-opt
        for (int i = 0; i < n - 1; i++) {
            for (int k = i + 1; k < n; k++) {
                work++;
                int a = node(i - 1), b = node(i), c = node(k), d = node(k + 1);
                ll delta = inst.dist[a][c] + inst.dist[b][d] - inst.dist[a][b] - inst.dist[c][d];
                if (delta < 0) {
                    reverse(tour.begin() + i, tour.begin() + k + 1);
                    current += delta;
                    improved = true;
                }
            }
        }

        // Or-opt: relocate a chain of `len` consecutive stops (optionally reversed)
        for (int len = 1; len <= 3 && len < n; len++) {
            for (int i = 0; i + len <= n; i++) {
                vector<int> chain(tour.begin() + i, tour.begin() + i + len);
                vector<int> rest(tour.begin(), tour.begin() + i);
                rest.insert(rest.end(), tour.begin() + i + len, tour.end());
                bool moved = false;
                for (int pos = 0; pos <= (int)rest.size() && !moved; pos++) {
                    if (pos == i) continue;
                    for (int rev = 0; rev < 2 && !moved; rev++) {
                        work++;
                        vector<int> cand = rest;
                        vector<int> ch = chain;
                        if (rev) reverse(ch.begin(), ch.end());
                        cand.insert(cand.begin() + pos, ch.begin(), ch.end());
                        ll c = tourCost(inst, cand);
                        if (c < current) {
                            tour = cand;
                            current = c;
                            improved = moved = true;
                        }
                    }
                }
            }
        }
    }
    return tour;
}

// 4. Held-Karp bitmask dynamic programming: exact, O(2^n * n^2)
vector<int> solveHeldKarp(const Instance& inst, ll& work) {
    int n = inst.n;
    work = 0;
    if (n == 0) return {};
    int masks = 1 << n;
    vector<vector<ll>> dp(masks, vector<ll>(n, INF));
    vector<vector<int>> par(masks, vector<int>(n, -1));

    for (int i = 0; i < n; i++) dp[1 << i][i] = inst.dist[0][i + 1];

    for (int mask = 1; mask < masks; mask++) {
        for (int last = 0; last < n; last++) {
            if (!(mask & (1 << last)) || dp[mask][last] >= INF) continue;
            for (int nx = 0; nx < n; nx++) {
                if (mask & (1 << nx)) continue;
                work++;
                if (inst.dist[last + 1][nx + 1] >= INF) continue;
                int nm = mask | (1 << nx);
                ll c = dp[mask][last] + inst.dist[last + 1][nx + 1];
                if (c < dp[nm][nx]) {
                    dp[nm][nx] = c;
                    par[nm][nx] = last;
                }
            }
        }
    }

    int full = masks - 1, bestLast = -1;
    ll best = INF;
    for (int last = 0; last < n; last++) {
        if (dp[full][last] >= INF || inst.dist[last + 1][n + 1] >= INF) continue;
        ll c = dp[full][last] + inst.dist[last + 1][n + 1];
        if (c < best) { best = c; bestLast = last; }
    }
    if (bestLast == -1) return {};

    vector<int> order;
    int mask = full, last = bestLast;
    while (last != -1) {
        order.push_back(last);
        int p = par[mask][last];
        mask ^= (1 << last);
        last = p;
    }
    reverse(order.begin(), order.end());
    return order;
}

// 5. Brute force: try every permutation, exact, O(n!)
vector<int> solveBruteForce(const Instance& inst, ll& work) {
    vector<int> perm(inst.n);
    iota(perm.begin(), perm.end(), 0);
    vector<int> best;
    ll bestCost = INF;
    work = 0;
    do {
        work++;
        ll c = tourCost(inst, perm);
        if (c < bestCost) { bestCost = c; best = perm; }
    } while (next_permutation(perm.begin(), perm.end()));
    return best;
}

// Route mode solver: exact for small instances, heuristic for large ones
vector<int> solveBest(const Instance& inst) {
    ll work = 0;
    if (inst.n == 0) return {};
    return inst.n <= ROUTE_DP_LIMIT ? solveHeldKarp(inst, work) : solveTwoOpt(inst, work);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
void printPath(const vector<Point>& path) {
    cout << path.size() << "\n";
    for (auto& p : path) cout << p.x << " " << p.y << "\n";
}

void printOrder(const vector<int>& order) {
    cout << order.size();
    for (int s : order) cout << " " << s;
    cout << "\n";
}

void runCompare(Point start, Point dest, const vector<Point>& stops, const set<int>& blocked) {
    Instance inst = buildInstance(start, dest, stops, blocked);
    int n = inst.n;

    struct Strategy {
        string key;
        vector<int> (*solve)(const Instance&, ll&);
        bool enabled;
    };
    vector<Strategy> strategies = {
        {"input_order", solveInputOrder, true},
        {"nearest_neighbor", solveNearestNeighbor, true},
        {"two_opt", solveTwoOpt, true},
        {"held_karp", solveHeldKarp, n <= DP_LIMIT},
        {"brute_force", solveBruteForce, n <= BRUTE_FORCE_LIMIT},
    };

    for (auto& s : strategies) {
        cout << "STRATEGY " << s.key << "\n";
        if (!s.enabled) {
            cout << "skipped -1 0 0\n0\n0\n";
            continue;
        }
        ll work = 0;
        auto t0 = chrono::steady_clock::now();
        vector<int> order = s.solve(inst, work);
        auto t1 = chrono::steady_clock::now();
        ll ns = chrono::duration_cast<chrono::nanoseconds>(t1 - t0).count();

        ll cost = ((int)order.size() == n) ? tourCost(inst, order) : INF;
        if (cost >= INF) {
            cout << "infeasible -1 " << ns << " " << work << "\n0\n0\n";
            continue;
        }
        cout << "ok " << cost << " " << ns << " " << work << "\n";
        printOrder(order);
        printPath(stitchPath(inst, order));
    }
}

void runRoute(Point start, Point dest, const vector<Point>& stops, const set<int>& blocked) {
    Instance inst = buildInstance(start, dest, stops, blocked);
    vector<int> order = solveBest(inst);
    vector<Point> shortest;
    if ((int)order.size() == inst.n && tourCost(inst, order) < INF) {
        shortest = stitchPath(inst, order);
    } else {
        order.clear();
    }
    printPath(shortest);

    // Alternative: re-plan after closing one non-stop cell from the middle of the best route
    vector<Point> nonCritical;
    for (size_t i = 1; i + 1 < shortest.size(); i++) {
        Point p = shortest[i];
        bool isStop = find(stops.begin(), stops.end(), p) != stops.end();
        if (!isStop && !(p == start) && !(p == dest)) nonCritical.push_back(p);
    }
    vector<Point> alternative;
    if (!nonCritical.empty()) {
        set<int> altBlocked = blocked;
        altBlocked.insert(cellId(nonCritical[nonCritical.size() / 2]));
        Instance alt = buildInstance(start, dest, stops, altBlocked);
        vector<int> altOrder = solveBest(alt);
        if ((int)altOrder.size() == alt.n && tourCost(alt, altOrder) < INF) {
            alternative = stitchPath(alt, altOrder);
        }
    }
    printPath(alternative);
    printOrder(order);
}

int main(int argc, char** argv) {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    string mode = argc > 1 ? argv[1] : "route";

    Point start, dest;
    int stopCount, obstacleCount;
    if (!(cin >> start.x >> start.y)) return 0;
    if (!(cin >> dest.x >> dest.y)) return 0;
    cin >> stopCount;
    vector<Point> stops(stopCount);
    for (int i = 0; i < stopCount; i++) cin >> stops[i].x >> stops[i].y;

    cin >> obstacleCount;
    set<int> blocked;
    for (int i = 0; i < obstacleCount; i++) {
        Point p;
        cin >> p.x >> p.y;
        if (valid(p)) blocked.insert(cellId(p));
    }

    if (mode == "compare") runCompare(start, dest, stops, blocked);
    else runRoute(start, dest, stops, blocked);
    return 0;
}