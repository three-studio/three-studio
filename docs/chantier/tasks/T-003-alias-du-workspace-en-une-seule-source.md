# T-003 — Les alias du workspace en une seule source
Lot 0 · dépend de T-002 · statut: **TODO**

## Pourquoi
La correspondance `@three-studio/{core,runtime,editor}` → `packages/*/src` est écrite **quatre fois,
indépendamment** :

- `tsconfig.base.json:27-34` — `paths`, six entrées à la main
- `vitest.config.ts:9-18` — un `flatMap` sur `['core','runtime','editor']`
- `apps/desktop/electron.vite.config.ts:19-30` — le même `flatMap`, pour `main`, `preload`, `renderer`
- `apps/web-template/vite.config.ts:9-19` — le même encore

Et elles ont **déjà divergé** : l'alias `three → three/webgpu` est présent dans les deux configs Vite
(`electron.vite.config.ts:55`, `web-template/vite.config.ts:26`) et **absent de `vitest.config.ts`**.
Un test qui compare un `instanceof` à travers cette frontière ne teste pas ce que le produit fait.

## Quoi
Une seule déclaration des alias, importée par les trois configs Vite/Vitest. `tsconfig.base.json` reste
à part — c'est du JSON que TypeScript lit, il ne peut pas importer — mais un test la compare à la source.
Ajouter `three → three/webgpu` à `vitest.config.ts` au passage.

## Fichiers
- nouveau : un module d'alias partagé (à la racine, à côté de `vitest.config.ts`)
- `vitest.config.ts`, `apps/desktop/electron.vite.config.ts`, `apps/web-template/vite.config.ts`
- le test qui compare `tsconfig.base.json` aux alias

## Attention
Les configs de build de chaque package **vident** `paths` (`packages/*/tsconfig.build.json:19-23`) pour
que la résolution passe par `node_modules` comme chez un consommateur. Ne pas y toucher.

## Terminé quand
- [ ] Les trois configs lisent la même source
- [ ] `vitest.config.ts` aliase `three` vers `three/webgpu`
- [ ] Un test échoue si `tsconfig.base.json` et la source commune divergent
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(build): the workspace aliases are declared once, not four times`
