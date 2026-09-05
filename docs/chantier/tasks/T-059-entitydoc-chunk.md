# T-059 — `EntityDoc.chunk` : l'implémenter ou le retirer
Lot 7 · dépend de T-058 · petite tâche · statut: **TODO**

## Pourquoi
`core/src/scene/schema.ts:569` déclare `chunk?: string`. **Rien ne le lit, nulle part.** C'est un champ
de streaming déclaré et jamais implémenté.

Un réglage qui ne fait rien est pire qu'un réglage absent : c'est une promesse. Le repo le dit lui-même
dans `project/schema.ts:68-75` — « chaque champ ici est lu par quelque chose ; `forceWebGL` est resté
là sans lecteur depuis le jour où il a été ajouté ».

## Quoi
Décider. Soit le streaming par chunk est le prochain sujet et il a un ADR, soit le champ part.
Le retirer est un changement de format — carte blanche, aucune migration due.

## Terminé quand
- [ ] Le champ est lu par quelque chose, ou il n'existe plus
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(core): remove the chunk field nothing reads` (ou l'ADR qui l'implémente)
