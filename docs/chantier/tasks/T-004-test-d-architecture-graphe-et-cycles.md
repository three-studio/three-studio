# T-004 — Le test d'architecture voit le graphe, et les cycles
Lot 0 · dépend de T-003 · statut: **TODO**

## Pourquoi
`packages/runtime/test/package-boundary.test.ts` tient deux assertions réelles et utiles, mais par un
**scan de texte** (`:27`, une regex sur les spécificateurs d'import), sur `packages/runtime/src` et
`packages/core/src` **seulement**. Donc :

- rien n'assure que `packages/editor` n'importe pas depuis `apps/`
- rien n'assure que `core` n'importe pas `runtime`
- les dossiers de test et `apps/` ne sont pas regardés
- **aucun cycle n'est détecté**, et il y en a deux aujourd'hui :

```
import/importStore → import/plan → import/settingsPane
  → inspector/PaneBinder → inspector/assetField → import/importStore

viewport/viewportHost → viewport/EditorViewport → commands/sceneFiles
  → state/projectStore → viewport/viewportHost
```

Le second se referme sur une violation de couche : `state/projectStore.ts:10` importe
`../viewport/viewportHost` et appelle `peekViewport()?.binder.setAssetResolver(...)` (`:75`).

## Quoi
Remplacer le scan par une vraie construction du graphe d'imports (résolution des chemins relatifs et
des alias du workspace, réutiliser la source de T-003), et en tirer :

1. les règles de dépendance, étendues : `core` → rien ; `runtime` → pas d'éditeur, pas d'apps ;
   `editor` → pas d'apps ; `core` → pas de runtime
2. **la détection de cycles**, avec les deux cycles connus déclarés comme dette acceptée nommée, pour
   que le test soit vert aujourd'hui et rouge si un troisième apparaît

Les deux cycles existants sont fermés plus tard (T-04x, lot 3 et lot 4). Ici on les **constate**.

## Fichiers
- `packages/runtime/test/package-boundary.test.ts` → déplacer vers un test d'architecture à la racine
  (il ne parle plus seulement du runtime)

## Attention
Le commentaire de `:19-26` explique pourquoi le délimiteur en tête de la regex est porteur : sans lui la
chaîne `'studio-import'` matchait et faisait échouer le test sur une constante. Un vrai parseur n'a pas
ce problème, mais le piège vaut d'être connu.

## Terminé quand
- [ ] Les quatre règles de dépendance sont vérifiées, sur `packages/**` et `apps/**`, tests inclus
- [ ] Les cycles sont détectés ; les deux connus sont listés nommément comme dette
- [ ] Ajouter un `import` de `@three-studio/editor` dans `packages/runtime/src` fait échouer le test
- [ ] Fabriquer un troisième cycle fait échouer le test
- [ ] `npm run typecheck && npm test` verts

## Commit
`test(arch): assert the real import graph, cycles included`
