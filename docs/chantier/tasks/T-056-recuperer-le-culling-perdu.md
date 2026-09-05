# T-056 — Récupérer le culling perdu dès qu'une ombre existe
Lot 7 · dépend de T-011 · statut: **TODO**

## Pourquoi
`MeshBatcher.ts:403` : `batched.perObjectFrustumCulled = this.shadowCasters.size === 0`.
Et `:433` : `batched.frustumCulled = false`, toujours.

Donc **une scène avec un seul soleil qui projette une ombre n'a aucun culling sur ses meshes batchés.**
C'est le cas de presque toutes les scènes.

Les deux commentaires expliquent pourquoi, et ils sont justes : `frustumCulled` est coupé parce que
three ne peut pas être prévenu que la sphère englobante d'un batch est périmée — `setMatrixAt` écrit la
texture de matrices et rien d'autre, donc un batch dont les instances bougent est culled contre l'endroit
où elles étaient, et le champ entier disparaît d'un coup. Et `sortObjects` est coupé (`:419`) pour que
`onBeforeRender` sorte tôt, ce qui ferme B15.

La question ouverte est la **première** ligne : pourquoi la présence d'un shadow caster force à
abandonner le culling par instance.

## Quoi
Comprendre d'abord — lire le commentaire de `:395-410` et l'usage de `shadowCasters`
(`SceneBinder.ts:815-817` est le seul endroit qui l'alimente). Puis mesurer avant de changer quoi que ce
soit : `renderProbe` (`studio.probe.render` dans localStorage) sur une scène de plusieurs milliers
d'entités avec un soleil ombré.

Si le culling par instance peut revenir en traitant les passes d'ombre à part, c'est le gain. Sinon,
**écrire pourquoi** au bon endroit et fermer la question.

## Terminé quand
- [ ] Un avant/après chiffré, ou une explication écrite de pourquoi il n'y a rien à gagner
- [ ] Le test de parité (T-011) reste vert — `perObjectFrustumCulled` est dans le digest
- [ ] `npm run typecheck && npm test` verts

## Commit
`perf(runtime): batched meshes keep per-instance culling when a light casts a shadow`
