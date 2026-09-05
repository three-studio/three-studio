# T-011 — Le test de parité
Lot 2 · dépend de T-010 · statut: **TODO**

## Pourquoi
Trois modes projettent le même `SceneDoc` et rien n'assure qu'ils s'accordent. T-009 a corrigé la
divergence connue ; ce test est ce qui empêche la prochaine.

## Quoi
**Ce qui est assertable en `environment: 'node'`** (pas de GPU, pas de jsdom) : le graphe construit,
les propriétés de chaque objet, les uniformes de chaque matériau, la configuration d'ombre de chaque
lumière, la composition des batches, `scene.background` / `environment` / `fog`, les tailles de pools.
`packages/runtime/test/sceneBinder.test.ts:34-38` pose la vérité de terrain : `three/webgpu` s'importe
sous Node et ses objets se construisent ; ce qui ne doit jamais apparaître, c'est un `WebGPURenderer`.

**Ce qui ne l'est pas** : les pixels ; l'état du renderer (tone mapping, exposition, pixel ratio, MSAA) ;
le *timing* d'un décodage. Pour la deuxième colonne, la garantie est **au typage** grâce à T-009 :
`createRenderer` et `SceneBinder` prennent le même `RenderingSettings`, avec un seul producteur par
mode. C'est plus fort qu'un test, parce que ça ne peut pas être sauté.

**Le digest** — `packages/runtime/test/sceneDigest.ts`, un helper de test et **pas du code livré** : il
n'a aucun appelant en production aujourd'hui. Il ne lit que l'API publique (`binder.root`,
`binder.poolSizes`, `resolveEntityId`) et **rien qui porte un `uuid`** — l'identité est encodée
structurellement.

```ts
interface ProjectionDigest {
  overlays: string[];                 // scene.children hors racine du binder, par nom
  environment: { background, backgroundIntensity, backgroundRotationY,
                 environment, environmentIntensity, fog };
  lights: { entityId, type, color, intensity, castShadow,
            shadowMapSize: [number, number], shadowBias, shadowNormalBias }[];
  draws:  { entityId, type, geometry, material, castShadow, receiveShadow, visible,
            batch: null | { members, perObjectFrustumCulled, sortObjects, frustumCulled } }[];
  pools:  { geometries: number; materials: number };
}
```

Deux points qui comptent :
- Il digère **`binder.root`, pas `scene.children`**. Les overlays sont hors périmètre par construction,
  *et* une lumière d'aperçu posée par erreur sous `binder.root` apparaîtrait dans `lights` avec
  `entityId: ''` — exactement le mode de défaillance à garder.
- **Tout est trié** avant comparaison : l'ordre d'insertion diffère entre un sync complet et un sync
  incrémental, et ce n'est pas une divergence que quiconque peut voir.

**Le test** — `packages/editor/test/parity.test.ts` (il doit importer les deux côtés ; le test de
frontière ne scanne pas ce dossier). Quatre lignes de `beforeAll` suffisent à faire tourner
`Engine.create` pour de vrai — `Input` (`input/Input.ts:29-35`) est la seule dépendance navigateur sur
le chemin, `enablePhysics: false` saute Rapier, omettre `audioContext` saute l'audio.
**Aucune modification de production pour rendre le code testable.**

Fixture : une spot qui projette une ombre, **quatre** cubes identiques (`MIN_BATCH_SIZE` vaut 4,
`MeshBatcher.ts:17`, donc c'est le minimum pour qu'un batch se forme), un cube lié à un matériau asset,
un brouillard exponentiel, un fond de couleur, `shadowMapSize: 4096`.

```ts
expect(view.overlays).toEqual([...EDITOR_OVERLAYS]);
expect(play.overlays).toEqual([]);
expect({ ...view, overlays: [] }).toEqual(play);
```

Plus trois assertions compagnes : l'éclairage de secours n'entre jamais dans la projection ; un
désaccord de batching (`batching: false`) change `draws`, ce qui documente *pourquoi* T-008 existe ;
et `apps/desktop/test/exportWeb.test.ts` vérifie que `build.json` porte `rendering`.

## Terminé quand
- [ ] `git stash` de T-009 → le test échoue sur `lights[0].shadowMapSize` : `[4096,4096]` vs
      `[2048,2048]`. C'est la preuve qu'il mesure la bonne chose. Puis le remettre.
- [ ] Sa docstring dit ce qu'il ne couvre pas (pixels, état du renderer, timing async)
- [ ] `npm run typecheck && npm test` verts

## Commit
`test: assert the Scene view and Play project a scene the same way`
