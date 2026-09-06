# T-065 — La palette de commandes
Lot 8 · dépend de T-064 · statut: **FAIT**

## Pourquoi
Après T-062 à T-064, elle **tombe du registre**. Ce n'est plus une fonctionnalité à écrire, c'est une
vue sur une donnée qui existe : chaque commande a un id, un libellé fonction du contexte, et un `can()`.

## Quoi
Une palette qui liste les commandes dont `can()` est vrai dans le contexte courant, filtrées par frappe,
avec le raccourci affiché à droite.

Elle passe par `useOverlay` (`state/overlayStore.ts`) comme toute surface qui couvre l'éditeur — et
elle utilise les `--z-index-*` déclarés dans le bloc `@theme` de `styles.css`, jamais un nombre choisi
sur place.

## Elle tombe bien du registre
`CommandPalette.tsx` ne sait **rien** des gestes qui existent : les libellés sont `label(ctx)`, le
filtre est `can(ctx)`, les touches à droite viennent de la table de T-064, et la liste est
`commandIds()`. Une commande ajoutée à n'importe quelle famille y apparaît sans toucher ce fichier.

**Elle s'ouvre par une commande**, `openCommandPalette`, et pas par un cas particulier dans le
gestionnaire de touches — sinon il aurait fallu une quatrième orthographe de « quelle touche fait
quoi », exactement ce que T-064 vient de supprimer. Elle se liste elle-même, comme dans VS Code.

## Une régression d'affichage, trouvée et corrigée
Le premier passage a montré **`Delete⌦`** là où le menu affichait `⌫`. `bindingForCommand` rend le
**premier** binding, et `Delete` précédait `Backspace` dans la table. Or la touche « supprimer » d'un
clavier Mac *est* Backspace, et tout menu Mac la dessine `⌫` ; un PC a un Del séparé. L'ordre des deux
entrées dépend donc de la plateforme, ce que les menus disaient chacun de leur côté par
`isMac ? '⌫' : 'Del'`. Épinglé par un test.

## Terminé quand
- [x] La palette s'ouvre (`⌘⇧P`, par la table), filtre (« dupl » → `Duplicate⌘D` et
      `Duplicate Scene…`), exécute (Entrée → `undoLabel: "Duplicate entity"`) et respecte `can()` :
      12 gestes offerts sur une entité sélectionnée, aucun de ceux qui ne peuvent pas agir
- [x] `Escape` va au sommet de la pile et nulle part ailleurs — vérifié : la palette se ferme **et la
      sélection derrière elle survit**. `useOverlay('modal', close, open)` ; la palette ne traite pas
      Escape elle-même
- [x] `--z-index-dialog` via `z-dialog`, jamais un nombre choisi sur place
- [x] `npm run typecheck && npm test` verts — 994 tests. `renderer errors: none`

## Commit
`feat(editor): a command palette, which the registry now simply affords`
