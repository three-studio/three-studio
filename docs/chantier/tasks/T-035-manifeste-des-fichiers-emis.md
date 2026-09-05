# T-035 — Un build se vérifie
Lot 10 · dépend de T-034 · statut: **TODO**

## Pourquoi
Rien ne dit ce qu'un export a écrit. Une CI qui publie un build ne peut ni vérifier qu'il est complet,
ni détecter qu'un fichier a été altéré après coup.

## Quoi
Un manifeste des fichiers émis, chacun avec sa taille et son empreinte, écrit en fin d'export. Les
empreintes existent déjà après T-034 pour les assets ; restent le player, les scènes et les scripts.

Plus un mode de vérification qui relit le dossier et le compare au manifeste.

## Terminé quand
- [ ] Le manifeste liste tout ce qui a été écrit
- [ ] Modifier un octet d'un fichier exporté fait échouer la vérification
- [ ] `npm run typecheck && npm test` verts

## Commit
`feat(export): emit a manifest of what was written, so a build can be verified`
