# T-023 — La tranche verticale : `light` comme patron
Lot 1 · dépend de T-022 · **la tâche qui fixe la forme de tout le lot** · statut: **TODO**

## Pourquoi
Ce qui définit le type `light` vit dans **sept** fichiers : le type dans `core/src/scene/schema.ts:211-280`,
les fabriques dans `core/src/scene/defaults.ts:133-185` et `:472-505`, la définition dans
`core/src/components/light.ts`, le panneau dans `editor/src/inspector/schema.ts` (dans un `Record` de
637 lignes), le système dans `runtime/src/systems/LightSystem.ts`, l'aide de sélection dans
`editor/src/viewport/overlay/helpers/LightShape.ts`, le marqueur dans `overlay/markerStyles.ts`.

Le code est rangé **par couche**. Le domaine, lui, varie **par type de composant**. Donc chaque
changement traverse toutes les couches, et ajouter un type coûte 14 fichiers dont un seul est attrapé
par `tsc`.

## Quoi
Faire **une seule** tranche, `light`, entièrement — et s'arrêter là. C'est elle qui fixe la forme que
les onze autres suivront (T-024).

```
packages/core/src/components/light/
  schema.ts    LightKind, ShadowSettings, LightComponent      (sort de scene/schema.ts)
  defaults.ts  createLight, createShadowSettings, createLightEntity  (sort de scene/defaults.ts)
  index.ts     defineComponent({ type:'light', create, fill, assets, icon, runtime })
```

Le cycle que `core/src/components/index.ts:60-66` documente **disparaît de lui-même** : une définition
n'importe plus `defaults.ts`, elle *contient* sa fabrique. (Le commentaire dit que trois cycles ont déjà
été payés sur ce refactor — le relire avant de commencer.)

Ne pas toucher aux couches `runtime` et `editor` dans cette tâche : elles viennent en T-026 et T-028,
une fois la forme côté `core` éprouvée.

## Attention
`light` est le bon patron **parce qu'il est le cas dur** : son `fill` ne peut pas être générique. Les
unités de three diffèrent d'un ordre de grandeur entre les kinds — l'intensité par défaut d'une
directionnelle est 2, celle d'une ponctuelle 12 — donc remplir une directionnelle stockée avec les
défauts d'une ponctuelle lui donnait six fois la luminosité choisie par l'auteur. `components/light.ts`
documente ça ; **le commentaire déménage avec le code**.

## Terminé quand
- [ ] `scene/schema.ts` et `scene/defaults.ts` ne contiennent plus rien de spécifique à `light`
- [ ] `core/src/index.ts` exporte toujours la même surface publique
- [ ] Le test d'architecture (T-004) ne voit pas de cycle neuf
- [ ] `npm run typecheck && npm test` verts, sans toucher aux tests existants

## Commit
`refactor(core): light owns its type, its factories and its definition`
