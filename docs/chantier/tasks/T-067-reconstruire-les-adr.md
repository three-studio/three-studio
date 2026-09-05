# T-067 — Reconstruire les ADR
Lot 11 · dépend de rien · peut se faire à tout moment · statut: **TODO**

## Pourquoi
**63 citations d'`ADR-1` à `ADR-16` dans le code, et aucun document ADR dans le repo.**
Pire, la numérotation entre en collision : `ADR-4`, cité **14 fois**, désigne « un seul `AudioContext`,
deux racines » dans `runtime/src/audio/*` **et** la propriété d'aller-retour de l'undo dans
`editor/test/history.test.ts`. Deux séries distinctes sous les mêmes numéros.

| ADR | cites | sujet lisible dans les citations |
|---|---|---|
| 4 | 14 | **collision** : contexte audio / propriété de l'undo |
| 16 | 9 | tables de composants, pas de scan par frame |
| 12 | 8 | une scène par fenêtre |
| 15 | 8 | une référence est un id, jamais un nom ni un chemin |
| 7 | 6 | le contexte est un paramètre, jamais un `new` enfoui |
| 9 | 5 | l'auditeur : le composant, sinon la caméra active |
| 6, 14 | 3 | — |
| 13 | 2 | l'entité racine n'est ni protégée ni spéciale |
| 1, 2, 3, 5, 8 | 1 | — |

Le raisonnement n'est **pas** perdu : il est dans les commentaires, souvent en détail. Il n'est plus
**adressable**.

## Quoi
`docs/adr/`, un fichier par décision, reconstruit **depuis les commentaires du code eux-mêmes** — c'est
la source, et elle est bonne. Deux séries renumérotées en une seule suite, sans collision. Les 63
citations mises à jour.

Ne pas inventer : une décision dont les citations ne disent pas assez se marque comme telle plutôt que
d'être romancée.

## Terminé quand
- [ ] Chaque numéro cité dans le code résout vers un document
- [ ] Plus aucune collision
- [ ] Un grep des citations et un `ls docs/adr/` s'accordent — et un test le vérifie

## Commit
`docs(adr): the decisions the code cites now exist`
