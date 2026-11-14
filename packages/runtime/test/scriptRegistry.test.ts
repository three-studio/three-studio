import { afterEach, describe, expect, it } from 'vitest';
import {
  Behaviour,
  clearScripts,
  registerScript,
  scriptClassFor,
} from '../src/scripting/ScriptHost';

/*
 * A compiled bundle registers each script under its asset id, and a bundle is
 * written by an author. Nothing checks what it says before it says it, so the
 * registry does: an id is a text that is not empty, and a script registered
 * under anything else could never be found by the component that names it.
 */

class Door extends Behaviour {}

afterEach(clearScripts);

describe('registering a compiled script', () => {
  it('files it under the asset id it was given', () => {
    registerScript('script-door', Door);

    expect(scriptClassFor('script-door')).toBe(Door);
  });

  it('registers nothing under an id that is not one', () => {
    registerScript('', Door);

    // `''` is a script component with no script chosen. Filed under it, a
    // component with nothing chosen would run whichever bundle registered last.
    expect(scriptClassFor('')).toBeUndefined();
  });
});
