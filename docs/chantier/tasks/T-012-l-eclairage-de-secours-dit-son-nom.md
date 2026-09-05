# T-012 — L'éclairage de secours dit son nom
Lot 2 · dépend de T-011 · indépendant du reste du lot · statut: **TODO**

## Pourquoi
`EditorViewport.buildFallbackLighting()` (`:935`) ajoute une `HemisphereLight` et une
`DirectionalLight` quand la scène n'a aucune lumière (`:931-932`). **Éditeur uniquement** : la scène est
éclairée en édition et noire en Play.

Le supprimer rendrait une scène neuve noire, ce qui se lit comme un éditeur cassé plutôt que comme
« tu n'as pas ajouté de lumière ». Le garder silencieux est précisément ce qui produit la plainte.
Une différence **énoncée** n'est pas une divergence ; une différence **découverte**, si.

## Quoi
Deux moitiés d'une même phrase, sur les deux écrans où chacune compte. Aucune plomberie nouvelle.

1. `useViewportStore` gagne **un booléen** `fallbackLighting`, posé en `EditorViewport.ts:932` à côté
   de `this.fallbackLighting.visible`. `ViewportStats` (`ViewportPanel.tsx:114-147`) gagne **une ligne** —
   il rend déjà Backend / FPS / Draw calls / Tris / Fly dans la même boîte : `Lighting · Editor default`.

2. `Engine` pousse un warning dans `create` quand la scène n'a aucun composant `light`, dans le
   vocabulaire exact que `checkPhysicsSetup` emploie déjà (`Engine.ts:184-190` — « chaque cas ici échoue
   silencieusement à l'exécution… nommer l'entité et le remède ne coûte rien ») :

   > This scene has no lights, so it renders black. The Scene view shows a default light that a build
   > will not have.

   `GamePanel.tsx:64-78` affiche déjà `playWarnings`, et `web-template/src/main.ts:242-244` les
   `console.warn` déjà.

**Écarté :** un champ `sceneWarnings: string[]` dans le store — ce serait une copie parallèle de
`playWarnings`. Un booléen et une ligne dans une boîte qui existe font tout le travail.

## Fichiers
- `packages/editor/src/state/viewportStore.ts`
- `packages/editor/src/viewport/EditorViewport.ts:931-932`
- `packages/editor/src/panels/ViewportPanel.tsx:114-147`
- `packages/runtime/src/Engine.ts` — un warning dans `create`, à côté de `:257-258`

## Terminé quand
- [ ] Scène sans lumière : la boîte de stats dit `Lighting · Editor default`
- [ ] Play sur cette scène : le warning apparaît dans le Game panel
- [ ] Ajouter une lumière fait disparaître les deux
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat: say out loud when the Scene view is lit and a build would not be`
