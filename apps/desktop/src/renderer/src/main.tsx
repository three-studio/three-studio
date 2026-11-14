import { Root } from '@three-studio/editor';
import { activateRuntime, createRuntimeRegistries } from '@three-studio/runtime';
import '@fontsource-variable/inter';
import './styles.css';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// The window's composition root: the one place its registries are made and
// filled. They live as long as the window, so what activating returns is never
// disposed. Nothing here accepts a hot update, so an edit to anything activated
// reloads the window rather than registering a second time.
const registries = createRuntimeRegistries();
activateRuntime(registries);

// Deliberately no <StrictMode>: the viewport owns imperative GPU resources
// (renderer, device, physics world) and StrictMode's double mount would create
// and leak a second one on every remount.
createRoot(container).render(<Root registries={registries} />);
