# Le chantier

Une ré-architecture, découpée en tâches, sur la branche `refactor/architecture`.
Une seule MR à la fin ; un commit par tâche.

Le chantier ne vit pas dans une conversation. Il vit ici. C'est ce qui permet d'ouvrir une session
neuve, de dire **`go`**, et de reprendre exactement où on s'était arrêté.

## Les fichiers

| | |
|---|---|
| `STATE.md` | **Le seul fichier mutable.** Tâche courante, tâches faites, notes de reprise. |
| `PLAN.md` | Le diagnostic et l'architecture cible — le *pourquoi*. Les tâches en sont dérivées. |
| `tasks/T-0xx-*.md` | Une tâche = un commit. Chacune se lit seule. |

## La boucle, sur `go`

1. Lire `STATE.md` → la tâche courante.
2. Ouvrir `tasks/T-0xx-….md` et la lire en entier.
   Si elle renvoie à une section de `PLAN.md`, la lire aussi — les tâches des lots tardifs sont
   volontairement moins détaillées, parce que leur forme dépend de ce que les précédentes auront produit.
3. L'exécuter. **Celle-là, pas la suivante.**
4. `npm run typecheck && npm test`. Vert, sinon on ne commite pas.
5. Commit, avec le message que la tâche porte.
6. Mettre à jour `STATE.md` : tâche suivante, et les notes de reprise si on a appris quelque chose
   qu'un fichier de tâche ne pouvait pas anticiper.
7. S'arrêter. Rendre la main.

## Les règles du chantier

- **Une tâche, un commit, une chose.** Si une tâche se révèle en contenir deux, la scinder dans
  `tasks/` avant de coder, et le noter dans `STATE.md`.
- **Vert à chaque commit.** Aucun commit rouge « qu'on répare au suivant ».
- **Une tâche qui ne correspond plus au code est une question, pas une devinette.** Le code a pu bouger
  depuis l'audit. Dans ce cas : ne pas coder, écrire ce qu'on a trouvé dans `STATE.md`, et s'arrêter.
- **On ne fait pas plus que ce qui est demandé.** Pas de docs, de changelog, de formatage ou de
  couverture en plus. Le refactor est déjà assez grand.
- **Rien de spéculatif.** Pas de point d'extension sans un second implémenteur qui existe aujourd'hui,
  pas d'interface à une seule implémentation, pas de paramètre que tous les appelants passent pareil.
  Quand une tâche fait apparaître une pièce sans appelant, on la coupe et on le note.

## Statut

Le tableau de bord est dans `STATE.md`. Les statuts d'une tâche : `TODO`, `EN COURS`, `FAIT`, `BLOQUÉE`.
