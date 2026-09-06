# T-068 — Le registre des bugs cités
Lot 11 · dépend de T-067 · petite tâche · statut: **FAIT**

## Pourquoi
Treize identifiants — `B1` à `B15` — sont cités dans les commentaires (« ce qui ferme B15 », « c'est
B8 », « la même famille de fuite silencieuse que B1 »), sans registre. Chacun désigne un bug réel dont
la correction a façonné le code qui l'entoure.

## Quoi
Soit un registre, un paragraphe par bug, reconstruit depuis les commentaires. Soit — et c'est souvent
mieux — remplacer la citation par ce qu'elle dit, quand le commentaire l'explique déjà juste à côté.

Trancher par cas : garder l'identifiant là où il est cité plusieurs fois (B6 et B8 le sont), le
remplacer par sa substance là où il est seul.

> **Compté : douze des treize sont cités plusieurs fois.** B1 seize fois, B10 dix, B2/B5/B6/B9 sept.
> **Un seul est isolé, `B12`** — et son unique commentaire dit déjà tout ce qu'un registre en dirait.
> Donc : un registre pour les douze, et pour B12 la phrase sans l'identifiant.

## Terminé quand
- [x] Aucun `Bn` dans le code ne renvoie dans le vide — `docs/bugs.md`, une entrée par bug, avec ce
      qu'il était, **pourquoi il était invisible**, et ce qui l'empêche de revenir
- [x] `test/adr.test.ts` vérifie les deux sens, comme pour les ADR : une citation sans entrée, **et
      une entrée que rien ne cite** — ce dernier cas voulant dire qu'une garde a disparu. Cassé pour
      vérifier dans les deux sens
- [x] `B12` retiré du code, sa phrase conservée. `B13` et `B14` ne sont cités nulle part et rien ne dit
      ce qu'ils étaient : le registre le note, pour que le trou se lise comme connu
- [x] **`B15` est le seul encore ouvert**, et le registre le dit avec ses mesures (T-056)
- [x] `npm run typecheck && npm test` verts — 1007 tests

## Un registre, pas des fiches
Un fichier unique et non un par bug, contrairement aux ADR : un bug se lit **quand on rencontre une
citation**, jamais en y naviguant pour lui-même. Une décision est l'inverse — elle contraint ce qu'on
écrit ensuite — d'où un fichier chacune dans `docs/adr/`.

## Commit
`docs: the bugs the comments name are either registered or spelled out`
