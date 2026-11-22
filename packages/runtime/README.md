# @three-studio/runtime

The game runtime of [Three Studio](https://github.com/three-studio/three-studio) — a desktop 3D game
editor built on Three.js, React and Electron.

It takes a scene document from [`@three-studio/core`](https://www.npmjs.com/package/@three-studio/core)
and runs it: three.js (WebGPU with a WebGL fallback) for rendering, Rapier for physics, a script host
for user behaviours, and a hand-built Web Audio graph. It is what an exported web build ships, and
what the editor plays a scene with. It never imports the editor.

```bash
npm install @three-studio/runtime three
```

## Two things to set up first

**1. Alias `three` to `three/webgpu`.** Our own modules import `three/webgpu` explicitly, but three's
addons (`GLTFLoader`, `FBXLoader`, `OrbitControls`, …) import the bare `three` specifier. Without the
alias your bundle carries two copies of three and every `instanceof` across the boundary fails —
silently, at runtime.

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    // Anchored, so `three/addons/*` still resolves normally.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
});
```

**2. Patch three's FBXLoader if you import FBX.** three 0.185.1 reads `LayerElementNormal[0].Normals`
without checking it is there, while guarding `Colors` and `UV` in the same function. An FBX that
declares a normal layer and leaves it empty — which is what an Unreal `UCX_` collision hull is —
throws, and the throw loses the whole file rather than the one empty layer: the mesh next to it never
arrives either. Still unfixed on three's dev branch. The repository carries the one-line guard as
`patches/three+0.185.1.patch`, applied with
[patch-package](https://www.npmjs.com/package/patch-package).

## Use

The world owns the scene graph, physics and behaviours — but neither the renderer nor the frame
loop. The host calls `update(delta)` and draws `world.scene` itself, which is what lets the editor
play a scene inside its own viewport while an exported build runs the same code from a bare loop.

```ts
import { activateCore, decodeScene, unwrap } from '@three-studio/core';
import {
  Game,
  activateRuntime,
  createRenderer,
  createRuntimeRegistries,
} from '@three-studio/runtime';

const canvas = document.querySelector('canvas')!;
const { renderer } = await createRenderer({ canvas });

// What a game is built from — the component types, the system that draws each
// one, and the behaviour of each type that acts — made and filled once, by the
// page, the core's layer first.
const registries = createRuntimeRegistries();
activateCore(registries);
activateRuntime(registries);

const source = {
  read: async (name: string) => unwrap(decodeScene(registries, await (await fetch(`${name}.json`)).text()), name),
};
const game = new Game({
  registries,
  element: canvas,
  renderer,
  source,
  // Maps an asset id to a URL. Scenes reference ids, never paths, so this is
  // where a build decides where its files actually live.
  resolver: { url: (assetId) => `assets/${assetId}` },
});

// One world for the whole game: the first scene starts in it, and every
// `game.go` after loads the next into it.
await game.start('level-1', await source.read('level-1'));

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  // Clamped: a backgrounded tab resumes with a delta of several seconds, which
  // would teleport every body through the floor on the first step.
  const delta = Math.min((now - last) / 1000, 0.1);
  last = now;

  game.update(delta);
  const world = game.world;
  if (world) void renderer.render(world.scene, world.cameras.active);
});
```

## What's in it

| | |
| --- | --- |
| **World** | fixed-step loop, system layer, resource arena, mesh batching |
| **Scenes** | `Game` (one world per game; load, loading scene, activate, cancel), `SceneBinder` (document → three objects) |
| **Rendering** | `createRenderer` — WebGPU, falling back to WebGL |
| **Physics** | `PhysicsWorld` — Rapier rigid bodies, colliders, and a character-style `PlayerController` |
| **Scripting** | `Behaviour` and the lifecycle hooks (`onAwake` / `onStart` / `onUpdate` / `onFixedUpdate` / `onLateUpdate` / `onDestroy`), declared editable properties, entities reached through handles (`this.entity`, `this.world.entity(id)`) and moved through the transform the world draws, what each feature gives scripts by contribution (`scriptMembers`), `scriptClassesOf` — a compiled bundle's classes, decoded and handed to the world that runs them (`scripts`) |
| **Audio** | 32-voice mixer with priority stealing, a continuous 2D↔3D `spatialBlend`, buses |
| **Assets** | model loading for glTF / GLB / FBX / OBJ, import settings applied the same way the editor applies them |

## Status

A proof of concept. It runs and it is tested, but there is no stability guarantee. See the
[project README](https://github.com/three-studio/three-studio#-project-status).

## License

[MIT](LICENSE)
