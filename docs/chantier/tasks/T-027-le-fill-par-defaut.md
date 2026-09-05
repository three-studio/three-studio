# T-027 — Le `fill` par défaut
Lot 1 · dépend de T-026 · petite tâche · statut: **TODO**

## Pourquoi
Neuf des douze `fill` sont littéralement `(stored) => ({ ...createX(), ...stored })` :
`camera:8`, `collider:8`, `rigidbody:8`, `playerController:8`, `audioSource:20`, `model:13`,
`script:8`, `prefabInstance:14`, `audioListener:15`. Trois seulement ont besoin du leur — `mesh`
(matériau et géométrie fusionnés un niveau plus bas), `light` (le kind décide des défauts), `water`.

Le commentaire de `registry.ts:43-50` justifie le `fill` par type en montrant `mesh`. L'argument est
juste pour trois types, et neuf copies le paient.

## Quoi
`fill` devient optionnel dans `ComponentDefinition`, avec pour défaut `{ ...create(), ...stored }`.
Les trois qui en ont besoin gardent le leur, **et leur commentaire**, qui dit précisément quelle donnée
d'auteur un spread plat détruirait.

## Attention
C'est une règle de format persisté (`docs/ARCHITECTURE.md:337-339` : « remplir depuis la fabrique du
type, jamais depuis une liste »). Le défaut doit passer par `create()` du type, pas par une table.

## Terminé quand
- [ ] Neuf définitions n'ont plus de `fill`
- [ ] `core/test/sceneMigration.test.ts` vert sans modification — c'est lui qui prouve que rien n'a bougé
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(core): nine identical fills become one default`
