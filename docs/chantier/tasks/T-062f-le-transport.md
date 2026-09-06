# T-062f — Le transport entre dans le registre
Lot 8 · **dépend de T-066**, pas de T-062e · statut: **FAIT** · tranche 6/6 de **T-062**

## Pourquoi elle est la dernière
`startPlay` appelle `showPanel('game')`, et `stopPlay` `showPanel('viewport')`. En faire des commandes
avant T-066 (« `playCommands.ts` cesse d'appeler `shell/dockApi` : une commande ne pilote pas la
disposition », jalon 8.5) enregistrerait dans le registre exactement ce que T-066 doit en sortir.

L'ordre du lot est donc : T-062a → e, puis T-063, T-064, T-065, T-066, **puis celle-ci**.

## Quoi
`startPlay`, `stopPlay`, `togglePlay` deviennent des commandes, avec le `can()` qui manque : la barre
d'outils et `GamePanel` décident aujourd'hui chacune de leur côté à partir de `playState`.

> ⚠️ **Deux commandes, pas trois — et c'est la deuxième fiche de ce lot écrite depuis les exports d'un
> fichier plutôt que depuis ses appelants** (voir T-062d). `togglePlay` n'avait **aucun appelant**, et
> une fois que `play` et `stop` portent chacune leur `can()`, il ne lui reste rien à faire : le bouton
> unique de la barre demande laquelle des deux s'applique — il le doit de toute façon, puisqu'il
> choisit aussi son icône — et une palette montre celle qui peut agir. Une **touche** de transport
> voudrait un bascule ; rien n'en lie une. Ce sera trois lignes le jour où quelque chose le fera.

## Terminé quand
- [x] Le transport passe par le registre : `play` et `stop`, avec des `can()` exclusifs. `togglePlay`
      est **supprimée**, pièce sans appelant
- [x] Aucune commande n'appelle `shell/dockApi` — c'était T-066, et rien n'y est revenu
- [x] La barre d'outils ne décide plus du mot : `transport.label()` et `transport.run()`. Elle garde
      son icône, qui n'est pas quelque chose que le registre porte
- [x] Cassé pour vérifier : un `can()` de `stop` qui exclut la pause → le test tombe
- [x] Vérifié dans l'application : bouton `Play` → `Stop`, panneau `game` puis `viewport`, et **la
      palette n'offre que `["Stop"]` en cours de jeu**, jamais les deux
- [x] `npm run typecheck && npm test` verts — 1001 tests. `renderer errors: none`

## Commit
`refactor(editor): play and stop are commands`
