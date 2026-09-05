# T-019 — Un index pour ne pas relire le disque à chaque fois
Lot 9 · dépend de T-018 · statut: **TODO**

## Pourquoi
Deux parcours O(tout) là où O(ce qui a changé) suffirait :

- **Les scènes**, depuis T-017 : ouvrir un projet lit l'en-tête de chaque `.scene.json` pour son id.
- **Les assets**, déjà aujourd'hui : `scanAssets` (`assets.ts:55`) fait une marche récursive complète
  de `assets/` à **chaque** mutation. `ipc.ts:302` rappelle `assets:list` après chacune, et
  `assetStore.ts` l'appelle depuis 14 sites. Un renommage coûte un parcours complet du disque.

## Quoi
`.studio/scenes.index.json` et `.studio/assets.index.json` : chemin + mtime + taille → ce qu'on avait
lu. Invalidés par mtime/taille. `.studio/` est déjà déclaré jetable et gitignoré
(`project.ts:76` écrit `.studio/.gitignore` avec `*`), donc un index corrompu ou absent se reconstruit
sans rien perdre — c'est ce qui rend ce cache sûr.

## Attention
`scanAssets` **écrit** les sidecars qu'il trouve manquants ou périmés, et
`apps/desktop/test/upgradeContracts.test.ts:113` vérifie que trois scans concurrents s'accordent.
`claimAssetMeta` (`assets.ts:193`) utilise `link()` comme compare-and-swap pour ça, et le commentaire de
`:140-158` note que c'était un test flaky 4 fois sur 6. **Le cache ne doit pas contourner cette
convergence** : il évite de relire, il n'évite pas de réparer.

## Terminé quand
- [ ] Renommer un asset dans un projet de plusieurs milliers de fichiers ne reparcourt pas tout — mesuré
- [ ] Supprimer `.studio/` et rouvrir : tout se reconstruit, rien n'est perdu
- [ ] `upgradeContracts.test.ts` reste vert, concurrence comprise
- [ ] `npm run typecheck && npm test` verts

## Commit
`perf(desktop): index the project so a rename does not walk the disk`
