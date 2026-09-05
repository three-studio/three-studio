# T-046 — `ProjectPanel` découpé, et son abonnement au store entier
Lot 4 · dépend de T-045 · statut: **TODO**

## Pourquoi
741 lignes : navigateur, fil d'Ariane, tuiles de dossier, tuiles d'asset, vue liste, canvas de waveform,
scrubber audio, drag/drop, entrée d'import.

Et surtout `ProjectPanel.tsx:77` : `const store = useAssetStore();` — **un abonnement au store
entier**. Chaque changement de champ, `revision` et `loading` compris, re-rend le panneau et sa grille.
C'est le dernier du repo ; partout ailleurs les sélecteurs sont fins, et les commentaires racontent les
tempêtes de re-rendu déjà payées (`InspectorPanel.tsx:33-55`, `HierarchyPanel.tsx:121-128`).

## Quoi
Découper par élément, et remplacer l'abonnement global par des sélecteurs.

Au passage : `KIND_FILTERS` (`:59-67`) a **déjà divergé** — `'prefab'` y manque, et le type du tableau
ne peut pas l'attraper, contrairement à `KIND_ICON` (`:47-55`) qui est un `Record<AssetKind, …>` total.
Même remède que T-005.

## Terminé quand
- [ ] Aucun abonnement au store entier
- [ ] `KIND_FILTERS` est total ; `'prefab'` réapparaît
- [ ] Mesuré : taper dans le filtre ne re-rend plus la grille entière
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the project panel stops subscribing to everything`
