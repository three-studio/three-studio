# T-031 — L'épreuve : un type de composant neuf, de bout en bout
Lot 1 · dépend de T-030 · statut: **TODO**

## Pourquoi
Tout le lot 1 a une seule promesse : **ajouter un type de composant ne doit plus coûter 14 fichiers
dispersés dont un seul attrapé par `tsc`**. Une promesse qu'on ne mesure pas est une promesse.

## Quoi
Ajouter un type réellement utile et volontairement simple — `particleEmitter` est le candidat naturel,
mais n'importe lequel fait l'affaire s'il dessine quelque chose et porte au moins un champ conditionnel
(c'est ce qui exerce la dérivation de T-007).

Le faire **en suivant seulement la structure**, sans chercher dans le code où « il faudrait aussi
toucher ». Tout ce qui manque doit apparaître au typecheck ou en test rouge.

**Compter les fichiers, et l'écrire dans le commit.** Si le compte dépasse la ligne dans l'union plus
les trois dossiers, la tranche n'est pas finie : noter ce qui a fui dans `STATE.md` et corriger avant de
déclarer le lot 1 terminé.

## Terminé quand
- [ ] Le type existe, s'ajoute depuis le menu, s'édite dans l'Inspector, se dessine, s'exporte
- [ ] Aucun fichier partagé n'a été touché en dehors de la ligne d'union
- [ ] Le message de commit donne le compte réel, contre les 14 d'avant
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat: add a component type end to end, as the measure of what that now costs`
