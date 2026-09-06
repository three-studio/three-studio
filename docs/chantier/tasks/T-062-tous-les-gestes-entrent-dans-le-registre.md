# T-062 — Tous les gestes entrent dans le registre
Lot 8 · dépend de T-046 · **grosse tâche, scindée** · statut: **FAIT** — les six tranches sont faites

## Pourquoi
`commands/registry.ts:55-62` déclare un `CommandId` fermé de **sept** entrées :
`undo | redo | save | duplicate | delete | group | rename`.

À côté, `commands/` exporte **~50 fonctions libres** qui sont exactement des gestes — `addEntity`,
`deleteSelection`, `reparentSelection`, `transformSelection`, `createPrefabFromEntity`, `unpackModel`,
`runExport`, `startPlay`, `addComponentWithDependencies`… — sans `can()`, sans libellé, sans
identifiant, appelées directement par React et par les boutons Tweakpane.

Ce n'est pas une faute de style : c'est ce qui **rend trois fonctionnalités impossibles** — une palette
de commandes, des raccourcis remappables, et le pilotage de l'éditeur par script. Les trois sont
attendues d'un outil professionnel.

Le `Command` existant est bien fait : `label(ctx)` est une fonction parce que « Undo Move » nomme le
geste qu'il annulerait ; `can()` est le `poll()` de Blender et le `CanEditChange` d'Unreal ; `run`
revérifie `can()` (`:108-112`) donc un appelant distrait est refusé quand même. **La forme est bonne,
c'est la couverture qui manque.**

## Quoi
Chaque geste devient une `Command` déclarée. Par lots thématiques, un commit chacun : scène, prefabs,
assets, modèles, export, transport.

`CommandId` cesse d'être une union fermée écrite à la main — sinon c'est une cinquantième liste à tenir.

## Les six tranches
Cette fiche prescrit « un commit par famille », donc six. La règle du chantier veut qu'une tâche qui
en contient plusieurs soit scindée dans `tasks/` **avant** de coder ; c'est fait, et cette fiche reste
comme chapeau. Chaque tranche se lit seule.

| | Tranche | Dépend de |
|---|---|---|
| 1 | `T-062a` — `CommandId` se dérive de la table, et le menu Scène comme patron | T-046 |
| 2 | `T-062b` — les assets, et la cible dans `EditorContext` | T-062a |
| 3 | `T-062c` — les prefabs | T-062b |
| 4 | `T-062d` — les gestes de scène | T-062c |
| 5 | `T-062e` — les scènes ciblées, les modèles, l'export | T-062d |
| 6 | `T-062f` — le transport | **T-066**, pas T-062e |

**La cible mesurée**, une fois les lecteurs et les mutations paramétrées écartés : **30 gestes**
appelés depuis un `.tsx`, dans 12 fichiers. Pas 50 — `commands/` exporte aussi des questions
(`sceneList`, `instanceInfo`, `overridesOf`, `componentFits`, `placedAt`), les maths de
`transformSpace.ts`, et des mutations que seuls le gizmo et Tweakpane appellent, avec des arguments.
La frontière est « ce qu'un auteur peut demander sans argument », pas « ce qui est dans `commands/` ».

**Le transport est en dernier et pas par confort** : `startPlay` appelle `showPanel`, et T-066 doit
l'en sortir. L'enregistrer avant reviendrait à mettre dans le registre ce que la tâche suivante doit
en retirer.

## Terminé quand
- [x] Aucun geste appelé depuis React sans passer par le registre, **avec un bord nommé** : un geste
      dont un appelant lit le résultat est un appel de fonction, pas une commande (T-062b), et une
      mutation paramétrée par une *valeur* non plus (T-062d). Les deux sont écrits dans le code
- [x] Chaque commande a un libellé et un `can()` réel — **30 commandes**
- [x] `npm run typecheck && npm test` verts à chaque commit

## Ce que le lot a réellement corrigé
Le registre n'a pas seulement rangé : à chaque tranche il a trouvé des divergences que personne ne
cherchait.

| | |
|---|---|
| T-062a | `Duplicate Scene…` et `Rename Scene…` sans aucun `disabled`, `Save Scene As…` idem, `Delete Scene` avec sa règle dans le menu |
| T-062c | Apply/Revert Overrides actifs dans l'Inspector et grisés dans la hiérarchie ; **deux `reveal` faisant chacun la moitié du travail** |
| T-063 | `rename` ne faisait **rien** — son emplacement n'était rempli par personne — et sous ce silence, `run` ignorait le contexte |
| T-064 | **Trois** orthographes d'un raccourci, dont une morte |
| T-066 | Deux sites où `commands/` atteignait `shell/`, pas un |

## Commit
`refactor(editor): every gesture is a command` — un par famille
