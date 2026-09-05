# T-009 — Le binder prend ses réglages à la construction
Lot 2 · dépend de T-008 · **c'est la tâche qui corrige le symptôme** · statut: **TODO**

## Pourquoi
`shadowMapSize` n'est écrit **qu'à un seul endroit dans tout le repo** : `EditorViewport.ts:187-189`,
depuis `project.settings.rendering.shadowMapSize`. `EngineOptions` (`Engine.ts:39-90`) **n'a pas ce
champ**, le constructeur ne l'écrit jamais, et `SceneBinder.ts:109` vaut `2048` par défaut.
`LightSystem` le lit via `ctx.shadowMapSize` (`:48`, `:115`, `:185`).

> Un projet réglé sur 4096 obtient **4096 dans la vue Scene, 2048 en Play, et 2048 dans le build.**

Et le build est un **troisième mode divergent** : `apps/web-template/src/main.ts:148` appelle
`createRenderer({ canvas, forceWebGL: build.forceWebGL })` — `antialias`, `maxPixelRatio`, `shadows` et
`exposure` sont **jetés**. Ça ne se voit pas encore parce que les défauts de `createRenderer`
coïncident avec ceux de `createRenderingSettings()`. Accord accidentel.

## Quoi
Ce qui fait mal n'est pas qu'il y ait deux binders — leurs durées de vie sont authentiquement
différentes — c'est que **les réglages vivent sur des champs publics mutables, écrits par deux sites
d'appel, dans deux ordres**. On corrige les réglages.

1. **`SceneBinderOptions`**, avec `resolver`, `rendering: RenderingSettings`, `materials?`,
   `renderer?`, `time?`. `shadowMapSize` (`:109`) et la paire d'accesseurs `batching` (`:131-137`)
   deviennent `readonly`, lus une fois dans le constructeur.
   `SceneBinder.renderer` (`:386`) **reste** assignable : l'éditeur doit le poser après
   `await createRenderer`. Une exception honnête, avec le commentaire qui l'explique déjà.

2. **`bindScene(scene, doc, options)`**, constructeur nommé dans `SceneBinder.ts`, qui porte l'ordre
   dans sa docstring — c'est le cœur de la tâche :
   - **materials** avant le premier sync : un mesh est construit synchronement, donc sans la table en
     main tout matériau lié retombe silencieusement sur sa copie embarquée
   - **renderer** avant l'environnement : capturer un ciel analytique dans une cubemap, c'est six draw
     calls, donc le device doit être là avant l'environnement et pas seulement avant la première frame
   - **sync** des entités : c'est ce sur quoi `sunOf` sera interrogé
   - **environnement** en dernier : il lit les matrices monde que le sync vient d'écrire

   **Deux sites d'appel et deux seulement** : `Engine`, et le `createEditorProjection` de T-010.

3. **`EngineOptions.rendering` requis, pas optionnel.** C'est le mécanisme d'enforcement, et il est
   gratuit : `npm run typecheck` échoue tant que `beginPlay` et `web-template/src/main.ts` n'en
   fournissent pas un. `SceneHostOptions extends Omit<EngineOptions,'scene'>` (`SceneHost.ts:35`) en
   hérite tout seul. **Supprimer `EngineOptions.batching`** (`:84`) — il vit maintenant dans `rendering`.

4. **`build.json` porte `rendering`**, et le player le lit. Le troisième mode cesse de diverger.

## Fichiers
- `packages/runtime/src/SceneBinder.ts:109,131-137` (mutables → readonly), `:153-183` (constructeur),
  nouveau `bindScene`
- `packages/runtime/src/Engine.ts:84` (`batching` supprimé), `:39-90` (`rendering` requis),
  `:130-146` (le constructeur devient un appel à `bindScene`)
- `packages/editor/src/viewport/EditorViewport.ts:84,179-194` ; `beginPlay:300-328` passe `rendering`
- `apps/web-template/src/main.ts:148,157-176`
- `apps/desktop/src/main/exportWeb.ts` — écrit `rendering` dans `build.json`
- `apps/web-template/src/main.ts:39-65` — `BuildManifest` gagne le champ, optionnel avec repli sur
  `createRenderingSettings()` pour un build antérieur
- `packages/runtime/test/sceneBinder.test.ts:44-48` — le helper fournit `rendering`
- `apps/desktop/test/exportWeb.test.ts` — assertion sur le nouveau champ

## Attention
Atomique. `EngineOptions.rendering` étant requis, tous les appelants bougent dans le même commit.

## Terminé quand
- [ ] Retirer `rendering` d'un des trois appelants est une **erreur de compilation**
- [ ] Un projet réglé sur 4096 donne 4096 dans les trois modes — vérifié au smoke harness, capture en
      édition puis en Play, et build exporté ouvert
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(runtime): the binder takes its rendering settings at construction`
