# T-028 — Les systèmes s'enregistrent, le `Reconciler` ne nomme plus personne
Lot 1 · dépend de T-027 · statut: **TODO**

## Pourquoi
`Reconciler.ts:77-83` tient une `Map<ComponentType, AnySystem>` de cinq entrées, construite en dur, et
importe les cinq classes en tête de fichier (`:3-9`). Ajouter un type qui dessine, c'est éditer ce
fichier — alors que le runtime a **déjà** le bon motif à côté : `registerBehaviour(type, factory)`
(`behaviour/Behaviour.ts:131-133`), avec les consommateurs qui s'enregistrent à l'import
(`controllers/PlayerController.ts:258`, `behaviour/audio.ts:238`, `scripting/ScriptHost.ts`).

`ComponentSystem.ts:92-97` explique l'asymétrie : un système est une **classe qui possède une ressource
avec une durée de vie**, contrairement à une factory de behaviour. C'est vrai, et ça n'empêche pas
l'enregistrement — ça dit seulement que ce qu'on enregistre est une fabrique de système, pas un singleton.

## Quoi
`registerSystem(type, () => new XSystem())`, appelé à l'import depuis
`runtime/src/components/<type>/`. Le `Reconciler` reçoit la table au lieu de la construire.

Le même piège que côté `core` : un module que personne n'importe n'enregistre rien, et le type
disparaît sans erreur. `core/src/components/index.ts:39-42` règle ça par un `throw` au chargement ;
faire pareil, et `runtime/test/componentCoverage.test.ts` couvre déjà les deux sens.

Garder l'effacement de type (`erase`, `:37-39`) et son commentaire (`:26-34`) : le cast est à
l'enregistrement et nulle part ailleurs, et ce qui le rend sûr est la clé de la table.

## Terminé quand
- [ ] `Reconciler.ts` ne nomme aucun type de composant ni aucune classe de système
- [ ] Oublier l'import d'un système lève au chargement, avec le type nommé
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(runtime): systems register themselves, as behaviours already do`
