# T-030 — La tranche côté éditeur
Lot 1 · dépend de T-029 · **grosse tâche, un commit par type** · statut: **TODO**

## Pourquoi
C'est la moitié la plus chère du coût d'ajout d'un type : le panneau, l'icône, le marqueur, l'aide de
sélection et l'entrée de menu vivent dans cinq fichiers partagés, dont un de 1409 lignes.

## Quoi
```
packages/editor/src/components/light/
  inspector.ts   le panneau              (sort de inspector/schema.ts, le Record de 637 l.)
  overlay.ts     LightShape + style de marqueur  (sort de overlay/helpers/ et markerStyles.ts)
  menu.ts        l'entrée du menu Add    (sort de shell/addMenu.ts)
```

Assemblés par un index qui garde la **totalité** — `Record<ComponentType, …>`, comme
`COMPONENT_SCHEMAS` aujourd'hui : c'est la seule des neuf listes que le compilateur protège, et c'est
parce qu'elle est totale. On garde cette propriété, on la répand.

Un type par commit, dans le même ordre que T-024.

## Attention
`markerStyles.ts:26-31` documente que l'ordre de `PRIORITY` diverge **volontairement** de
`ICON_PRIORITY` de la hiérarchie : « l'ordre est une décision sur *cet* affichage, pas sur les types ».
Ce sont deux décisions d'affichage, elles restent deux. **Ne pas fusionner** en croyant dédupliquer.

`inspector/schema.ts` garde le **vocabulaire** de champ (`FieldSpec`, `ActionSpec`, les convertisseurs,
`GEOMETRY_FIELDS`, `MATERIAL_FIELDS`, `SCENE_SCHEMA`) — c'est du partagé, pas du par-type.

## Terminé quand
- [ ] `inspector/schema.ts` ne contient plus `COMPONENT_SCHEMAS`
- [ ] Douze dossiers sous `editor/src/components/`
- [ ] L'index reste total : ajouter un membre à l'union est une erreur de compilation
- [ ] `npm run typecheck && npm test` verts à chaque commit

## Commit
`refactor(editor): <type> owns its pane, its overlay and its menu entry` — un par type
