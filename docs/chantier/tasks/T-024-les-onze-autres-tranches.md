# T-024 — Les onze autres tranches
Lot 1 · dépend de T-023 · **un commit par type** · statut: **TODO**

## Quoi
Répéter exactement la forme de T-023, un type par commit, dans cet ordre — du plus simple au plus
enchevêtré, pour que les surprises arrivent quand le patron est rodé :

`audioListener` · `prefabInstance` · `script` · `playerController` · `rigidbody` · `collider` ·
`camera` · `audioSource` · `model` · `water` · `mesh`

`mesh` en dernier : c'est lui qui porte la géométrie et le matériau, donc le `fill` en profondeur, et
`createComponentForEntity` le lit (voir T-025).

## Terminé quand
- [ ] Douze dossiers sous `core/src/components/`, un par type
- [ ] `npm run typecheck && npm test` verts **à chaque commit**, pas seulement au dernier

## Commit
`refactor(core): <type> owns its type, its factories and its definition` — un par type
