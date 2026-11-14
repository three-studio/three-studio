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
import {
  activateCore,
  createCoreRegistries,
  createStarterScene,
  deserializeScene,
  serializeScene,
} from '@three-studio/core';

// The component types a document is read through, made and filled once by the
// app: nothing registers by being imported.
const registries = createCoreRegistries();
activateCore(registries);

const scene = createStarterScene();
const json = serializeScene(scene);

// Takes the text, not a parsed object: reading is where the format is checked,
// and a document of another format is refused rather than converted.
const restored = deserializeScene(registries, json);
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

Every on-disk format carries a version. Until 1.0.0 a file of another version is refused, with
diagnostics, and nothing converts it; a component of a type this build does not define is kept
exactly as found.

## Status

A proof of concept. It runs and it is tested, but on-disk formats still change between releases and
there is no stability guarantee. See the
[project README](https://github.com/three-studio/three-studio#-project-status).

## License

[MIT](LICENSE)
