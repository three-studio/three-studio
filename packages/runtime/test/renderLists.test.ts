import { describe, expect, it } from 'vitest';
import { forgetRenderLists } from '../src/world/renderLists';

/*
 * A world kept across its scenes lets the renderer's render lists go when a
 * scene leaves: three 0.185 keeps, through a texture no one disposes, the
 * shadow cameras of lights long gone, and through them every list they drew.
 * A renderer cannot be made in Node, so this is the call on a renderer's shape.
 */

describe('forgetRenderLists', () => {
  it("disposes the renderer's render lists", () => {
    let disposed = 0;
    const lists = {
      dispose() {
        disposed += 1;
      },
    };
    forgetRenderLists({ _renderLists: lists });
    expect(disposed).toBe(1);
  });

  it('does nothing for a renderer not initialised yet, or none', () => {
    expect(() => forgetRenderLists({ _renderLists: null })).not.toThrow();
    expect(() => forgetRenderLists({})).not.toThrow();
    expect(() => forgetRenderLists(null)).not.toThrow();
  });
});
