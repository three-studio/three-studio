# T-069 — ADR : l'extensibilité tierce
Lot 11 · dépend de T-031 · statut: **FAIT**

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

## Ce que l'écriture a trouvé
**Le chargement de code tiers n'est pas à inventer : il tourne déjà, pour les scripts de jeu.**
`esbuild` est une dépendance *runtime* — l'app packagée compile le code de l'auteur elle-même — le
bundle s'enregistre par `registerScript` à l'import, il ne peut pas importer le vrai runtime (l'API lui
est *passée*), et **`SCRIPT_API_VERSION` est gravé dans le bundle et comparé à celui qui tourne**. Le
versionnement d'API, la partie difficile d'un système de plugins, existe donc déjà — sur la surface la
plus étroite possible.

Ce qui manque vraiment est plus court que prévu : **l'isolation** (`sandbox`/`contextIsolation`
protègent la frontière du preload, pas la page d'elle-même), une **surface stable côté éditeur**, et
**les trois listes** de T-031 — qui sont une corvée pour un type maison et un **blocage** pour un type
tiers : un plugin ne peut pas ajouter une ligne à `COMPONENT_TYPES` dans un `core` compilé.

## Terminé quand
- [x] L'ADR existe et nomme le seam précisément — `docs/adr/0018-…`, avec les trois dossiers, les neuf
      fichiers, et les **cinq fichiers partagés qui fuient** mesurés par T-031
- [x] **Aucune ligne de code de production ajoutée** — vérifié : `git status packages apps` est vide.
      Seuls `docs/` et `test/adr.test.ts` bougent
- [x] Le test des ADR a une **classe**, pas une exception : « les décisions qui décrivent un seam par
      lequel rien n'est encore passé ». `0001` et `0018` en sont, et être non cité est l'état que ces
      documents décrivent. Cassé pour vérifier : un ADR non cité hors de la classe fait tomber le test

## Commit
`docs(adr): what the vertical slice makes possible, and why we are not building it yet`
