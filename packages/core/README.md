# @three-studio/core

The data layer of [Three Studio](https://github.com/three-studio/three-studio) — a desktop 3D game
editor built on Three.js, React and Electron.

Scene documents, project files, prefabs, the component tables, the asset manifest, and the
serialization that reads and writes all of it. **It depends on nothing** — not three, not React, not
Node — which is what lets the editor, the runtime, the Electron main process and an exported web
build all agree on one shape for a scene.

```bash
npm install @three-studio/core
```

## Use

```ts
import { createStarterScene, serializeScene, deserializeScene } from '@three-studio/core';

const scene = createStarterScene();
const json = serializeScene(scene);

// Takes the text, not a parsed object: reading is where the versioned migrations
// run, so a document written by an older build loads without losing the fields
// this build does not know about.
const restored = deserializeScene(json);
```

## What's in it

| | |
| --- | --- |
| **Scene** | `SceneDoc`, the entity hierarchy, the component tables (`componentsOf`, `putComponent`, …), the graph edits (`insertEntity`, `reparentEntity`, `removeSubtree`) |
| **Components** | `mesh` · `model` · `camera` · `light` · `collider` · `rigidbody` · `script` · `audioSource` · `audioListener` · `playerController` · `prefabInstance`, each with a declared schema |
| **Prefabs** | `prefabFromEntities`, `expandPrefabs`, `applyPrefabOverride`, variants |
| **Project** | `ProjectFile`, scene registry, build profiles, physics and rendering settings |
| **Assets** | the manifest, `.meta.json` sidecars, the importer registry and its per-format settings |
| **Serialization** | versioned read/write for scenes, prefabs and projects |

Every on-disk format carries a version and migrates forward through its own factory. Unknown fields
are left untouched rather than dropped.

## Status

A proof of concept. It runs and it is tested, but on-disk formats still change between releases and
there is no stability guarantee. See the
[project README](https://github.com/three-studio/three-studio#-project-status).

## License

[MIT](LICENSE)
