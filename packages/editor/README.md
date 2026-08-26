# @three-studio/editor

The editor UI of [Three Studio](https://github.com/three-studio/three-studio) — a desktop 3D game
editor built on Three.js, React and Electron.

A React shell rather than a component library: dockable panels (Viewport, Game, Hierarchy, Inspector,
Project, Console), transform gizmos and GPU picking in the viewport, an Inspector generated from each
component's declared schema, a command registry driving the menu bar, the toolbar and the shortcuts,
and the import dialog with its live previews.

```bash
npm install @three-studio/editor @three-studio/core @three-studio/runtime react react-dom three
```

## Read this first

This package is the shell of a specific application, not a general-purpose editor widget. It expects
a **platform bridge** on the host — the object `@three-studio/core` types as `StudioBridge`, which
reads and writes projects, imports assets, compiles scripts and exports builds. Electron supplies it
in Three Studio. Mounting `Root` without one gets you the launcher and nothing behind it.

It also needs the same `three` → `three/webgpu` bundler alias that
[`@three-studio/runtime`](https://www.npmjs.com/package/@three-studio/runtime) needs — see that
package's README for why.

## Use

```tsx
import { Root } from '@three-studio/editor';
import '@three-studio/editor/styles.css';
import '@fontsource-variable/inter'; // the chrome asks for Inter Variable
import { createRoot } from 'react-dom/client';

// Deliberately no <StrictMode>: the viewport owns imperative GPU resources
// (renderer, device, physics world) and the double mount leaks a second one.
createRoot(document.getElementById('root')!).render(<Root />);
```

`styles.css` ships compiled — the Tailwind build, the design tokens and dockview's stylesheet in one
file. If you write your own markup against the editor's utility classes, run Tailwind over your
sources on your side; this stylesheet only carries what the editor itself uses.

## Status

A proof of concept, and the most application-specific of the three packages. See the
[project README](https://github.com/three-studio/three-studio#-project-status).

## License

[MIT](LICENSE)
