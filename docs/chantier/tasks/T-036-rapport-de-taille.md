# T-036 — Le rapport de taille
Lot 10 · dépend de T-035 · petite tâche · statut: **TODO**

## Pourquoi
C'est la première chose qu'un auteur regarde après un export, et il n'existe pas. `ExportResult` compte
des scènes, des assets et des scripts — jamais des octets.

## Quoi
Une ventilation par catégorie (player, scènes, modèles, textures, audio, scripts) dans `ExportResult`,
affichée par `PackageDialog`. Les tailles sont déjà connues après T-035.

## Terminé quand
- [ ] Le dialogue montre la ventilation et le total
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(export): report what the build weighs, by category`
