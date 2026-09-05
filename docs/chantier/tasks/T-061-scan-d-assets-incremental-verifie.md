# T-061 — Vérifier le gain du scan incrémental
Lot 7 · dépend de T-060 · petite tâche · statut: **TODO**

## Pourquoi
T-019 a mis un index en place. Le gain n'a pas été mesuré sur un projet réaliste.

## Quoi
Un projet de plusieurs milliers d'assets, et le coût d'un renommage avant/après. Si le gain n'est pas
là, l'index a un défaut — probablement une invalidation trop large.

## Terminé quand
- [ ] Chiffre avant/après, sur le projet de référence de T-060
- [ ] Si le gain manque, la cause est trouvée et notée dans `STATE.md`

## Commit
`docs: measure what the asset index actually saved`
