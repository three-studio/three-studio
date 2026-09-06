# T-061 — Vérifier le gain du scan incrémental
Lot 7 · dépend de T-060 · petite tâche · statut: **FAIT**

## Pourquoi
T-019 a mis un index en place. Le gain n'a pas été mesuré sur un projet réaliste.

> ⚠️ **T-019 avait bien mesuré** — sa fiche porte « 120 ms contre 391 ms sans index » et `STATE.md` en
> donne le tableau. Ce que cette tâche apporte n'est donc pas une première mesure mais une
> **vérification indépendante**, sur le projet de référence de T-060 et par deux chemins : l'analyse
> seule, et le coût end-to-end d'un renommage vu du renderer. C'est le titre de la fiche, pas son
> « Pourquoi », qui décrit le travail.

## Quoi
Un projet de plusieurs milliers d'assets, et le coût d'un renommage avant/après. Si le gain n'est pas
là, l'index a un défaut — probablement une invalidation trop large.

## Terminé quand
- [x] Chiffre avant/après, sur le projet de référence de T-060 augmenté de 3000 assets —
      `docs/chantier/PERF-BASELINE.md` § *Le scan d'assets (T-061)*. Analyse seule : **391 – 514 ms
      sans index contre 130 ms à chaud**, soit 3,2×. End-to-end : **819 – 1002 ms contre 196 ms**,
      soit 4,3×. Un renommage coûte 210 ms au lieu de ~840 ms
- [x] Le gain ne manque pas, et l'invalidation n'est pas trop large : 1 clé → +4 ms, 100 clés →
      +27 ms, 3000 clés → +620 ms. Linéaire sur trois ordres de grandeur
- [x] Ce que la vérification a trouvé en plus est noté dans `STATE.md` : le pont IPC coûte ~60 ms par
      analyse pour un manifeste de 1,2 Mo, et le jalon 7.2 du `PLAN.md` n'est pas atteint — inscrit
      dans `RESTES.md`
- [x] `npm run typecheck && npm test` verts — 975 tests

## Commit
`docs: measure what the asset index actually saved`
