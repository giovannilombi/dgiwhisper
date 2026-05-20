import { describe, it, expect } from 'vitest';
import {
  pairwiseCosineDistance,
  hierarchicalCluster,
  cutTreeByDistance,
  cutTreeByK,
  clusterEmbeddings,
} from '../hierarchical-clustering';

const e = (...nums: number[]) => Float32Array.from(nums);

describe('pairwiseCosineDistance', () => {
  it('returns 0 for identical vectors', () => {
    const d = pairwiseCosineDistance([e(1, 0, 0), e(1, 0, 0)]);
    expect(d).toHaveLength(1);
    expect(d[0]!).toBeCloseTo(0, 6);
  });

  it('returns 1 for orthogonal vectors', () => {
    const d = pairwiseCosineDistance([e(1, 0), e(0, 1)]);
    expect(d[0]!).toBeCloseTo(1, 6);
  });

  it('returns 2 for opposite vectors', () => {
    const d = pairwiseCosineDistance([e(1, 0), e(-1, 0)]);
    expect(d[0]!).toBeCloseTo(2, 6);
  });

  it('lays out distances in row-major condensed order (i<j)', () => {
    const a = e(1, 0, 0);
    const b = e(0, 1, 0);
    const c = e(0, 0, 1);
    const d = pairwiseCosineDistance([a, b, c]);
    expect(d).toHaveLength(3);
    expect(d[0]!).toBeCloseTo(1, 6); // a vs b
    expect(d[1]!).toBeCloseTo(1, 6); // a vs c
    expect(d[2]!).toBeCloseTo(1, 6); // b vs c
  });
});

describe('hierarchicalCluster + cuts', () => {
  it('groups two obvious clusters by distance threshold', () => {
    // Two tight groups, far apart on the unit sphere.
    const embeddings = [
      e(1, 0),
      e(0.99, 0.1),
      e(0.98, -0.1),
      e(-1, 0),
      e(-0.99, 0.1),
      e(-0.98, -0.1),
    ];
    const labels = clusterEmbeddings(embeddings, { threshold: 0.5 });
    // Members 0,1,2 should share a label; 3,4,5 should share a label;
    // those two labels should differ.
    expect(labels[0]).toBe(labels[1]);
    expect(labels[1]).toBe(labels[2]);
    expect(labels[3]).toBe(labels[4]);
    expect(labels[4]).toBe(labels[5]);
    expect(labels[0]).not.toBe(labels[3]);
  });

  it('cutTreeByK produces exactly K clusters', () => {
    const embeddings = [e(1, 0), e(0.99, 0.05), e(0, 1), e(0.05, 0.99), e(-1, 0)];
    const labels = clusterEmbeddings(embeddings, { numClusters: 3 });
    expect(new Set(labels).size).toBe(3);
  });

  it('cutTreeByK requesting K >= N gives one cluster per leaf', () => {
    const embeddings = [e(1, 0), e(0, 1), e(-1, 0)];
    const labels = clusterEmbeddings(embeddings, { numClusters: 5 });
    expect(new Set(labels).size).toBe(3);
  });

  it('cutTreeByK with K=1 puts everything in one cluster', () => {
    const embeddings = [e(1, 0), e(0, 1), e(-1, 0)];
    const labels = clusterEmbeddings(embeddings, { numClusters: 1 });
    expect(new Set(labels).size).toBe(1);
  });

  it('threshold-based: very high threshold collapses to one cluster', () => {
    const embeddings = [e(1, 0), e(0, 1), e(-1, 0)];
    const labels = clusterEmbeddings(embeddings, { threshold: 5 });
    expect(new Set(labels).size).toBe(1);
  });

  it('threshold-based: very low threshold keeps every point separate', () => {
    const embeddings = [e(1, 0), e(0, 1), e(-1, 0)];
    const labels = clusterEmbeddings(embeddings, { threshold: 0.0001 });
    expect(new Set(labels).size).toBe(3);
  });

  it('handles an empty input', () => {
    expect(clusterEmbeddings([], { threshold: 0.5 })).toEqual([]);
  });

  it('handles a single-point input', () => {
    expect(clusterEmbeddings([e(1, 0)], { threshold: 0.5 })).toEqual([0]);
  });

  it('linkage step count is n-1', () => {
    const embeddings = [e(1, 0), e(0, 1), e(-1, 0), e(0, -1)];
    const condensed = pairwiseCosineDistance(embeddings);
    const steps = hierarchicalCluster(condensed, embeddings.length);
    expect(steps).toHaveLength(3);
  });

  it('complete-linkage: cluster heights are non-decreasing', () => {
    const embeddings = [e(1, 0), e(0.95, 0.05), e(0.9, -0.05), e(-1, 0), e(-0.95, 0.05)];
    const condensed = pairwiseCosineDistance(embeddings);
    const steps = hierarchicalCluster(condensed, embeddings.length);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.height).toBeGreaterThanOrEqual(steps[i - 1]!.height);
    }
  });

  it('cutTreeByDistance directly with linkage and threshold', () => {
    const embeddings = [e(1, 0), e(0.99, 0.05), e(-1, 0)];
    const condensed = pairwiseCosineDistance(embeddings);
    const steps = hierarchicalCluster(condensed, embeddings.length);
    const labels = cutTreeByDistance(steps, embeddings.length, 0.5);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toBe(labels[1]);
  });

  it('cutTreeByK directly with linkage', () => {
    const embeddings = [e(1, 0), e(0.99, 0.05), e(-1, 0), e(-0.99, 0.05)];
    const condensed = pairwiseCosineDistance(embeddings);
    const steps = hierarchicalCluster(condensed, embeddings.length);
    const labels = cutTreeByK(steps, embeddings.length, 2);
    expect(new Set(labels).size).toBe(2);
  });
});
