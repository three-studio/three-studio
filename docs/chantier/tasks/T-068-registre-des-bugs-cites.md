# T-068 — Le registre des bugs cités
Lot 11 · dépend de T-067 · petite tâche · statut: **TODO**

## Pourquoi
Treize identifiants — `B1` à `B15` — sont cités dans les commentaires (« ce qui ferme B15 », « c'est
B8 », « la même famille de fuite silencieuse que B1 »), sans registre. Chacun désigne un bug réel dont
la correction a façonné le code qui l'entoure.

## Quoi
Soit un registre, un paragraphe par bug, reconstruit depuis les commentaires. Soit — et c'est souvent
mieux — remplacer la citation par ce qu'elle dit, quand le commentaire l'explique déjà juste à côté.

Trancher par cas : garder l'identifiant là où il est cité plusieurs fois (B6 et B8 le sont), le
remplacer par sa substance là où il est seul.

## Terminé quand
- [ ] Aucun `Bn` dans le code ne renvoie dans le vide
- [ ] `npm run typecheck && npm test` verts

## Commit
`docs: the bugs the comments name are either registered or spelled out`
