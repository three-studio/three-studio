# T-063 — `rename` cesse d'être un demi-geste
Lot 8 · dépend de T-062 · petite tâche · statut: **TODO**

## Pourquoi
`renameCommand.run` délègue à `onRenameRequested`, un **emplacement mutable au niveau du module**
(`commands/registry.ts:225-229`), rempli par le panneau hiérarchie via `setRenameHandler`. Un registre
de commandes qui contient un registre de callbacks.

C'est l'exception qui montre ce que le lot 8 corrige : renommer demande une **édition en place dans une
vue**, donc la commande a besoin d'un moyen de demander à une vue de se mettre en édition.

## Quoi
Ce besoin est réel et il en existe d'autres (révéler un asset, dérouler un nœud). Le résoudre une fois,
proprement, plutôt que par un emplacement mutable — mais **sans** inventer un bus d'événements :
`docs/audio/DECISIONS.md` ADR-8 avait déjà écarté ça pour son chantier, et la raison vaut ici.

## Terminé quand
- [ ] Plus aucun emplacement mutable de module dans `commands/`
- [ ] Renommer depuis la hiérarchie et depuis le menu font la même chose
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): rename is a command, not a callback slot`
