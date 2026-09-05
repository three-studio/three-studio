# T-002 — `typecheck` couvre enfin les tests des apps
Lot 0 · dépend de T-001 · statut: **TODO**

## Pourquoi
`tsconfig.json` (racine) liste `packages/*/test/**/*.ts` dans son `include` mais **pas**
`apps/*/test/**/*.ts`. Les 10 fichiers de test sous `apps/desktop/test` et `apps/web-template/test`
(~99 cas) tournent sous Vitest — `vitest.config.ts` les inclut — mais ne sont **jamais typecheckés**.
`docs/ARCHITECTURE.md:29` affirme pourtant « across every workspace ».

C'est la première tâche parce que tout le reste du chantier s'appuie sur `npm run typecheck` comme
filet. Un filet troué se répare avant de sauter dedans.

## Quoi
Ajouter `apps/*/test/**/*.ts` à l'`include`, puis corriger ce que ça révèle. S'attendre à des erreurs
réelles : ces fichiers n'ont jamais été vérifiés.

## Fichiers
- `tsconfig.json` — le tableau `include`
- puis, selon ce que `tsc` sort, les fichiers sous `apps/desktop/test/` et `apps/web-template/test/`

## Terminé quand
- [ ] `npm run typecheck` vert, avec les tests des apps inclus
- [ ] `npm test` toujours vert
- [ ] Introduire volontairement une erreur de type dans `apps/desktop/test/paths.test.ts` fait
      échouer `npm run typecheck` (puis la retirer)

## Commit
`fix(build): typecheck the apps' tests, which it claimed to and did not`
