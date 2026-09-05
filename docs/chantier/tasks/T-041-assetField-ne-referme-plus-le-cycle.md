# T-041 — `assetField` ne referme plus le cycle
Lot 3 · dépend de T-040 · statut: **TODO**

## Pourquoi
Premier des deux cycles d'import détectés par T-004 :

```
importStore → plan → settingsPane → PaneBinder → assetField → importStore
```

`inspector/assetField.ts` (517 l. de plugin Tweakpane écrit à la main, DOM brut, SVG lucide inlinés à
`:70-74`) atteint `shell/dockApi` et `import/importStore` (`:13-14`). Une table de champs déclarative
ne pilote ni la disposition ni la boîte d'import.

Second site du même travers : `inspector/schema.ts:24` importe `viewport/viewportHost` et appelle
`peekViewport()?.binder.containerFor(entityId)` (`:801`) — le schéma déclaratif atteint le renderer.

## Quoi
Ce dont `assetField` a besoin lui est **passé**, il ne va pas le chercher. Le cycle se casse là.

## Terminé quand
- [ ] T-004 ne signale plus ce cycle, et il sort de la liste de dette acceptée
- [ ] `inspector/` n'importe plus `shell/` ni `viewport/`
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the field table stops reaching for the dock and the renderer`
