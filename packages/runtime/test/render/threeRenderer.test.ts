import { describe, expect, it } from 'vitest';
import { forgetRenderLists, retireFrameBufferTarget } from '../../src/render/threeRenderer';

/*
 * The adapter reaches three's private fields. A renderer cannot be made in
 * Node, so these are the calls on a renderer's shape.
 */

function disposable(): { dispose(): void; disposed: number } {
  return {
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
  };
}

describe('forgetRenderLists', () => {
  it("disposes the renderer's render lists", () => {
    const lists = disposable();
    forgetRenderLists({ _renderLists: lists });
    expect(lists.disposed).toBe(1);
  });

  it('does nothing for a renderer not initialised yet, or none', () => {
    expect(() => forgetRenderLists({ _renderLists: null })).not.toThrow();
    expect(() => forgetRenderLists({})).not.toThrow();
    expect(() => forgetRenderLists(null)).not.toThrow();
  });
});

describe('retireFrameBufferTarget', () => {
  it('disposes every output target and forgets them', () => {
    const first = disposable();
    const second = disposable();
    const targets = new Map([
      ['a', first],
      ['b', second],
    ]);
    retireFrameBufferTarget({ _frameBufferTargets: targets });
    expect([first.disposed, second.disposed]).toEqual([1, 1]);
    expect(targets.size).toBe(0);
  });

  it('does nothing for a renderer without them', () => {
    expect(() => retireFrameBufferTarget({})).not.toThrow();
    expect(() => retireFrameBufferTarget({ _frameBufferTargets: null })).not.toThrow();
  });
});
