import { activateCore, createCoreRegistries, type CoreRegistries } from '@three-studio/core';
import * as particlesCore from '@three-studio/particles/core';
import * as particlesEditor from '@three-studio/particles/editor';
import * as particlesRuntime from '@three-studio/particles/runtime';
import { activateRuntime } from '@three-studio/runtime';
// By path, not through the editor's entry point: that one mounts the application, and reads `window` as it loads.
import { activateEditor } from '../../../packages/editor/src/activate';
import { createEditorRegistries, type EditorRegistries } from '../../../packages/editor/src/registries';

/** A window's registries with particles in them, activated as its root does: layer by layer, the kernel first. */
export function registriesWithParticles(): EditorRegistries {
  const registries = createEditorRegistries();
  activateCore(registries);
  particlesCore.activate(registries);
  activateRuntime(registries);
  particlesRuntime.activate(registries);
  activateEditor(registries);
  particlesEditor.activate(registries);
  return registries;
}

/** Core's registries as a build without this module makes them: the kernel alone. */
export function kernelRegistries(): CoreRegistries {
  const registries = createCoreRegistries();
  activateCore(registries);
  return registries;
}
