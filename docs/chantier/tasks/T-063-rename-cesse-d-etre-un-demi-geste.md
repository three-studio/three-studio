# T-063 — `rename` cesse d'être un demi-geste
Lot 8 · dépend de T-062 · petite tâche · statut: **FAIT**

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

> ⚠️ **`docs/audio/DECISIONS.md` n'existe pas** — ni ce fichier ni un ADR-8 nulle part dans `docs/`.
> C'est ce que T-067 (« reconstruire les ADR ») doit réparer. L'instruction se suffit sans lui.

**La solution était déjà dans le dépôt, pour le geste que la fiche cite en exemple.**
`assetStore.reveal(assetId)` pose `revealed`, le panneau le lit, le dessine et l'efface. Un champ
qu'une commande écrit et qu'une vue lit — pas de file, pas d'abonnement à un canal, et une vue non
montée ne lit simplement rien. `editorStore.renaming` est le même, pour la même raison.

## Deux défauts de plus, cachés derrière le premier
- **`run` lisait `editorStore.selection` et ignorait le contexte qu'on lui passait.** Un clic droit
  hors sélection aurait mis en édition la mauvaise ligne. Invisible parce que `run` ne faisait rien du
  tout : l'emplacement n'était rempli par personne.
- **Le double-clic passait à côté de `can('rename')`**, et l'entrée « Rename » du menu d'une entité
  produite par un prefab n'avait **aucun** verdict. Trois chemins vers un geste, un seul qui demandait.

## Terminé quand
- [x] Plus aucun emplacement mutable de module dans `commands/` — vérifié : aucun `let` ni `var` au
      niveau module dans tout le dossier
- [x] Les trois chemins — menu contextuel, menu d'entité produite, double-clic — sont la même commande
- [x] Cassé pour vérifier : un `run` qui relit `editorStore.selection` → les deux tests tombent
- [x] Vérifié dans l'application : double-clic → champ ouvert et `renaming` posé, saisie écrite
      (`Renamed By Probe`), `renaming` effacé au blur **et** à Escape. `renderer errors: none`
- [x] `npm run typecheck && npm test` verts — 987 tests

## Commit
`refactor(editor): rename is a command, not a callback slot`
