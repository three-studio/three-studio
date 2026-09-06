# T-064 — Les raccourcis se lisent depuis le registre
Lot 8 · dépend de T-063 · statut: **FAIT**

## Pourquoi
Un raccourci est aujourd'hui une chaîne sur la commande (`Command.shortcut`) plus du traitement de
touches dans `useShortcuts`. Rien ne les remappe.

> **Trois orthographes d'un même fait, pas deux.** Le `switch` de `useShortcuts` décidait ; les hints
> des menus étaient tapés à la main (`${modKey}Z` une fois dans `MenuBar`, une fois dans
> `HierarchyPanel`, une fois dans `addMenu`) ; et `Command.shortcut` **n'était lu nulle part**. Un
> remappage aurait dû trouver les trois — c'est pour ça que rien ne remappait.

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
- [x] Un raccourci se remappe et survit à un redémarrage — vérifié en **deux passages** du harnais :
      le premier écrit `Mod+K → save` et libère `Mod+S`, le second relance l'application et les lit
      depuis le disque avant toute action. Le menu Fichier affiche alors **`Save Scene⌘K`**, ce qui
      était impossible tant que la chaîne était tapée à la main
- [x] `shortcuts.test.ts` vert : `shortcutsApply` **n'a pas bougé** — les deux questions, la pile
      d'overlays et le focus, sont posées comme avant. `commandShortcut` est remplacé par la
      résolution depuis la table, et quatre cas de remappage sont ajoutés
- [x] `Command.shortcut` supprimé : un champ que personne ne lisait pendant que trois autres
      orthographes décidaient
- [x] La fuite signalée dans « Attention » — `peekViewport()?.controls.isNavigating` — **n'a pas été
      reproduite** : elle concerne les touches d'outil, qui ne sont pas des commandes et ne sont pas
      dans la table. Elle est toujours là, intacte, à `useShortcuts.ts`
- [x] `npm run typecheck && npm test` verts — 992 tests

## Commit
`feat(editor): shortcuts are data, and they can be remapped`
