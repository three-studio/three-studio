import { activateCore } from '@three-studio/core';
import { activateRuntime } from '@three-studio/runtime';
import { activateEditor } from '../src/activate';
import { createEditorRegistries, type EditorRegistries } from '../src/registries';

/**
 * The editor window's registries with the kernel's built-ins in them, as its
 * composition root makes them.
 *
 * A test file holds one at its top and hands it to whatever it builds. A test
 * that registers something of its own makes registries of its own, so what it
 * adds reaches no other test.
 */
export function builtInRegistries(): EditorRegistries {
  const registries = createEditorRegistries();
  activateCore(registries);
  activateRuntime(registries);
  activateEditor(registries);
  return registries;
}
