import { describe, expect, it } from 'vitest';
import { BIG_ASSETS_METRICS } from '../scenarios/bigAssets';

/*
 * Scenario 1 reads, after what deleting a model leaves behind, what undoing
 * the delete costs: the first frame with the model drawn again. With the
 * window's asset cache a model above its budget is freed at the delete, so the
 * undo reloads it, where it used to be instant and the memory never came back.
 */

describe('scenario 1', () => {
  it('reads the undo of a deleted model as a timing, for each model', () => {
    for (const recipe of ['geometry', 'textures']) {
      expect(BIG_ASSETS_METRICS.get(`${recipe}.restored.firstFrameMs`)).toEqual({ kind: 'timing', unit: 'ms' });
    }
  });

  it('reads it after the memory the delete left, as the launch takes them', () => {
    const names = [...BIG_ASSETS_METRICS.keys()];
    for (const recipe of ['geometry', 'textures']) {
      expect(names.indexOf(`${recipe}.restored.firstFrameMs`)).toBe(names.indexOf(`${recipe}.deleted.gpuBytes`) + 1);
    }
  });
});
