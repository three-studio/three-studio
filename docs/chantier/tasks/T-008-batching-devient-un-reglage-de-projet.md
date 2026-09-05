# T-008 — `batching` devient un réglage de rendu du projet
Lot 2 · dépend de T-005 · statut: **TODO**

## Pourquoi
Aujourd'hui l'éditeur écrit `binder.batching = true` (`EditorViewport.ts:193`) et `Engine` a `true` par
défaut (`:137`), et `beginPlay` n'en passe aucun. **Ils s'accordent parce que deux défauts écrits
séparément s'accordent.** Le commentaire de `Engine.ts:135-136` — « allumé pour un jeu, éteint dans
l'éditeur » — est périmé et décrit une divergence qui serait réelle si on le croyait.

Ce n'est pas académique : `MeshBatcher` abandonne `perObjectFrustumCulled` dès qu'une lumière projette
une ombre (`:403`), coupe `sortObjects` (`:419`) et `frustumCulled` (`:433`). Un désaccord de batching
se voit à l'écran.

## Quoi
Ajouter `batching: boolean` à `RenderingSettings`, avec `true` dans `createRenderingSettings()`.
Aucun consommateur encore — la tâche est verte seule, et c'est volontairement son propre commit pour
que le changement de format soit reviewable à part.

**Pas de bump de version, pas de migration** : `apps/desktop/src/main/project.ts:188` fait déjà
`settings.rendering = { ...createRenderingSettings(), ...settings.rendering }`. C'est la règle écrite
dans `docs/ARCHITECTURE.md:340-347` — remplir depuis la fabrique du type, jamais depuis une seconde
liste.

Commenter le champ en disant *pourquoi* c'est un réglage de projet et non un drapeau par vue : les deux
modes lisent le même champ, donc ils ne peuvent pas tenir deux réponses.

## Fichiers
- `packages/core/src/project/schema.ts:107-122` (le champ), `:140-148` (`createRenderingSettings`)

## Terminé quand
- [ ] `npm run typecheck && npm test` verts
- [ ] Un `project.json` écrit avant ce champ s'ouvre et obtient `batching: true`

## Commit
`feat(core): batching is a project rendering setting`
