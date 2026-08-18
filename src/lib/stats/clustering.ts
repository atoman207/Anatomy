/** k-means and hierarchical clustering over row vectors. */

export type DistanceMetric = "euclidean" | "manhattan" | "correlation" | "cosine";
export type Linkage = "average" | "complete" | "single" | "ward";

export function distance(
  a: readonly number[],
  b: readonly number[],
  metric: DistanceMetric = "euclidean",
): number {
  const n = Math.min(a.length, b.length);
  if (metric === "manhattan") {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s;
  }
  if (metric === "cosine") {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const den = Math.sqrt(na * nb);
    return den === 0 ? 1 : 1 - dot / den;
  }
  if (metric === "correlation") {
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= n;
    mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 1 : 1 - num / den;
  }
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Deterministic PRNG so the same input always yields the same clustering. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KMeansResult {
  /** Cluster index per input row. */
  assignments: number[];
  centroids: number[][];
  k: number;
  iterations: number;
  converged: boolean;
  /** Total within-cluster sum of squares - lower is tighter. */
  inertia: number;
  /** Mean silhouette across all points, in [-1, 1]. */
  silhouette: number;
  sizes: number[];
  notes: string[];
}

/**
 * k-means with k-means++ seeding, restarted `nInit` times and keeping the
 * lowest-inertia solution. Seeded for reproducibility.
 */
export function kMeans(
  data: readonly (readonly number[])[],
  k: number,
  opts: {
    maxIterations?: number;
    metric?: DistanceMetric;
    seed?: number;
    nInit?: number;
  } = {},
): KMeansResult {
  const {
    maxIterations = 300,
    metric = "euclidean",
    seed = 42,
    nInit = 10,
  } = opts;
  const notes: string[] = [];
  const n = data.length;

  if (n === 0) {
    return {
      assignments: [], centroids: [], k: 0, iterations: 0, converged: false,
      inertia: NaN, silhouette: NaN, sizes: [], notes: ["No rows to cluster."],
    };
  }
  const kk = Math.max(1, Math.min(k, n));
  if (kk !== k) notes.push(`k reduced to ${kk} (cannot exceed the number of rows).`);
  const dim = data[0].length;

  let best: { assignments: number[]; centroids: number[][]; inertia: number; iterations: number; converged: boolean } | null = null;

  for (let init = 0; init < nInit; init++) {
    const rand = mulberry32(seed + init * 7919);

    // --- k-means++ seeding ---
    const centroids: number[][] = [];
    centroids.push([...data[Math.floor(rand() * n)]]);
    while (centroids.length < kk) {
      const d2 = data.map((p) => {
        let m = Infinity;
        for (const c of centroids) m = Math.min(m, distance(p, c, metric) ** 2);
        return m;
      });
      const total = d2.reduce((s, v) => s + v, 0);
      if (total === 0 || !Number.isFinite(total)) {
        centroids.push([...data[Math.floor(rand() * n)]]);
        continue;
      }
      let target = rand() * total;
      let idx = 0;
      for (let i = 0; i < n; i++) {
        target -= d2[i];
        if (target <= 0) {
          idx = i;
          break;
        }
      }
      centroids.push([...data[idx]]);
    }

    // --- Lloyd iterations ---
    let assignments = new Array<number>(n).fill(0);
    let iterations = 0;
    let converged = false;
    for (let it = 0; it < maxIterations; it++) {
      iterations = it + 1;
      const next = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        let bestD = Infinity;
        let bestC = 0;
        for (let c = 0; c < centroids.length; c++) {
          const d = distance(data[i], centroids[c], metric);
          if (d < bestD) {
            bestD = d;
            bestC = c;
          }
        }
        next[i] = bestC;
      }
      const stable = next.every((v, i) => v === assignments[i]);
      assignments = next;

      for (let c = 0; c < centroids.length; c++) {
        const members = data.filter((_, i) => assignments[i] === c);
        if (members.length === 0) {
          // Re-seed an emptied cluster onto the worst-fit point.
          let worst = 0;
          let worstD = -1;
          for (let i = 0; i < n; i++) {
            const d = distance(data[i], centroids[assignments[i]], metric);
            if (d > worstD) {
              worstD = d;
              worst = i;
            }
          }
          centroids[c] = [...data[worst]];
          continue;
        }
        const mean = new Array<number>(dim).fill(0);
        for (const m of members) for (let d = 0; d < dim; d++) mean[d] += m[d];
        for (let d = 0; d < dim; d++) mean[d] /= members.length;
        centroids[c] = mean;
      }

      if (stable && it > 0) {
        converged = true;
        break;
      }
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) {
      inertia += distance(data[i], centroids[assignments[i]], metric) ** 2;
    }
    if (!best || inertia < best.inertia) {
      best = { assignments, centroids, inertia, iterations, converged };
    }
  }

  const b = best!;
  const sizes = new Array<number>(kk).fill(0);
  for (const a of b.assignments) sizes[a]++;
  if (sizes.some((s) => s === 0)) notes.push("One or more clusters ended up empty.");
  if (!b.converged) notes.push("Did not fully converge within the iteration limit.");

  return {
    assignments: b.assignments,
    centroids: b.centroids,
    k: kk,
    iterations: b.iterations,
    converged: b.converged,
    inertia: b.inertia,
    silhouette: silhouetteScore(data, b.assignments, metric),
    sizes,
    notes,
  };
}

