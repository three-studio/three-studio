# T-014 — L'aperçu d'import ne fige plus le viewport
Lot 2 · dépend de T-013 · statut: **TODO**

## Pourquoi
`import/preview/ModelPreview.ts:61` crée un **second renderer** (`createRenderer({ canvas,
shadows: false, maxPixelRatio: 2 })`). `rendererCount() > 1` fait alors cesser de dessiner le viewport
principal (`EditorViewport.ts:557`). C'est le remède correct à un vrai bug de `WebGPURenderer`, mais ça
se lit à l'écran comme « le viewport s'est figé ».

Accessoirement l'aperçu tourne avec `shadows: false` et ses propres réglages : c'est une quatrième
projection divergente, à l'échelle d'une vignette.

## Quoi
Une fois T-013 fait, le mécanisme existe : un renderer, plusieurs présentations. L'aperçu devient une
présentation de plus au lieu d'un second device.

## Terminé quand
- [ ] Ouvrir la boîte d'import laisse le viewport dessiner
- [ ] `rendererCount()` reste à 1 pendant un aperçu
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(editor): previewing an import no longer stops the viewport from drawing`
