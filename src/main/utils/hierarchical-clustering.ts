// Minimal agglomerative hierarchical clustering on cosine distances,
// with both threshold-based (cdist) and fixed-k cuts. Used by the
// diarization service to re-cluster cached embeddings without re-running
// the heavy embedding extraction — so the user can iterate on threshold
// and speaker count in milliseconds instead of minutes.
//
// We mirror the behaviour of sherpa-onnx's FastClustering (complete
// linkage on cosine-distance with `cutree_cdist` / `cutree_k`) so the
// re-clustering produces equivalent results to running sherpa from
// scratch with new params.

/**
 * Compute pairwise cosine distance matrix (flattened condensed form).
 * `embeddings[i]` is the i-th feature vector.
 *
 * Returns a length n*(n-1)/2 Float64Array of distances, with the same
 * ordering convention as scipy.spatial.distance.squareform:
 *   d[k] for k = (n*(n-1)/2 - (n-i)*(n-i-1)/2 + (j - i - 1))
 *
 * Distances are clamped to [0, 2] (cosine similarity ∈ [-1, 1] →
 * 1 - sim ∈ [0, 2]).
 */
export function pairwiseCosineDistance(embeddings: Float32Array[]): Float64Array {
  const n = embeddings.length;
  const condensed = new Float64Array((n * (n - 1)) / 2);

  // Pre-normalize each embedding so cosine sim becomes a plain dot product.
  const normalized: Float32Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = embeddings[i]!;
    let s = 0;
    for (let d = 0; d < e.length; d++) s += e[d]! * e[d]!;
    const norm = Math.sqrt(s);
    if (norm <= 1e-12) {
      normalized[i] = new Float32Array(e.length);
    } else {
      const out = new Float32Array(e.length);
      for (let d = 0; d < e.length; d++) out[d] = e[d]! / norm;
      normalized[i] = out;
    }
  }

  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = normalized[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = normalized[j]!;
      let sim = 0;
      for (let d = 0; d < a.length; d++) sim += a[d]! * b[d]!;
      // Clamp to [-1, 1] to absorb floating-point drift.
      if (sim > 1) sim = 1;
      else if (sim < -1) sim = -1;
      condensed[k++] = 1 - sim;
    }
  }
  return condensed;
}

export interface LinkageStep {
  /** Index of the first cluster being merged (0..n-1 = leaf, ≥n = a previous merge). */
  a: number;
  /** Index of the second cluster being merged. */
  b: number;
  /** Distance at which the merge happens (height in the dendrogram). */
  height: number;
}

/**
 * Complete-linkage agglomerative clustering. Naive O(n^3) implementation;
 * fine up to a few thousand points which is far above our diarization
 * scale (typically 200–500 segments).
 *
 * Returns the linkage list with n-1 merges. Cluster IDs follow scipy's
 * convention: leaves are 0..n-1, and each merge step k creates a new
 * cluster with ID n+k.
 */
export function hierarchicalCluster(condensed: Float64Array, n: number): LinkageStep[] {
  if (n <= 1) return [];

  // We keep a dense distance matrix indexed by active cluster id. Each
  // active cluster id starts as 0..n-1 and is later renamed n, n+1, ...
  // after each merge.
  const dist: number[][] = new Array(n);
  for (let i = 0; i < n; i++) dist[i] = new Array<number>(n).fill(0);

  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = condensed[k++]!;
      dist[i]![j] = d;
      dist[j]![i] = d;
    }
  }

  // Active cluster ids (in dist matrix coordinates → linkage coordinates).
  const activeRowToId: number[] = new Array(n);
  for (let i = 0; i < n; i++) activeRowToId[i] = i;
  let active = n;

  const steps: LinkageStep[] = [];

  for (let merge = 0; merge < n - 1; merge++) {
    // Find the pair with the smallest distance among active rows.
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < active; i++) {
      const row = dist[i]!;
      for (let j = i + 1; j < active; j++) {
        const d = row[j]!;
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const idA = activeRowToId[bestI]!;
    const idB = activeRowToId[bestJ]!;
    const newId = n + merge;
    steps.push({ a: idA, b: idB, height: bestD });

    // Complete linkage merge: new cluster's distance to any other cluster
    // is the MAX of (dist to A, dist to B). We collapse row/col bestJ
    // into bestI, then swap the last active row into bestJ's slot.
    for (let m = 0; m < active; m++) {
      if (m === bestI || m === bestJ) continue;
      const nd = Math.max(dist[bestI]![m]!, dist[bestJ]![m]!);
      dist[bestI]![m] = nd;
      dist[m]![bestI] = nd;
    }
    activeRowToId[bestI] = newId;

    // Remove row/col bestJ by swapping with the last active row.
    const last = active - 1;
    if (bestJ !== last) {
      for (let m = 0; m < active; m++) {
        dist[m]![bestJ] = dist[m]![last]!;
      }
      for (let m = 0; m < active; m++) {
        dist[bestJ]![m] = dist[last]![m]!;
      }
      activeRowToId[bestJ] = activeRowToId[last]!;
    }
    active = last;
  }

  return steps;
}

