#include <iostream>
#include <vector>
#include <queue>
#include <set>
#include <algorithm>
#include <chrono>

using namespace std;
#define int long long

const int GRID = 15;
const int INF = 1e18;

struct Point {
    int x, y;
    bool operator==(const Point& other) const {
        return x == other.x && y == other.y;
    }
};

bool valid(Point p) {
    return p.x >= 0 && p.x < GRID && p.y >= 0 && p.y < GRID;
}

int id(Point p) {
    return p.x * GRID + p.y;
}

Point getPoint(int value) {
    return {value / GRID, value % GRID};
}

vector<Point> shortestPath(Point start, Point destination, const set<int>& blocked) {
    if (!valid(start) || !valid(destination)) return {};
    int source = id(start);
    int target = id(destination);

    if (source == target) return {start};
    if (blocked.count(source) || blocked.count(target)) return {};

    vector<int> dist(GRID * GRID, INF);
    vector<int> parent(GRID * GRID, -1);
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> pq;

    dist[source] = 0;
    pq.push({0, source});

    int dx[] = {-1, 1, 0, 0};
    int dy[] = {0, 0, -1, 1};

    while (!pq.empty()) {
        int currentDist = pq.top().first;
        int current = pq.top().second;
        pq.pop();

        if (currentDist != dist[current]) continue;
        if (current == target) break;

        Point p = getPoint(current);
        for (int i = 0; i < 4; i++) {
            Point next = {p.x + dx[i], p.y + dy[i]};
            if (!valid(next)) continue;

            int nextId = id(next);
            if (blocked.count(nextId)) continue;

            if (dist[nextId] > currentDist + 1) {
                dist[nextId] = currentDist + 1;
                parent[nextId] = current;
                pq.push({dist[nextId], nextId});
            }
        }
    }

    if (dist[target] == INF) return {};

    vector<Point> path;
    int current = target;
    while (current != -1) {
        path.push_back(getPoint(current));
        if (current == source) break;
        current = parent[current];
    }
    reverse(path.begin(), path.end());
    return path;
}

// 2-Opt Heuristic for N > 12
vector<int> solveTSPHeuristic(int n, const vector<vector<int>>& dist) {
    vector<int> tour;
    vector<bool> visited(n, false);
    
    // Greedy Nearest Neighbor
    int curr = 0; // Origin
    for (int step = 0; step < n; step++) {
        int nextStop = -1;
        int bestDist = INF;
        for (int i = 0; i < n; i++) {
            if (!visited[i] && dist[curr][i + 1] < bestDist) {
                bestDist = dist[curr][i + 1];
                nextStop = i;
            }
        }
        if (nextStop == -1) break;
        visited[nextStop] = true;
        tour.push_back(nextStop);
        curr = nextStop + 1;
    }

    // 2-Opt Improvement Loop
    bool improved = true;
    int iterations = 0;
    while (improved && iterations < 50) {
        improved = false;
        iterations++;
        for (int i = 0; i < (int)tour.size() - 1; i++) {
            for (int k = i + 1; k < (int)tour.size(); k++) {
                int prevA = (i == 0) ? 0 : tour[i - 1] + 1;
                int nodeA = tour[i] + 1;
                int nodeB = tour[k] + 1;
                int nextB = (k == (int)tour.size() - 1) ? n + 1 : tour[k + 1] + 1;

                int currentCost = dist[prevA][nodeA] + dist[nodeB][nextB];
                int newCost = dist[prevA][nodeB] + dist[nodeA][nextB];

                if (newCost < currentCost) {
                    reverse(tour.begin() + i, tour.begin() + k + 1);
                    improved = true;
                }
            }
        }
    }
    return tour;
}

