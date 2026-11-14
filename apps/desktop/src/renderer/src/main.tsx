import { activateCore } from '@three-studio/core';
import { Root, activateEditor, createEditorRegistries } from '@three-studio/editor';
import * as particlesCore from '@three-studio/particles/core';
import * as particlesEditor from '@three-studio/particles/editor';
import * as particlesRuntime from '@three-studio/particles/runtime';
import { activateRuntime } from '@three-studio/runtime';
import '@fontsource-variable/inter';
import './styles.css';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// The window's composition root: the one place its registries are made and
// filled. They live as long as the window, so what activating returns is never
// disposed. Nothing here accepts a hot update, so an edit to anything activated
// reloads the window rather than registering a second time.
//
// Layer by layer, the kernel's parts before the modules': a module registers
// into what the kernel has filled, and its line here is all that names it.
const registries = createEditorRegistries();
activateCore(registries);
particlesCore.activate(registries);
activateRuntime(registries);
particlesRuntime.activate(registries);
activateEditor(registries);
particlesEditor.activate(registries);

// Deliberately no <StrictMode>: the viewport owns imperative GPU resources
// (renderer, device, physics world) and StrictMode's double mount would create
// and leak a second one on every remount.
createRoot(container).render(<Root registries={registries} />);
