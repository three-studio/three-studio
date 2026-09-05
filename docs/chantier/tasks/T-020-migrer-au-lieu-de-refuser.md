# T-020 — Migrer un projet au lieu de le refuser
Lot 9 · dépend de T-019 · statut: **TODO**

## Pourquoi
`readProjectFile` (`apps/desktop/src/main/project.ts:170-183`) **lève** quand
`version < PROJECT_FORMAT_VERSION` : « Create it again ». Le commentaire l'assume — rien n'existe dans
la nature, l'éditeur n'a jamais été distribué. Ça cesse d'être vrai le jour où quelqu'un s'en sert, et
c'est exactement ce que vise l'objectif « utilisable en production ».

Les scènes, elles, migrent déjà (`core/src/scene/serialization.ts:42`). C'est le projet qui manque.

## Quoi
Migrer vers l'avant, en suivant les règles que le repo tient déjà (`docs/ARCHITECTURE.md:325-347`) :
ajouter des champs jamais en retirer, remplir depuis la fabrique du type jamais depuis une seconde
liste, laisser intact ce qu'on ne reconnaît pas, défendre à la frontière et pas à chaque lecture.

Refuser reste juste dans **un** cas : une version **plus récente** que celle qu'on sait lire.

Comme `ProjectFile.scenes` vient de disparaître (T-017), c'est le bon moment : la migration de la
version qui l'avait est « ignorer le registre, découvrir le disque ».

## Terminé quand
- [ ] Un `project.json` écrit à la main dans un ancien format s'ouvre — test écrit dans l'ancienne
      forme à la main, jamais en asserant la forme courante (`upgradeContracts.test.ts` est le modèle)
- [ ] Une version future est toujours refusée, avec un message qui dit quoi faire
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(desktop): projects migrate forward instead of being refused`
