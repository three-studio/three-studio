# T-049 — Le `.d.ts` des scripts cesse d'être recopié à la main
Lot 5 · dépend de T-048 · statut: **TODO**

## Pourquoi
`apps/desktop/src/main/scripts.ts:114-289` — `RUNTIME_DTS` — est **~115 lignes de TypeScript dans un
template literal** qui recopient à la main :

| Recopié | Source de vérité |
|---|---|
| `ScriptPropertyDef` (union à 8 bras) | `runtime/src/scripting/ScriptApi.ts:9-19` |
| `EntityHandle` | `ScriptApi.ts:53-57` (`any` contre `Object3D`) |
| `AudioBus` | `core/src/scene/schema.ts:385` |
| `StudioInput` | `runtime/src/input/Input.ts` |
| `AudioVoice`, `AudioClipOptions`, `StudioAudio` | `runtime/src/scripting/audioApi.ts` |
| `class Behaviour` + 7 hooks | `ScriptApi.ts:73-176` |

Les noms de hooks apparaissent une **troisième** fois dans `RESERVED_PROPERTY_NAMES`
(`ScriptApi.ts:31-50`), et `AudioBus` une **quatrième** dans le schéma de l'Inspector.

C'est ce que l'auteur du script voit dans son éditeur. Quand ça dérive, il code contre une API qui
n'existe pas.

## Quoi
Produire le `.d.ts` depuis les vraies sources. À défaut — TypeScript 7 n'a pas d'API JS, ce que
`packages/core/package.json` documente — au minimum **un test qui compile le `.d.ts` généré contre le
vrai `ScriptApi`** et échoue à la première divergence.

`RESERVED_PROPERTY_NAMES` se dérive des hooks au lieu d'être listé.

## Terminé quand
- [ ] Ajouter un hook à `Behaviour` sans toucher `scripts.ts` fait échouer un test (ou apparaît tout seul)
- [ ] `apps/desktop/test/upgradeContracts.test.ts` reste vert
- [ ] `npm run typecheck && npm test` verts

## Commit
`fix(desktop): the script typings come from the runtime, not from a copy of it`
