# T-021 — Le scaffolding d'un projet neuf dit la vérité
Lot 9 · dépend de T-020 · petite tâche · statut: **TODO**

## Pourquoi
- `createProject` code en dur **quatre** dossiers d'assets (`project.ts:47` :
  `models|textures|materials|scripts`) alors que `ASSET_KIND_INFO`
  (`core/src/assets/import/index.ts:94-109`) en déclare **sept** — il manque `prefabs`, `shaders`,
  `audio`. Le dossier d'un importeur neuf n'est jamais créé.
- **Aucun `.gitignore` à la racine du projet créé.** Il n'y en a qu'un dans `.studio/` (`project.ts:76`).
  Un utilisateur qui met son projet dans git versionne son cache.
- `assets/manifest.json` est documenté dans l'en-tête de `core/src/project/schema.ts:9` et **n'est
  jamais écrit**. De la doc morte, à l'endroit exact où on va chercher la vérité.
- `ProjectFile.engineVersion` est écrit et **jamais lu** — « for diagnostics ». Soit un lecteur (il
  serait utile dans le rapport d'un bug), soit la suppression.

## Quoi
Les quatre, dans un commit. Les dossiers depuis `ASSET_KIND_INFO`, un `.gitignore` racine
(`.studio/`, et rien d'autre), la ligne `manifest.json` retirée de la doc, et une décision assumée sur
`engineVersion`.

## Terminé quand
- [ ] Un projet neuf a les sept dossiers et un `.gitignore` racine
- [ ] Ajouter un importeur avec un `directory` neuf fait apparaître son dossier, sans toucher `project.ts`
- [ ] `engineVersion` : lu quelque part, ou parti
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(desktop): a new project gets every asset folder, and a .gitignore`
