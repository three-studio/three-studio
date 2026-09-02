import { describe, expect, it } from 'vitest';
import { timescaleFor } from '../src/viewport/timescale';

/*
 * The whole transport policy, as a truth table. Written out rather than
 * generated: the point of the test is that someone reading it can see what each
 * button does without running the editor.
 */
describe('timescaleFor', () => {
  it('holds the editor still by default', () => {
    expect(timescaleFor('stopped', false)).toBe(0);
  });

  it('runs the editor when the viewport asks for it', () => {
    expect(timescaleFor('stopped', true)).toBe(1);
  });

  it('runs while playing, whatever the viewport toggle says', () => {
    expect(timescaleFor('playing', false)).toBe(1);
    expect(timescaleFor('playing', true)).toBe(1);
  });

  it('freezes everything on pause, the toggle included', () => {
    expect(timescaleFor('paused', true)).toBe(0);
    expect(timescaleFor('paused', false)).toBe(0);
  });
});
