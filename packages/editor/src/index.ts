/*
 * The editor is a shell, not a component library: `Root` mounts the whole
 * application — launcher or editor window, chosen from the platform bridge —
 * and `App` is the editor window on its own. The chrome they render needs
 * `@three-studio/editor/styles.css` alongside them.
 */
export { App } from './App';
export { Root } from './Root';
