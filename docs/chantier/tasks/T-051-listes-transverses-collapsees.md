# T-051 — Les listes transverses collapsées
Lot 5 · dépend de T-050 · statut: **TODO**

## Pourquoi
Le même savoir, écrit à plusieurs endroits :

- **URL `studio-asset://`** construite à la main **4 fois** : `assetStore.ts:354-355`,
  `assetField.ts:67`, `ProjectPanel.tsx:522`, `web-template/src/urls.ts:13-14` (la seule testée).
  Et le nom de schéma est une constante côté main (`protocol.ts:7`) que le renderer **ré-épelle**.
  Le schéma frère `IMPORT_SCHEME` **est**, lui, centralisé dans `core` — le modèle est là.
- **Extensions de modèle**, 2 copies : `runtime/src/assets/loadModel.ts:16` contre les `extensions`
  des importeurs agrégées dans `ASSET_KIND_INFO`.
- **Extensions d'image**, 3 copies partiellement divergentes, dont `PREVIEWABLE_EXTENSIONS`
  (`core/src/assets/schema.ts:308`) qui liste `gif` et `avif` — **non importables**, donc deux de ses
  six entrées sont inatteignables — et un troisième énoncé de « lesquels sont des JPEG »
  (`assets.ts:245`).
- **Le suffixe `.scene.json`**, 6 sites, dont `sceneName()` qui est le décapeur canonique.
  `scenes.ts:52-55` documente une boucle de point fixe rendue nécessaire parce que deux d'entre eux ne
  s'accordaient pas.
- **`ENGINE_VERSION`** (`core/src/constants.ts:2`) et **`RUNTIME_VERSION`**
  (`runtime/src/index.ts:15`) : deux copies de la même chaîne, qui doublent déjà les six `version` des
  `package.json`.

## Quoi
Une source par liste. Ne **pas** toucher aux divergences **délibérées et commentées** —
`PREVIEWABLE_EXTENSIONS` explique au `:290-307` pourquoi elle diffère ; corriger seulement ses deux
entrées inatteignables.

## Terminé quand
- [ ] Chaque liste a une source, et les autres l'importent
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor: one source for each list that was written down several times`
