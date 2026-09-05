# T-043 — `EditorViewport` découpé
Lot 4 · dépend de T-042 · **grosse tâche** · statut: **TODO**

## Pourquoi
963 lignes et **sept** responsabilités : le renderer et le canvas, la boucle de frame, le cycle Play et
la construction du `SceneHost`, l'arbitrage du pointeur, le clic-sélection, le resize, les stats,
l'éclairage de secours, et le diff d'expansion des prefabs. Elle lit **huit** stores.

T-010 en a déjà sorti la projection.

## Quoi
- `ViewportRenderer` — canvas, renderer, resize, stats
- `PlaySession` — `beginPlay`/`endPlay`, le `SceneHost`, le snapshot, les warnings
- `ViewportInput` — arbitrage du pointeur, handlers de sélection
- `EditorViewport` reste la **racine de composition** et la boucle de frame

## Attention
Le `AbortController` (`:120-126`) remplace quatre handlers stockés : les quatre étaient des closures
anonymes jamais retirées — invisible tant que le canvas est un singleton, fuite dès qu'il ne l'est plus.
Chaque morceau garde ce motif.

`sizeDirty` (`:137-146`) : l'observer lève un drapeau, la boucle agit. Redimensionner un renderer WebGPU
retire sa cible de sortie et sa swap chain, et faire ça depuis un callback d'observer le place à un
moment du tour que ce côté ne choisit pas. **La boucle est le seul endroit où rien n'est à moitié
encodé.** Ne pas « simplifier » en resizant depuis l'observer.

## Terminé quand
- [ ] Chaque fichier a une responsabilité qu'on peut nommer en une phrase
- [ ] Le smoke harness passe, capture identique
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(editor): the viewport is a composition root, not a god object`
