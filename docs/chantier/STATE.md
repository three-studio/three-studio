# État du chantier

**Branche** : `refactor/architecture`
**Dernier commit** : T-001 — le dispositif de reprise
**Tâche courante** : **T-002** — `typecheck` couvre les tests des apps
**Faites** : T-001

## Notes de reprise

Rien de particulier : le chantier commence. Le plan complet est dans `PLAN.md`, la boucle dans
`README.md`.

Une chose à savoir avant de toucher au code : **il est bon**. 737 tests, zéro `TODO`, 50 échappatoires
de typage sur 62 k lignes, et des commentaires qui expliquent le *pourquoi* à un niveau de détail rare.
Le chantier n'est pas une réécriture — c'est une série de déplacements précis. Quand un commentaire
explique pourquoi le code est comme il est, **il déménage avec le code**.

## L'ordre

Les tâches se prennent dans l'ordre des numéros, sauf indication contraire dans la tâche. L'ordre a été
choisi par bénéfice visible :

1. **T-001** le dispositif · **T-002 → T-006** le filet
2. **T-007** la dérivation de l'Inspector — autonome, corrige à elle seule la moitié
   « répond mal à l'Inspector »
3. **T-008 → T-015** la parité éditeur/jeu. **T-009 corrige `shadowMapSize`**, très probablement le
   symptôme visible à l'écran
4. **T-016 → T-022** le format de projet — tôt, parce que tout ce qui touche aux scènes en dépend
5. **T-023 → T-031** la tranche verticale — le plus gros, et ce dont tout le reste tire sa scalabilité
6. **T-032 → T-070** l'export, l'Inspector, les god objects, les contrats, la couverture, la perf,
   les commandes, la mémoire du projet

## Tableau

| Lot | Tâches | Sujet | Statut |
|---|---|---|---|
| 0 | T-001 → T-006 | Le dispositif et le filet | 1/6 |
| 3a | T-007 | L'Inspector se dérive de son schéma | 0/1 |
| 2 | T-008 → T-015 | Parité éditeur / jeu / build | 0/8 |
| 9 | T-016 → T-022 | Le format de projet | 0/7 |
| 1 | T-023 → T-031 | La tranche verticale par composant | 0/9 |
| 10 | T-032 → T-037 | L'export | 0/6 |
| 3b | T-038 → T-041 | L'Inspector, le reste | 0/4 |
| 4 | T-042 → T-046 | Les god objects | 0/5 |
| 5 | T-047 → T-051 | Les contrats de frontière | 0/5 |
| 6 | T-052 → T-055 | Les couches sans tests | 0/4 |
| 7 | T-056 → T-061 | Le moteur et la performance | 0/6 |
| 8 | T-062 → T-066 | La couche de commandes | 0/5 |
| 11 | T-067 → T-070 | La mémoire du projet | 0/4 |

**70 tâches.** Une par commit, une MR à la fin.
