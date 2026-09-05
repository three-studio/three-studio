# T-017 — Les scènes se découvrent depuis le disque
Lot 9 · dépend de T-016 · **grosse tâche** · statut: **TODO**

## Pourquoi
`ProjectFile.scenes: SceneEntry[]` (`core/src/project/schema.ts:33-37`) est un **cache du système de
fichiers, et il peut périmer**. Chacun de ses trois champs est déjà ailleurs :

- `id` — dans le document de scène lui-même (`SceneDoc.id`), c'est dit dans le commentaire de `:20-27`
- `name` — dérivable du chemin ; `sceneName()` existe déjà (`project/schema.ts:88`)
- `path` — c'est l'endroit où le fichier est

Ce que ce registre coûte : `apps/desktop/src/main/scenes.ts` (263 l.) et **quatre invariants** tenus à
la main (noms uniques, `startScene` valide, les profils de build suivent une suppression, la dernière
scène reste). Supprimer un `.scene.json` dans le Finder → le projet refuse de s'ouvrir. En ajouter un à
la main → il est invisible. Et deux personnes qui ajoutent chacune une scène entrent en conflit de merge
dans `project.json`.

## Quoi
`scenes/**/*.scene.json` **est** la liste. `project.json` ne garde que ce qui n'est pas dérivable :
`startScene` (un id), `loadingScene`, `rendering`, `physics`, `build`.

Carte blanche sur le format : `ProjectFile.scenes` **disparaît**, sans migration.

Points de vigilance :
- Un id se lit dans le document. Ouvrir un projet lit donc l'en-tête de chaque `.scene.json` — T-019
  met ça en cache.
- Deux fichiers portant le même id (une copie dans le Finder) : c'est un cas réel maintenant. Décider,
  le documenter, et le tester — probablement : le premier par ordre de chemin gagne, l'autre est
  signalé, aucun des deux n'est perdu.
- `startScene` peut nommer un id qui n'est plus sur le disque : replier sur la première scène, comme
  `openProject` le fait déjà (`project.ts:88-91`), sans lever.
- Les profils de build nomment des ids de scènes (`BuildProfile.scenes`) : un id absent devient un
  warning d'export, pas une erreur d'ouverture.

## Fichiers
- `packages/core/src/project/schema.ts:33-46` — `SceneEntry` et `ProjectFile.scenes`
- `apps/desktop/src/main/project.ts` — `createProject`, `openProject`, `readProjectFile`
- `apps/desktop/src/main/scenes.ts` — l'essentiel disparaît (voir T-018)
- `packages/core/src/project/schema.ts:52-66` — `findScene` / `resolveScene` prennent la liste découverte
- tous les appelants de `findScene` / `resolveScene` : `exportWeb.ts`, `windows.ts`, `EditorViewport.ts`
- `apps/desktop/test/sceneRegistry.test.ts`, `projectFile.test.ts`

## Terminé quand
- [ ] Copier un `.scene.json` dans le Finder, rouvrir : la scène est là
- [ ] En supprimer un : le projet s'ouvre quand même
- [ ] Deux fichiers de même id : comportement décidé, documenté, testé
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(core): scenes are discovered on disk, not declared in project.json`
