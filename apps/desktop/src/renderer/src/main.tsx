import { Root } from '@three-studio/editor';
import '@fontsource-variable/inter';
import './styles.css';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// Deliberately no <StrictMode>: the viewport owns imperative GPU resources
// (renderer, device, physics world) and StrictMode's double mount would create
// and leak a second one on every remount.
createRoot(container).render(<Root />);
