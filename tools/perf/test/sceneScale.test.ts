import { serializeScene } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { LARGE, largeScene } from '../generate/projects';
import { groupsToSelect, nodeTimings, subtreeSize } from '../scenarios/sceneScale';

describe('the selection scenario 2 duplicates', () => {
  it('is 100 groups, which with their children make 1 000 entities', () => {
    const scene = largeScene(LARGE);
    const groups = groupsToSelect(scene, 100);
    expect(groups).toHaveLength(100);
    expect(subtreeSize(scene, groups)).toBe(1000);
  });

  it('refuses to select more groups than the scene has', () => {
    expect(() => groupsToSelect(largeScene({ groups: 4, columns: 2, childrenPerGroup: 9 }), 5)).toThrow();
  });
});

describe('the scene read and written in Node', () => {
  it('times a decode and an encode on the scene text, and decodes what was written', () => {
    const text = serializeScene(largeScene({ groups: 12, columns: 4, childrenPerGroup: 9 }));
    const timings = nodeTimings(text, 3);
    expect(timings.decodeMs).toBeGreaterThan(0);
    expect(timings.encodeMs).toBeGreaterThan(0);
    expect(timings.entities).toBe(123);
  });
});
