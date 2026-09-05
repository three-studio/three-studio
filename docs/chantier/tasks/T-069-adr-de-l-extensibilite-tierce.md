# T-069 — ADR : l'extensibilité tierce
Lot 11 · dépend de T-031 · statut: **TODO**

## Pourquoi
Tout est compilé dans le binaire : les types de composants, les systèmes, les panneaux, les importeurs,
les commandes. Une entreprise qui adopterait l'outil ne peut ajouter **ni** un type de composant maison,
**ni** un importeur pour son format interne, **ni** un panneau. C'est la fonctionnalité manquante la
plus lourde pour l'objectif « utilisable en production par d'autres entreprises ».

## Quoi
**Ne pas écrire de système de plugins.** Il n'aurait aucun second implémenteur aujourd'hui, et ce serait
exactement le point d'extension spéculatif qui coûte cher à vie.

Écrire l'ADR qui acte ce que le chantier a rendu possible : une fois qu'un type de composant est trois
dossiers qui s'enregistrent (lot 1), et que composants et scripts partagent un vocabulaire de champ
(T-038), **un plugin est ces mêmes fichiers chargés autrement**. L'ADR nomme le seam, ce qu'il faudrait
en plus (chargement, isolation, versionnement de l'API), et ce qui le déclencherait.

## Terminé quand
- [ ] L'ADR existe et nomme le seam précisément
- [ ] Aucune ligne de code de production ajoutée

## Commit
`docs(adr): what the vertical slice makes possible, and why we are not building it yet`