/**
 * Resolve a merge tree into N cluster labels (one per original leaf) by
 * cutting the dendrogram at a maximum distance threshold. Mirrors
 * fastcluster's cutree_cdist: clusters merged at heights ≥ threshold
 * stay separate. Higher threshold ⇒ fewer clusters.
 */
export function cutTreeByDistance(steps: LinkageStep[], n: number, threshold: number): number[] {
  return cutTree(steps, n, (step) => step.height >= threshold);
}

/**
 * Resolve a merge tree into N cluster labels by stopping at exactly K
 * clusters. Mirrors fastcluster's cutree_k.
 */
export function cutTreeByK(steps: LinkageStep[], n: number, k: number): number[] {
  if (k <= 1) return new Array(n).fill(0);
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  // Skip the last (n-k) merges: those merge tree levels are above where
  // we want to cut. The first (n-k) merges define the merge tree below
  // the cut, so we stop applying merges once we've done (n-k) of them.
  const cutoffMergeIndex = n - k;
  return cutTree(steps, n, (_step, index) => index >= cutoffMergeIndex);
}

function cutTree(
  steps: LinkageStep[],
  n: number,
  shouldStop: (step: LinkageStep, index: number) => boolean
): number[] {
  // Union-find with path compression. Each leaf starts in its own cluster.
  // Each merge step k creates a virtual cluster id n+k. We need find(n+k)
  // to resolve to the same root as the leaves that fell under it, so when
  // a later step references that virtual id we still hit the right set.
  const parent = new Array<number>(2 * n - 1);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r]! !== r) r = parent[r]!;
    let cur = i;
    while (parent[cur]! !== r) {
      const next = parent[cur]!;
      parent[cur] = r;
      cur = next;
    }
    return r;
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (shouldStop(step, i)) break;
    const ra = find(step.a);
    const rb = find(step.b);
    if (ra !== rb) parent[ra] = rb;
    // Wire the freshly-created virtual cluster id into the same set, so
    // later steps that reference it (step.a or step.b = n+i) resolve to
    // the correct root.
    parent[n + i] = find(step.a);
  }
  // Now leaves 0..n-1 are partitioned by their root.
  const labels = new Array<number>(n);
  const rootToLabel = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let label = rootToLabel.get(r);
    if (label === undefined) {
      label = rootToLabel.size;
      rootToLabel.set(r, label);
    }
    labels[i] = label;
  }
  return labels;
}

/**
 * Convenience: full pipeline from embeddings → cluster labels.
 */
export function clusterEmbeddings(
  embeddings: Float32Array[],
  options: { numClusters?: number; threshold?: number }
): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const condensed = pairwiseCosineDistance(embeddings);
  const steps = hierarchicalCluster(condensed, n);
  if (typeof options.numClusters === 'number' && options.numClusters > 0) {
    return cutTreeByK(steps, n, options.numClusters);
  }
  const threshold = options.threshold ?? 0.5;
  return cutTreeByDistance(steps, n, threshold);
}
