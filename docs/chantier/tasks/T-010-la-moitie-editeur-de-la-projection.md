# T-010 — La moitié éditeur de la projection, dans son propre fichier
Lot 2 · dépend de T-009 · statut: **TODO**

## Pourquoi
Le test de parité (T-011) doit construire la projection de l'éditeur **sans canvas et sans GPU**.
Aujourd'hui elle est enchevêtrée dans `EditorViewport`, qui possède aussi le renderer, la boucle de
frame et le cycle Play.

Et la liste des différences entre l'édition et le jeu n'est écrite nulle part : elle se déduit en
lisant 963 lignes.

## Quoi
Nouveau fichier `packages/editor/src/viewport/editorProjection.ts` :

- `createEditorProjection(options)` — la `Scene` de l'éditeur, son binder via `bindScene`, et les
  overlays. Appelable sans renderer.
- `EDITOR_OVERLAYS` — **la constante qui énonce toute la différence** :

  ```ts
  export const EDITOR_OVERLAYS = [
    'EditorGrid',        // les deux GridHelper, le plan de sol
    'EntityMarkers',     // le clic-cible de ce qui ne dessine rien
    'SelectionHelpers',  // cônes de lumière et frustums de caméra, pendant la sélection
    'SelectionOutline',
    'TransformGizmo',
    'FallbackLighting',  // le seul qui change ce qui est *éclairé* — voir T-012
  ] as const;
  ```

  Ce qui diffère entre les deux modes et n'est pas sur cette liste est un bug, et T-011 est ce qui
  le dit.

- La construction de la grille sort de `EditorViewport.buildHelpers` (`:807-822`).
- `EditorViewport.helpers` disparaît comme conteneur : chaque overlay devient un `Group` **nommé**
  ajouté directement à `this.scene`. `EntityMarkers.root` (`:74`), `SelectionHelpers.root` (`:55`) et
  `SelectionOutline` (`:26`) posent déjà leur `.name`.

## Attention
`SelectionHelpers` et `SelectionOutline` sont parentés sous un groupe d'identité **exprès**
(`EditorViewport.ts:226-228`) : les helpers de lumière et de caméra de three adoptent la matrice monde
de ce qu'ils annotent. Les ajouter directement à `this.scene` préserve ça (la matrice d'une `Scene` est
l'identité) ; les mettre sous un parent transformé, non. **Garder le commentaire.**

Pourquoi pas un masque de layers : ça ne coûte rien par frame, mais ça n'achète rien non plus tant que
les deux modes ont des `Scene` séparées — ce que ce design garde volontairement. Et ça dépenserait une
ressource globale que `MeshBatcher.ts:30-34` mise explicitement (« rien d'autre dans le projet ne touche
aux layers »). Écarté.

## Fichiers
- nouveau : `packages/editor/src/viewport/editorProjection.ts`
- `packages/editor/src/viewport/EditorViewport.ts:84,179,222-231,807-822,935`

## Terminé quand
- [ ] `createEditorProjection` s'appelle sans canvas ni renderer
- [ ] Les six overlays sont des enfants nommés de la `Scene`, et `EDITOR_OVERLAYS` les liste
- [ ] Le viewport se comporte comme avant, vérifié au smoke harness
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(editor): the Scene view's half of the projection, in its own file`
