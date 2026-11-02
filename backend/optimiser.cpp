#include <bits/stdc++.h>
using namespace std;

struct Pt { string id; int x; int y; int weight; int priority; };

int get_dist(Pt a, Pt b) {
    return abs(a.x - b.x) + abs(a.y - b.y);
}

int main() {
    ios::sync_with_stdio(false); cin.tie(0);
    
    int max_weight, n;
    if (!(cin >> max_weight >> n)) return 0;
    
    vector<Pt> pts(n);
    for(int i=0; i<n; i++) {
        cin >> pts[i].id >> pts[i].x >> pts[i].y >> pts[i].weight >> pts[i].priority;
    }
    
    // --- 1. DP KNAPSACK (0/1 Capacity Filter) ---
    // Exclude Depot (pts[0]) from knapsack, depot is always visited
    vector<vector<int>> dp(n, vector<int>(max_weight + 1, 0));
    vector<vector<bool>> keep(n, vector<bool>(max_weight + 1, false));
    
    for (int i = 1; i < n; i++) {
        for (int w = 1; w <= max_weight; w++) {
            if (pts[i].weight <= w && dp[i-1][w - pts[i].weight] + pts[i].priority > dp[i-1][w]) {
                dp[i][w] = dp[i-1][w - pts[i].weight] + pts[i].priority;
                keep[i][w] = true;
            } else {
                dp[i][w] = dp[i-1][w];
            }
        }
    }
    
    // Backtrack to find which orders were selected
    vector<Pt> selected_pts;
    selected_pts.push_back(pts[0]); // Always include depot
    int curr_w = max_weight;
    for (int i = n - 1; i >= 1; i--) {
        if (keep[i][curr_w]) {
            selected_pts.push_back(pts[i]);
            curr_w -= pts[i].weight;
        }
    }
    
    // --- 2. GREEDY + 2-OPT (TSP on selected nodes) ---
    int k = selected_pts.size();
    vector<int> path;
    vector<bool> vis(k, false);
    int curr = 0; 
    path.push_back(curr);
    vis[curr] = true;
    
    for(int i=1; i<k; i++) {
        int nxt = -1, best = 1e9;
        for(int j=0; j<k; j++) {
            if(!vis[j]) {
                int d = get_dist(selected_pts[curr], selected_pts[j]);
                if(d < best) { best = d; nxt = j; }
            }
        }
        curr = nxt;
        path.push_back(curr);
        vis[curr] = true;
    }
    
    bool impr = true;
    while(impr) {
        impr = false;
        for(int i=1; i<k-2; i++) {
            for(int j=i+1; j<k-1; j++) {
                int d1 = get_dist(selected_pts[path[i-1]], selected_pts[path[i]]) + get_dist(selected_pts[path[j]], selected_pts[path[j+1]]);
                int d2 = get_dist(selected_pts[path[i-1]], selected_pts[path[j]]) + get_dist(selected_pts[path[i]], selected_pts[path[j+1]]);
                if(d2 < d1) {
                    reverse(path.begin() + i, path.begin() + j + 1);
                    impr = true;
                }
            }
        }
    }
    
    // Return final sequence
    for(int idx : path) cout << selected_pts[idx].id << " ";
    cout << selected_pts[0].id << "\n"; // Return to depot
    
    return 0;
}