# T-026 — `createComponentForEntity` rendu au collider
Lot 1 · dépend de T-025 · petite tâche · statut: **TODO**

## Pourquoi
`core/src/components/index.ts:93-156` est un `switch` de 60 lignes sur `GeometryKind` qui **ne sert
qu'à `collider`**, gardé par `if (type !== 'collider') return createComponent(type)` (`:97`). C'est du
savoir sur le collider, tenu hors de la tranche du collider.

Le commentaire (`:83-92`) défend sa place : ça lit un composant **frère**, donc c'est un fait sur
l'entité et pas sur le type, et un `createFor(entity)` sur les douze définitions serait onze copies de
`create()` pour en servir une. **L'argument tient toujours** — c'est la place du code qui ne tient pas.

## Quoi
Le `switch` déménage dans `core/src/components/collider/`. La fonction générique reste où elle est et
délègue. Pas de nouveau point d'extension sur les douze définitions : un seul type le veut, donc un seul
type le porte.

Le commentaire garde chacune de ses justifications — pourquoi un plan devient un `trimesh` et pas une
boîte fine (une dalle plus fine que la distance de snap-to-ground du character controller se fait
traverser), pourquoi un tore devient un `trimesh` (un convex hull boucherait le trou), pourquoi les
solides de Platon deviennent un `convexHull`.

## Terminé quand
- [ ] `components/index.ts` ne nomme plus `'mesh'`, `'model'` ni `GeometryKind`
- [ ] `npm run typecheck && npm test` verts, `core/test/entityDefaults.test.ts` compris

## Commit
`refactor(core): the collider owns the shape it guesses from its siblings`
