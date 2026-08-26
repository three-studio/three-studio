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

The engine owns the scene graph, physics and behaviours — but neither the renderer nor the frame
loop. The host calls `update(delta)` and draws `engine.scene` itself, which is what lets the editor
play a scene inside its own viewport while an exported build runs the same code from a bare loop.

```ts
import { deserializeScene } from '@three-studio/core';
import { SceneHost, createRenderer } from '@three-studio/runtime';

const canvas = document.querySelector('canvas')!;
const { renderer } = await createRenderer({ canvas });

const host = new SceneHost({
  domElement: canvas,
  renderer,
  source: { read: async (name) => deserializeScene(await (await fetch(`${name}.json`)).text()) },
  // Maps an asset id to a URL. Scenes reference ids, never paths, so this is
  // where a build decides where its files actually live.
  resolver: { url: (assetId) => `assets/${assetId}` },
});

await host.load('level-1').activate();

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  // Clamped: a backgrounded tab resumes with a delta of several seconds, which
  // would teleport every body through the floor on the first step.
  const delta = Math.min((now - last) / 1000, 0.1);
  last = now;

  host.update(delta);
  const engine = host.engine;
  if (engine) void renderer.render(engine.scene, engine.activeCamera);
});
```

## What's in it

| | |
| --- | --- |
| **Engine** | fixed-step loop, system layer, resource arena, mesh batching |
| **Scenes** | `SceneHost` (load, loading scene, activate, cancel), `SceneBinder` (document → three objects) |
| **Rendering** | `createRenderer` — WebGPU, falling back to WebGL |
| **Physics** | `PhysicsWorld` — Rapier rigid bodies, colliders, and a character-style `PlayerController` |
| **Scripting** | `Behaviour` and the lifecycle hooks (`onAwake` / `onStart` / `onUpdate` / `onFixedUpdate` / `onLateUpdate` / `onDestroy`), declared editable properties, `registerScript` |
| **Audio** | 32-voice mixer with priority stealing, a continuous 2D↔3D `spatialBlend`, buses |
| **Assets** | model loading for glTF / GLB / FBX / OBJ, import settings applied the same way the editor applies them |

## Status

A proof of concept. It runs and it is tested, but there is no stability guarantee. See the
[project README](https://github.com/three-studio/three-studio#-project-status).

## License

[MIT](LICENSE)
