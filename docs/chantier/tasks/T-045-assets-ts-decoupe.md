# T-045 — `assets.ts` découpé
Lot 4 · dépend de T-044 · statut: **TODO**

## Pourquoi
820 lignes, aucune classe, 20 fonctions exportées prenant toutes `projectPath` en premier argument —
le module *est* un espace de noms sur un projet. Il fait : le scan et l'adoption, les sidecars
concurrents, le sniffing de contenu, les mutations, les bibliothèques prefab/matériau, et il exporte
des utilitaires à quatre autres modules.

## Quoi
`assetScan.ts` (scan, adoption, sidecars) · `assetMutations.ts` (déplacer, supprimer, dossiers) ·
`assetLibraries.ts` (matériaux, prefabs) · les utilitaires partagés à leur place.

## Attention
`claimAssetMeta` (`:193`) utilise `link()` comme compare-and-swap pour que deux scans concurrents
convergent sur un id, avec un chemin `EEXIST` documenté et un repli exFAT/réseau. Le commentaire de
`:140-158` note que c'était un test flaky 4 fois sur 6. **Ce code ne se simplifie pas** :
`upgradeContracts.test.ts:113` vérifie que trois scans concurrents s'accordent.

`readerBeside` (`:337`) est le point d'injection qui laisse les importeurs de `core` suivre un `.gltf`
dans ses buffers sans savoir que Node existe. Il reste.

## Terminé quand
- [ ] Chaque fichier a un métier ; les quatre consommateurs importent la même chose qu'avant
- [ ] `upgradeContracts.test.ts` vert, concurrence comprise
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(desktop): the asset module is four modules`
