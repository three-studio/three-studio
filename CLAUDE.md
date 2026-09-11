# Three Studio

Un éditeur de jeux vidéo 3D pour ordinateur, basé sur Three.js (WebGPU), React et Electron.
Voir `README.md` pour savoir comment le lancer.

## Les notes de travail ne sont pas dans le dépôt

`docs/` est **ignoré par git**. Les notes, les plans et les documents de décision y vivent en local et
n'y sont jamais commités. Si le dossier est là sur cette machine, il est à lire ; s'il ne l'est pas
après un clone, c'est normal, et rien dans le code n'en dépend.

Conséquence à connaître : **n'ajoutez pas de citation vers un document de `docs/`** dans un commentaire.
Elle ne résoudrait pour personne d'autre. Le raisonnement va dans le commentaire lui-même — c'est de
toute façon là qu'il est le plus utile, juste à côté du code qu'il explique.

## Conventions déjà imposées par ce dépôt

- **Les commentaires expliquent *pourquoi*, avec autant de détails que nécessaire lorsque le pourquoi
  a déjà fait perdre une matinée à quelqu'un.** Faites de même. Un commentaire qui se contente de
  reformuler le code est du bruit ; un commentaire qui explique le problème ou l'échec ayant motivé
  le code est utile.
- **Ajoutez des champs, n'en supprimez jamais, dans tout ce qui est persisté.** Remplissez les champs
  manquants à partir de la factory propre au type, jamais à partir d'une seconde liste. Laissez les
  données non reconnues exactement telles qu'elles ont été trouvées.
- **Une référence est un identifiant** — jamais un nom, jamais un chemin.
- `packages/core` n'importe rien d'autre que `.` et `node:`. `packages/runtime` n'importe jamais
  l'éditeur. Ces deux règles sont vérifiées par des tests.
- `npm run typecheck && npm test` doit être au vert à chaque commit.

On parle et on échange en français, mais on écrit en anglais.
