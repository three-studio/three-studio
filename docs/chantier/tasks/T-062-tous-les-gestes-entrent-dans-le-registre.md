# T-062 — Tous les gestes entrent dans le registre
Lot 8 · dépend de T-046 · **grosse tâche** · statut: **TODO**

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

## Terminé quand
- [ ] Aucun geste appelé depuis React sans passer par le registre
- [ ] Chaque commande a un libellé et un `can()` réel
- [ ] `npm run typecheck && npm test` verts à chaque commit

## Commit
`refactor(editor): every gesture is a command` — un par famille
