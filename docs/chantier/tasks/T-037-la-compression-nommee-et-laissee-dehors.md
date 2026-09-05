# T-037 — La compression : nommée, et laissée dehors
Lot 10 · dépend de T-036 · statut: **TODO**

## Pourquoi
Draco, KTX2, WebP : un exportateur de production les aura. Ce n'est **pas** une dette — c'est une
fonctionnalité qui n'a pas été écrite, et la confondre avec un défaut ferait construire un point
d'extension sans implémenteur.

## Quoi
**Ne rien coder.** Écrire un ADR qui dit : par quel seam ça entre (celui des importeurs, qui possède
déjà les réglages par format et les lit partout — éditeur, Play et build exporté), pourquoi ça n'entre
pas par l'exportateur, et ce que ça exigerait du player.

## Terminé quand
- [ ] L'ADR existe et nomme le seam
- [ ] Aucune ligne de code de production ajoutée

## Commit
`docs(adr): where texture and mesh compression enters, and why not in the exporter`
