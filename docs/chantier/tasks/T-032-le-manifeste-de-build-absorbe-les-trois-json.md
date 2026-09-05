# T-032 — Le manifeste de build absorbe les trois JSON satellites
Lot 10 · dépend de T-017 · statut: **TODO**

## Pourquoi
Un build sert **six** fichiers avant la première frame : `build.json`, `assets.json`,
`materials.json`, `prefabs.json`, `scene.json`, `scripts.mjs`. Les trois du milieu sont petits et
**toujours** nécessaires — les servir séparément, c'est trois allers-retours pour rien.

## Quoi
`assets.json`, `materials.json` et `prefabs.json` deviennent trois champs de `build.json`. Six requêtes
→ trois. Écritures dans `exportWeb.ts:225-240`, lectures dans `apps/web-template/src/main.ts`.

Au passage : `BuildManifest` est **déclaré trois fois** — écrit sans annotation
(`exportWeb.ts:248-273`), relu par une interface réécrite à la main (`web-template/src/main.ts:39-65`),
et une troisième copie partielle dans `entryScene.ts:4-9`. **Le monter dans `packages/core`**, que
l'exportateur le renvoie typé et que le player l'importe. C'est le seul contrat inter-process qui ne
soit pas centralisé — `StudioBridge` (`core/src/bridge.ts:268`) montre déjà comment faire, et
`scripts.ts:13-16` raconte ce qu'a coûté la dernière déclaration en double.

Bumper `BUILD_FORMAT_VERSION`.

## Terminé quand
- [ ] Trois requêtes avant la première frame, comptées dans l'onglet réseau sur `npx serve`
- [ ] `BuildManifest` déclaré une fois, dans `core`
- [ ] `apps/desktop/test/exportWeb.test.ts` et `apps/web-template/test/` verts
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(export): one manifest instead of four, declared once in core`
