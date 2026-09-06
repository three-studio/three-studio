# T-067 — Reconstruire les ADR
Lot 11 · dépend de rien · peut se faire à tout moment · statut: **FAIT**

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

> ⚠️ **La fiche et le `PLAN.md` se contredisaient.** Le jalon 11.1 dit « renuméroter en **deux séries
> distinctes** » ; cette fiche dit « une seule suite ». Tranché pour **une suite** : c'est la
> convention ADR, et `docs/adr/0001-…` était déjà numéroté ainsi. Deux séries auraient demandé un
> préfixe (`ADR-AUDIO-4`) pour le même travail de réécriture.

> ⚠️ **Il y avait trois collisions, pas une.**
> - `ADR-4` : le contexte audio **et** les invariants de l'undo — annoncé.
> - `ADR-9` : l'identité d'un composant (`core`) **et** l'auditeur audio (`runtime`) — **non annoncé**.
> - `ADR-1` : la hiérarchie stockée trois fois, alors que `docs/adr/0001-…` existait déjà et parlait de
>   compression. Le seul document présent était en collision avec une citation.
>
> Chacune se tranche **par fichier**, pas par numéro : la conversion a une table
> `(citation, fichier) → numéro` pour les deux ambiguës.

Ne pas inventer : une décision dont les citations ne disent pas assez se marque comme telle plutôt que
d'être romancée.

## Terminé quand
- [x] Chaque numéro cité dans le code résout vers un document — 68 citations, 46 fichiers réécrits,
      **16 décisions** dans `docs/adr/0002` … `0017`
- [x] Plus aucune collision. Les citations sont écrites **à quatre chiffres** (`ADR-0005`), ce qui est
      ce qui permet à un grep et à un `ls` de se comparer littéralement
- [x] `test/adr.test.ts` vérifie **les deux sens** — une citation sans document, et un document que
      rien ne cite. Cassé pour vérifier : une citation remise en ancienne forme fait tomber trois
      tests ; retirer la seule citation d'un ADR en fait tomber un
- [x] `npm run typecheck && npm test` verts — 1005 tests

## Ce qui n'a pas été romancé
Les invariants de l'undo sont cités comme « les neuf invariants d'ADR-4 » et **trois seulement** sont
nommés (la porte unique, la sélection non optionnelle, la coalescence). `0009` porte les trois, et un
avertissement en tête disant que les six autres ne sont pas reconstituables. La fiche le demandait :
« une décision dont les citations ne disent pas assez se marque comme telle ».

## Ce qui n'a pas été touché
`docs/chantier/` cite aussi des numéros — dans `PLAN.md`, `STATE.md` et des fiches. Ces textes
décrivent l'état **d'avant** ; y réécrire les numéros effacerait le constat de la collision. Le test
exclut ce dossier, et le dit.

## Commit
`docs(adr): the decisions the code cites now exist`