// Bitmask DP for N <= 12
vector<int> solveTSPDP(int n, const vector<vector<int>>& dist) {
    int maskCount = 1 << n;
    vector<vector<int>> dp(maskCount, vector<int>(n, INF));
    vector<vector<int>> parent(maskCount, vector<int>(n, -1));

    for (int i = 0; i < n; i++) {
        dp[1 << i][i] = dist[0][i + 1];
    }

    for (int mask = 1; mask < maskCount; mask++) {
        for (int last = 0; last < n; last++) {
            if (!(mask & (1 << last)) || dp[mask][last] == INF) continue;

            for (int next = 0; next < n; next++) {
                if (mask & (1 << next)) continue;

                int nextMask = mask | (1 << next);
                int newCost = dp[mask][last] + dist[last + 1][next + 1];

                if (newCost < dp[nextMask][next]) {
                    dp[nextMask][next] = newCost;
                    parent[nextMask][next] = last;
                }
            }
        }
    }

    int fullMask = maskCount - 1, bestLast = -1, bestCost = INF;
    for (int last = 0; last < n; last++) {
        int cost = dp[fullMask][last] + dist[last + 1][n + 1];
        if (cost < bestCost) {
            bestCost = cost;
            bestLast = last;
        }
    }

    if (bestLast == -1 || bestCost == INF) return {};

    vector<int> order;
    int mask = fullMask;
    int last = bestLast;
    while (last != -1) {
        order.push_back(last);
        int prev = parent[mask][last];
        mask ^= (1 << last);
        last = prev;
    }
    reverse(order.begin(), order.end());
    return order;
}

vector<Point> optimizeRoute(Point start, Point destination, vector<Point> stops, const set<int>& blocked) {
    int n = stops.size();
    vector<Point> nodes = {start};
    for (Point p : stops) nodes.push_back(p);
    nodes.push_back(destination);

    int totalNodes = n + 2;
    vector<vector<int>> dist(totalNodes, vector<int>(totalNodes, INF));
    vector<vector<vector<Point>>> paths(totalNodes, vector<vector<Point>>(totalNodes));

    for (int i = 0; i < totalNodes; i++) {
        for (int j = 0; j < totalNodes; j++) {
            if (i == j) {
                dist[i][j] = 0;
                paths[i][j] = {nodes[i]};
                continue;
            }
            paths[i][j] = shortestPath(nodes[i], nodes[j], blocked);
            if (!paths[i][j].empty()) {
                dist[i][j] = paths[i][j].size() - 1;
            }
        }
    }

    if (n == 0) return paths[0][1];

    vector<int> order = (n <= 12) ? solveTSPDP(n, dist) : solveTSPHeuristic(n, dist);
    if (order.empty()) return {};

    vector<int> nodeOrder = {0};
    for (int stop : order) nodeOrder.push_back(stop + 1);
    nodeOrder.push_back(n + 1);

    vector<Point> fullPath;
    for (size_t i = 0; i + 1 < nodeOrder.size(); i++) {
        int from = nodeOrder[i];
        int to = nodeOrder[i + 1];
        const vector<Point>& segment = paths[from][to];
        if (segment.empty()) return {};

        for (size_t j = 0; j < segment.size(); j++) {
            if (!fullPath.empty() && j == 0) continue;
            fullPath.push_back(segment[j]);
        }
    }
    return fullPath;
}

void printPath(const vector<Point>& path) {
    cout << path.size() << "\n";
    for (Point p : path) {
        cout << p.x << " " << p.y << "\n";
    }
}

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    Point start, destination;
    int stopCount, obstacleCount;

    if (!(cin >> start.x >> start.y)) return 0;
    if (!(cin >> destination.x >> destination.y)) return 0;
    cin >> stopCount;

    vector<Point> stops(stopCount);
    for (int i = 0; i < stopCount; i++) {
        cin >> stops[i].x >> stops[i].y;
    }

    cin >> obstacleCount;
    set<int> blocked;
    for (int i = 0; i < obstacleCount; i++) {
        Point p;
        cin >> p.x >> p.y;
        if (valid(p)) blocked.insert(id(p));
    }

    vector<Point> shortest = optimizeRoute(start, destination, stops, blocked);
    printPath(shortest);

    // Alternative route by blocking midpoint non-critical node
    vector<Point> nonCritical;
    for (size_t i = 1; i + 1 < shortest.size(); i++) {
        Point p = shortest[i];
        bool isStop = false;
        for (Point s : stops) {
            if (p == s) { isStop = true; break; }
        }
        if (!isStop && !(p == start) && !(p == destination)) {
            nonCritical.push_back(p);
        }
    }

    set<int> altBlocked = blocked;
    if (!nonCritical.empty()) {
        altBlocked.insert(id(nonCritical[nonCritical.size() / 2]));
    }

    vector<Point> alternative = optimizeRoute(start, destination, stops, altBlocked);
    printPath(alternative);

    return 0;
}