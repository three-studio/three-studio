# T-025 — `scene/schema.ts` et `scene/defaults.ts` réduits à ce qui est partagé
Lot 1 · dépend de T-024 · statut: **TODO**

## Pourquoi
Une fois les douze tranches sorties, ce qui reste dans ces deux fichiers est soit vraiment partagé,
soit mal placé. `defaults.ts` (663 l.) porte aujourd'hui : les fabriques de composants, de géométrie, de
matériau, d'ombre, d'environnement, de ciel, **et** les templates d'entité, **et** cinq tables de
présentation (`GEOMETRY_LABELS:377`, `LIGHT_LABELS:462`, `LIGHT_INTENSITY:122`, `SHADOW_CASTERS:147`,
`FLAT_KINDS:394`, `UNPLACED_LIGHTS:496`), **et** deux heuristiques de placement (`restingOffsetY:408`,
`isPlaceable:506`), **et** trois constructeurs de scène entière.

## Quoi
- `scene/schema.ts` ne garde que l'union `ComponentDoc`, `ComponentBase`, `ComponentTables`,
  `EntityDoc`, `SceneDoc`, `EnvironmentDef`, `SkySettings` et les primitives (`Vec2`, `Vec3`, `Hex`,
  `Transform`, `GeometryDef`, `MaterialDef`).
- `scene/defaults.ts` ne garde que les fabriques partagées (transform, matériau, géométrie, ombre,
  environnement, ciel) et les trois constructeurs de scène.
- Les tables de présentation qui n'appartiennent qu'à un type partent dans sa tranche
  (`LIGHT_LABELS`, `LIGHT_INTENSITY`, `SHADOW_CASTERS`, `UNPLACED_LIGHTS` → `light/`).
- `isPlaceable` (`:506`) nomme `'light'` en dur : ça devient une propriété déclarée par la définition.

## Terminé quand
- [ ] Aucun des deux fichiers ne nomme un type de composant particulier
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(core): the shared schema keeps only what is shared`
