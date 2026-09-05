# T-018 — `scenes.ts` fond
Lot 9 · dépend de T-017 · statut: **TODO**

## Pourquoi
`apps/desktop/src/main/scenes.ts` (263 l.) existe pour tenir quatre invariants d'un registre qui n'existe
plus après T-017. Ce qui reste d'utile : créer un fichier de scène, le dupliquer, le renommer, le
supprimer, poser `startScene`.

## Quoi
Retirer tout ce que le registre imposait. Une opération devient ce qu'elle est vraiment : une opération
de fichier, plus une écriture de `startScene` quand c'est celle-là qui bouge.

Attention au commentaire de `:52-55` — il documente une boucle de point fixe rendue nécessaire parce que
deux façons de déduire un nom de fichier ne s'accordaient pas. Vérifier si elle a encore un objet.

`sceneName()` reste la seule façon de dériver un nom d'un chemin.

## Terminé quand
- [ ] Créer / dupliquer / renommer / supprimer une scène marche, depuis l'UI
- [ ] Supprimer la dernière scène : décider et tester (le registre l'interdisait ; le disque, non)
- [ ] `apps/desktop/test/sceneRegistry.test.ts` réécrit sur ce qui reste
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(desktop): scene operations are file operations again`
