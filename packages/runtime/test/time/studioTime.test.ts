import { describe, expect, it } from 'vitest';
import { deltaTime, time } from 'three/tsl';
import { StudioTime } from '../../src/time/StudioTime';

/*
 * The clock, and the one line that makes it the shaders' clock too.
 *
 * `install` writes over a module singleton of three's, so the last test in this
 * file leaves `time` pointing at whatever instance ran last. That is fine here —
 * nothing else in the suite reads it — and it is exactly why the class takes no
 * global itself: a binder is handed an instance, so a test can drive its own.
 */

/** What a node's `update` hook is given. Only `time` and `deltaTime` are bound. */
const pump = () => {
  time.update({} as never);
  deltaTime.update({} as never);
};

describe('StudioTime', () => {
  it('accumulates the deltas it is advanced by', () => {
    const clock = new StudioTime();
    clock.advance(0.5);
    clock.advance(0.25);

    expect(clock.delta).toBeCloseTo(0.25);
    expect(clock.elapsed).toBeCloseTo(0.75);
  });

  it('scales what it accumulates', () => {
    const clock = new StudioTime();
    clock.timescale = 0.5;
    clock.advance(1);

    expect(clock.delta).toBeCloseTo(0.5);
    expect(clock.elapsed).toBeCloseTo(0.5);
  });

  it('stands still at a timescale of zero', () => {
    const clock = new StudioTime();
    clock.advance(1);
    clock.timescale = 0;
    clock.advance(1);
    clock.advance(1);

    expect(clock.delta).toBe(0);
    expect(clock.elapsed).toBeCloseTo(1);
  });

  it('steps through a zero timescale, because that is what Step is for', () => {
    const clock = new StudioTime();
    clock.timescale = 0;
    clock.step(1 / 60);

    expect(clock.delta).toBeCloseTo(1 / 60);
    expect(clock.elapsed).toBeCloseTo(1 / 60);
  });

  it('refuses a timescale that would rewind or poison a uniform', () => {
    const clock = new StudioTime();
    clock.timescale = -1;
    expect(clock.timescale).toBe(1);

    clock.timescale = Number.NaN;
    expect(clock.timescale).toBe(1);
  });

  it('ignores a delta that is not a duration', () => {
    const clock = new StudioTime();
    clock.advance(Number.NaN);
    clock.advance(-1);

    expect(clock.elapsed).toBe(0);
  });

  it('makes three’s time and deltaTime nodes read it', () => {
    const clock = new StudioTime();
    clock.install();
    clock.advance(0.25);
    clock.advance(0.25);
    pump();

    expect(time.value).toBeCloseTo(0.5);
    expect(deltaTime.value).toBeCloseTo(0.25);
  });

  it('lets the last clock installed win, so two never fight', () => {
    const first = new StudioTime();
    const second = new StudioTime();
    first.install();
    second.install();

    first.advance(10);
    second.advance(2);
    pump();

    expect(time.value).toBeCloseTo(2);
  });
});
