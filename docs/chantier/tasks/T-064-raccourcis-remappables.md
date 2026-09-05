# T-064 — Les raccourcis se lisent depuis le registre
Lot 8 · dépend de T-063 · statut: **TODO**

## Pourquoi
Un raccourci est aujourd'hui une chaîne sur la commande (`Command.shortcut`) plus du traitement de
touches dans `useShortcuts`. Rien ne les remappe.

## Quoi
La table de liaison touche → commande devient une donnée, avec les défauts du produit et la possibilité
d'y superposer un choix de l'utilisateur (dans les préférences, à côté de `layouts.json`).

## Attention
`useShortcuts` refuse d'agir tant que la pile d'overlays n'est pas vide (`state/overlayStore.ts`), et
`shortcutsApply` pose **les deux** questions — pas seulement le focus. La raison est écrite dans
`docs/ARCHITECTURE.md` : Tweakpane rend le focus au body une fois un champ validé, donc `Cmd+Z` juste
après avoir tapé dans une boîte annulait une édition dans la scène derrière.
`packages/editor/test/shortcuts.test.ts` épingle les deux. **Ne pas régresser là-dessus.**

Il y a aussi une fuite à ne pas reproduire : `useShortcuts.ts:120` lit
`peekViewport()?.controls.isNavigating` — un hook qui plonge deux niveaux dans les `FlyControls`.

## Terminé quand
- [ ] Un raccourci se remappe et survit à un redémarrage
- [ ] `shortcuts.test.ts` vert, les deux questions posées
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(editor): shortcuts are data, and they can be remapped`
