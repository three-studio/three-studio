# T-034 — Les assets exportés portent l'empreinte de leur contenu
Lot 10 · dépend de T-033 · statut: **TODO**

## Pourquoi
Le bundle du player est haché par Vite (`index-B4RfG0MO.js`), les fichiers du projet gardent leur nom
d'origine (`exportWeb.ts:184-188`). Re-exporter avec une texture modifiée sert donc **la version
périmée** depuis le cache du navigateur — un bug de production, silencieux, sur un site déjà visité.

Et c'est gratuit à corriger : l'indirection existe déjà. Le player ne voit jamais un nom de fichier, il
lit une table id → chemin.

## Quoi
`<nom>.<hash8>.<ext>` à la copie ; le hash sort du contenu. `hashFile` existe déjà dans
`apps/desktop/src/main/assets.ts`.

Attention aux **compagnons** : un `.gltf` nomme son buffer et ses images **dans le fichier**
(`exportWeb.ts:193-204`). Les hacher casserait ces références. Soit les laisser tels quels dans un
dossier propre au modèle, soit réécrire le `.gltf` — la première option est la plus simple et suffit.

## Terminé quand
- [ ] Re-exporter avec une texture modifiée, sans vider le cache : la nouvelle texture s'affiche
- [ ] Un `.gltf` avec buffer externe et textures externes charge toujours
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(export): content-hash asset filenames so a re-export is not served stale`