/** Mean silhouette coefficient - a k-independent measure of cluster separation. */
export function silhouetteScore(
  data: readonly (readonly number[])[],
  assignments: readonly number[],
  metric: DistanceMetric = "euclidean",
): number {
  const n = data.length;
  const clusters = new Set(assignments);
  if (clusters.size < 2 || n < 2) return NaN;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = assignments[i];
    const sums = new Map<number, { s: number; n: number }>();
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const c = assignments[j];
      const e = sums.get(c) ?? { s: 0, n: 0 };
      e.s += distance(data[i], data[j], metric);
      e.n++;
      sums.set(c, e);
    }
    const ownE = sums.get(own);
    const a = ownE && ownE.n > 0 ? ownE.s / ownE.n : 0;
    let b = Infinity;
    for (const [c, e] of sums) {
      if (c === own || e.n === 0) continue;
      b = Math.min(b, e.s / e.n);
    }
    if (!Number.isFinite(b)) continue;
    const denom = Math.max(a, b);
    total += denom === 0 ? 0 : (b - a) / denom;
  }
  return total / n;
}

export interface DendrogramNode {
  id: number;
  /** Leaf index into the original rows, or null for internal nodes. */
  leaf: number | null;
  left: DendrogramNode | null;
  right: DendrogramNode | null;
  height: number;
  /** All leaf indices under this node, in draw order. */
  members: number[];
}

export interface HierarchicalResult {
  root: DendrogramNode | null;
  /** Leaf indices in dendrogram left-to-right order. */
  order: number[];
  linkage: Linkage;
  metric: DistanceMetric;
  notes: string[];
}

/**
 * Agglomerative hierarchical clustering.
 *
 * Ward linkage uses the Lance-Williams update on squared Euclidean distance;
 * the other linkages update on the chosen metric directly.
 */
export function hierarchical(
  data: readonly (readonly number[])[],
  opts: { linkage?: Linkage; metric?: DistanceMetric } = {},
): HierarchicalResult {
  const { linkage = "average", metric = "euclidean" } = opts;
  const notes: string[] = [];
  const n = data.length;
  if (n === 0) return { root: null, order: [], linkage, metric, notes: ["No rows."] };
  if (n === 1) {
    return {
      root: { id: 0, leaf: 0, left: null, right: null, height: 0, members: [0] },
      order: [0], linkage, metric, notes,
    };
  }

  const ward = linkage === "ward";
  if (ward && metric !== "euclidean") {
    notes.push("Ward linkage assumes Euclidean distance; metric overridden.");
  }
  const effMetric: DistanceMetric = ward ? "euclidean" : metric;

  // Pairwise distance matrix. Ward operates on squared distances.
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = distance(data[i], data[j], effMetric);
      const stored = ward ? v * v : v;
      d[i][j] = stored;
      d[j][i] = stored;
    }
  }

  const nodes = new Map<number, DendrogramNode>();
  const sizes = new Map<number, number>();
  const active: number[] = [];
  for (let i = 0; i < n; i++) {
    nodes.set(i, { id: i, leaf: i, left: null, right: null, height: 0, members: [i] });
    sizes.set(i, 1);
    active.push(i);
  }

  let nextId = n;
  const dist = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) dist.set(key(i, j), d[i][j]);
  }

  while (active.length > 1) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const dv = dist.get(key(active[x], active[y]));
        if (dv !== undefined && dv < bestD) {
          bestD = dv;
          bestA = active[x];
          bestB = active[y];
        }
      }
    }
    if (bestA < 0) break;

    const na = nodes.get(bestA)!;
    const nb = nodes.get(bestB)!;
    const sa = sizes.get(bestA)!;
    const sb = sizes.get(bestB)!;
    const merged: DendrogramNode = {
      id: nextId,
      leaf: null,
      left: na,
      right: nb,
      // Report Ward heights on the original distance scale.
      height: ward ? Math.sqrt(Math.max(0, bestD)) : bestD,
      members: [...na.members, ...nb.members],
    };
    nodes.set(nextId, merged);
    sizes.set(nextId, sa + sb);

    for (const c of active) {
      if (c === bestA || c === bestB) continue;
      const dac = dist.get(key(bestA, c))!;
      const dbc = dist.get(key(bestB, c))!;
      let nd: number;
      if (linkage === "single") nd = Math.min(dac, dbc);
      else if (linkage === "complete") nd = Math.max(dac, dbc);
      else if (linkage === "average") nd = (sa * dac + sb * dbc) / (sa + sb);
      else {
        // Ward (Lance-Williams on squared distances)
        const sc = sizes.get(c)!;
        const t = sa + sb + sc;
        nd = ((sa + sc) * dac + (sb + sc) * dbc - sc * bestD) / t;
      }
      dist.set(key(nextId, c), nd);
    }

    active.splice(active.indexOf(bestA), 1);
    active.splice(active.indexOf(bestB), 1);
    active.push(nextId);
    nextId++;
  }

  const root = nodes.get(active[0]) ?? null;
  return { root, order: root ? root.members : [], linkage, metric: effMetric, notes };
}

/** Cuts a dendrogram into exactly k clusters by descending the tallest merges. */
export function cutTree(root: DendrogramNode | null, k: number): number[] {
  if (!root) return [];
  const leaves = root.members.length;
  const assignments = new Array<number>(leaves).fill(0);
  if (k <= 1) return root.members.map(() => 0);

  // Repeatedly split the node with the greatest merge height.
  let frontier: DendrogramNode[] = [root];
  while (frontier.length < Math.min(k, leaves)) {
    let idx = -1;
    let best = -Infinity;
    for (let i = 0; i < frontier.length; i++) {
      const n = frontier[i];
      if (n.left && n.right && n.height > best) {
        best = n.height;
        idx = i;
      }
    }
    if (idx < 0) break;
    const node = frontier[idx];
    frontier = [
      ...frontier.slice(0, idx),
      node.left!,
      node.right!,
      ...frontier.slice(idx + 1),
    ];
  }

  frontier.forEach((node, ci) => {
    for (const leaf of node.members) assignments[leaf] = ci;
  });
  return assignments;
}
