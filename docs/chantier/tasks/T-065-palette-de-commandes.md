# T-065 — La palette de commandes
Lot 8 · dépend de T-064 · statut: **TODO**

## Pourquoi
Après T-062 à T-064, elle **tombe du registre**. Ce n'est plus une fonctionnalité à écrire, c'est une
vue sur une donnée qui existe : chaque commande a un id, un libellé fonction du contexte, et un `can()`.

## Quoi
Une palette qui liste les commandes dont `can()` est vrai dans le contexte courant, filtrées par frappe,
avec le raccourci affiché à droite.

Elle passe par `useOverlay` (`state/overlayStore.ts`) comme toute surface qui couvre l'éditeur — et
elle utilise les `--z-index-*` déclarés dans le bloc `@theme` de `styles.css`, jamais un nombre choisi
sur place.

## Terminé quand
- [ ] La palette s'ouvre, filtre, exécute, et respecte `can()`
- [ ] Elle s'empile correctement : `Escape` va au sommet de la pile et nulle part ailleurs
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(editor): a command palette, which the registry now simply affords`
