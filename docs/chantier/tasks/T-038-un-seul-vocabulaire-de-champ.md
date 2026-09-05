# T-038 — Un seul vocabulaire de champ, pour les composants et pour les scripts
Lot 3 · dépend de T-030 · statut: **TODO**

## Pourquoi
Deux systèmes parallèles déclarent « une propriété éditable » :
`ScriptPropertyDef` (`runtime/src/scripting/ScriptApi.ts:9-19`, 8 variantes — number, boolean, string,
color, vec3, enum, entity, asset) et `FieldSpec` (`editor/src/inspector/schema.ts:66`), dont
`COMPONENT_SCHEMAS` se sert pour les douze composants. C'est **le même concept**, et
`scriptFields()` (`schema.ts:1313-1408`) est l'adaptateur d'une centaine de lignes, avec un `switch` sur
`def.type`, qui traduit l'un vers l'autre.

C'est aussi, très exactement, le vocabulaire dont aurait besoin une extension tierce.

## Quoi
Un vocabulaire, deux producteurs. `scriptFields()` disparaît.

Contrainte : `ScriptPropertyDef` vit dans `runtime` (les scripts utilisateur compilent contre lui) et
`FieldSpec` dans `editor`. Le vocabulaire commun descend donc dans `core`, qui ne dépend de rien — ce
qui est aussi ce qui le rendra utilisable par un plugin.

## Terminé quand
- [ ] `scriptFields()` n'existe plus ; les propriétés de script produisent des `FieldSpec` directement
- [ ] Un script déclarant les 8 variantes s'édite comme avant
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor: a component field and a script property are one vocabulary`
