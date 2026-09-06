# État du chantier

**Branche** : `refactor/architecture`
**Dernier commit** : T-065 — une palette de commandes, que le registre offre désormais
**Tâche courante** : **T-066** — `playCommands` cesse de piloter la disposition
**Faites** : T-001 → T-061, **T-062a → T-062e, T-063 → T-065**. Reste **T-062f**, après T-066. **Lots 0, 2, 3a, 3b, 4, 5, 6, 7, 9 et 10 terminés.** Lot 1 : les neuf
tâches sont faites, mais la case « aucun fichier partagé hors la ligne d'union » n'est pas cochée —
voir `RESTES.md`. Restent le **lot 8** (T-062 → T-066) et le **lot 11** (T-067 → T-070).

> **Ce qui a été laissé de côté est dans `RESTES.md`** — une ligne par chose qu'une tâche aurait pu
> faire et n'a pas faite, avec ce qui la rouvrirait. Les notes ci-dessous sont chronologiques ; ce
> fichier-là est la liste.

> ⚠️ **Une seule chose reste ouverte sur T-006** : le job CI n'a jamais tourné sur un runner. Voir
> « Ce que T-006 n'a pas pu vérifier » plus bas. À regarder à la première PR poussée.

## Notes de reprise

**T-065 — la palette est 150 lignes et ne sait rien des gestes qui existent.** Libellés `label(ctx)`,
filtre `can(ctx)`, touches de la table de T-064, liste `commandIds()`. Une commande ajoutée à
n'importe quelle famille y apparaît sans toucher `CommandPalette.tsx`. C'est la vérification que les
quatre tranches précédentes ont produit ce qu'elles annonçaient.

**Elle s'ouvre par une commande, `openCommandPalette`.** Un cas particulier dans `useShortcuts` aurait
été une quatrième orthographe de « quelle touche fait quoi », que T-064 vient de supprimer. Elle se
liste elle-même — VS Code fait pareil, et la relancer depuis elle-même est inoffensif.

**⚠️ Une régression d'affichage introduite par T-064, trouvée par le harnais.** La palette montrait
`Delete⌦` là où le menu affichait `⌫`. `bindingForCommand` rend le **premier** binding, et `Delete`
précédait `Backspace`. Or la touche « supprimer » d'un clavier Mac **est** Backspace, dessinée `⌫`
partout ; un PC a un Del séparé. L'ordre des deux entrées dépend donc de la plateforme — ce que les
menus disaient chacun par `isMac ? '⌫' : 'Del'` avant que la table ne les remplace. **Une table
indexée par binding a un ordre, et cet ordre est une décision d'affichage.** Épinglé par un test.

**Le critère d'empilement est vérifié dans les deux sens** : Escape ferme la palette **et la sélection
derrière survit**. La palette ne traite pas Escape elle-même — `useOverlay` suffit, et le prendre en
main aurait remis le bug des deux surfaces qui se ferment ensemble.

**⚠️ Cinq gestes ne peuvent pas apparaître dans la palette** : ceux qui portent une cible
(`openScene`, `openSceneInNewWindow`, `setStartScene`, `revealAsset`, `deleteAsset`).
`currentContext()` ne porte ni `assetId` ni `sceneId`, donc leur `can()` répond `false` — ce qui est
correct, mais les met hors de portée du clavier. Inscrit dans `RESTES.md` : la réponse est une palette
en deux temps.

**T-064 — il y avait trois orthographes d'un raccourci, pas deux, et la troisième était morte.** Le
`switch` de `useShortcuts` décidait ; les hints des menus étaient tapés à la main (`${modKey}Z` une
fois dans `MenuBar`, une fois dans `HierarchyPanel`, une fois dans `addMenu`) ; et
**`Command.shortcut` n'était lu nulle part** — vérifié, le seul `.shortcut` lu est celui de
`MenuItem`. Un remappage aurait dû trouver les trois. Il y a maintenant **une** table,
`shell/shortcutBindings.ts`, et les deux sens en sortent : le clavier demande binding → commande, un
menu demande commande → binding et le formate. `Command.shortcut` est supprimé.

**La table est indexée par binding, pas par commande**, et c'est ce qui permet à un geste d'avoir
plusieurs touches : redo répond à `Mod+Shift+Z` **et** `Mod+Y`, delete à `Delete` **et** `Backspace`.
Une table dans l'autre sens aurait dû en faire des listes. Un override vaut `null` pour **libérer**
une touche — sans ça, on ne peut qu'ajouter, jamais reprendre.

**`shortcuts.json`, à côté de `layouts.json` et pas dedans.** Les deux s'écrivent sur des rythmes sans
rapport : la disposition à chaque glissement de séparateur, un raccourci une fois par an. Partager un
fichier voudrait dire réécrire les liaisons des centaines de fois par session, et les perdre sur un
crash pendant une de ces écritures.

**Vérifié en deux passages du harnais, parce que le critère parle de redémarrage.** Le premier écrit
`Mod+K → save` et libère `Mod+S` ; le second relance et les lit depuis le disque avant toute action.
Le menu Fichier affiche alors **`Save Scene⌘K`** — la preuve que l'affichage vient bien de la même
table. Préférences de l'utilisateur remises à `{}` en sortant.

**⚠️ `shortcutsApply` n'a pas bougé d'une ligne**, comme la fiche l'exigeait : les deux questions — la
pile d'overlays *et* le focus — sont posées comme avant, et leurs quatre tests sont intacts.

**Un changement de comportement, petit et voulu** : un accord avec modificateur que la table ne nomme
pas rend maintenant la main au navigateur au lieu de tomber dans les touches d'outil. Avant, `Cmd+R`
passait le `switch` (null → return) ; la structure est différente, donc c'est écrit explicitement.

**⚠️ La fuite signalée dans « Attention » n'a pas été reproduite et n'a pas été corrigée** :
`peekViewport()?.controls.isNavigating` est toujours là. Elle concerne les **touches d'outil**, qui ne
sont pas des commandes — elles se résolvent sur `event.code`, la position physique, délibérément, pour
que Q/W/E/R restent sous les mêmes doigts en AZERTY. Elles ne sont donc pas dans la table.

**T-063 — la solution était déjà dans le dépôt, pour le geste que la fiche citait en exemple.** Elle
demandait de résoudre « une commande doit demander à une vue de se mettre en édition » sans inventer
un bus. `assetStore.reveal(assetId)` pose `revealed`, le panneau le lit, le dessine, l'efface : un
champ qu'une commande écrit et qu'une vue lit. Pas de file, pas d'abonnement à un canal, et une vue
non montée ne lit rien. `editorStore.renaming` est le même, avec `beginRename` / `endRename`.

**⚠️ `docs/audio/DECISIONS.md` n'existe pas**, ni aucun ADR-8, nulle part dans `docs/` — la fiche s'y
référait. C'est exactement ce que **T-067** doit réparer. Consigné sur la fiche.

**⚠️ Deux défauts de plus, cachés derrière le premier.** `renameCommand.run` ne faisait rien parce que
`setRenameHandler` n'était appelé par personne — et sous ce silence, son corps lisait
`editorStore.selection` en **ignorant le contexte qu'on lui passait**. Un clic droit hors sélection
aurait mis en édition la mauvaise ligne. Un geste mort ne montre pas ses bugs : c'est un argument de
plus pour que `run` ne soit jamais un no-op silencieux.

**Trois chemins vers un renommage, un seul qui demandait la permission.** Le double-clic posait l'état
local sans passer par `can('rename')`, et l'entrée « Rename » du menu d'une entité produite par un
prefab n'avait aucun verdict du tout. Les trois sont `entry('rename')` ou
`commandById('rename').run(contextFor([id]))` maintenant.

**⚠️ Piège du harnais, pour la prochaine sonde qui pilote un champ React :** `input.blur()`, jamais
`dispatchEvent(new Event('blur'))`. React écoute `focusout`, que seule la méthode native émet — le
premier passage a rendu « le champ s'ouvre mais le nom n'est pas écrit », ce qui ressemblait à un bug
du produit et venait de la sonde. Même famille que le `pointerenter` déjà noté dans la compétence.

**T-062e — `EditorContext` gagne `sceneId`, sa deuxième cible.** Trois appelants d'un coup — le menu
Scène, le sous-menu *Open in New Window*, la radio des réglages de projet. Le champ `assetId` de
T-062b sert de patron ; les deux sont des ids, jamais des chemins ni des noms.

**Deux formulations de « cette scène est-elle ouvrable » n'en font plus qu'une.** `openScene` portait
`disabled: scene.shadowedBy !== null` dans le menu ; `openSceneInNewWindow` disait la même chose plus
« pas la scène courante » dans un `.filter`, avec ses propres mots. Le sous-menu filtre maintenant sur
`can()`. **La scène courante n'est délibérément pas refusée par `openScene`** : c'est la ligne cochée
de ce qui se lit comme une liste radio, et griser la ligne qui dit où l'on est serait étrange —
`openScene` sort tout seul pour elle.

**⚠️ `runExport(profileId)` contredisait l'intention de son propre appelant, et le paramètre est
parti.** `PackageDialog` écrit `active: activeId` sur disque **avant** d'exporter, et son commentaire
dit pourquoi : « a build must be reproducible from what is on disk, not from what happened to be typed
into a dialog that is about to close ». Puis il rejouait la valeur du dialogue par-dessus le fichier
qu'il venait d'écrire pour cette raison. Le main relit le projet et retombe sur
`settings.build.active`. **Le paramètre du canal IPC `build:export` n'a plus d'appelant** — laissé en
place, il touche quatre fichiers et la table de canaux vérifiée de T-047 ; inscrit dans `RESTES.md`.

**`unpackable` disparaît de `HierarchyPanel`.** Trois conditions recopiées dans le panneau, dont
`nodePath === ''` — un morceau de modèle déjà dépaqueté porte un `model` lui aussi et n'a plus rien
dedans à défaire. C'est le `can()` de la commande, et le menu filtre dessus. **Laissé absent plutôt
que grisé** : l'entrée ne s'applique presque à rien, et une ligne grisée sur chaque entité sans
modèle serait pire.

**Deux familles d'une seule commande** (`MODEL_COMMANDS`, `EXPORT_COMMANDS`). Un module chacune et non
une ligne dans une table voisine : c'est le module qui porte la propriété — une famille non *spread*
dans `registry.ts` disparaît de `CommandId` et ses appelants cessent de compiler.

**T-062d — ⚠️ la fiche annonçait cinq gestes ; un seul en était un.** Elle avait été écrite en listant
les *imports*, sans lire les signatures. Vérifié : `addEntity(template)` prend le template construit
au drop, `renameEntity(id, name)` le nom saisi, `reparentSelection(selection, parent, index)` la cible
d'un glisser-déposer, `addComponentWithDependencies(id, type)` le type choisi dans un menu. Fiche
corrigée sur place. **Une liste d'imports n'est pas un inventaire de gestes.**

**La frontière, corrigée et écrite en tête de `sceneCommands.ts`.** « Ce qu'un auteur peut demander
sans argument » était approximatif — `deleteAsset` prend une cible et est une commande. Le test est
**quel genre** d'argument :

- une **cible** (quelle entité, quel asset) : le contexte peut la porter, donc un menu, une touche ou
  une palette peut la fournir → commande ;
- une **valeur** (le nom tapé, le point du drop, le type choisi, le parent et l'index d'un glisser) :
  connue du seul appelant, rien d'autre ne pourrait la dispatcher → fonction, et une entrée de
  registre serait une enveloppe autour d'un seul site d'appel.

Écrite là plutôt que dans le commit : c'est le fichier où quelqu'un cherchera « pourquoi ceci n'est
pas dans le registre ».

**`toggleVisibility` entre, mono-entité.** Masquer toute une sélection demanderait **un seul**
`mutate` sur l'ensemble — boucler `setEntityVisible` écrirait une entrée d'undo par objet — et aucun
appelant ne le demande. Vérifié dans l'application : le bouton œil bascule et laisse une entrée,
« Hide entity ».

**⚠️ `setEntityLocked` n'a aucun appelant dans tout le dépôt, et aucun `.tsx` ne mentionne `locked`.**
Rien dans l'interface ne permet de verrouiller une entité — alors que le verrou **fonctionne**
partout ailleurs : `capabilitiesOf` refuse déplacement, suppression, reparentage et groupement à une
entité verrouillée, et `Selection.can` le lit. C'est l'inverse de `EntityDoc.chunk` (T-059) : un champ
que tout le monde lit et que personne n'écrit. **Non coupé** : la question « le verrou est-il une
fonctionnalité » n'appartient pas à la couche de commandes, et le couper ferait de `locked` un champ
non écrivable — donc un changement de format. Inscrit dans `RESTES.md`. La capacité `toggleLock`
existe déjà dans `core/scene/capabilities.ts` et n'est exercée par rien non plus.

**Une famille qui grossit ne casse pas le test de comptage** — seule une famille *nouvelle* le fait.
`toggleVisibility` est allé dans `EDIT_COMMANDS`, donc le compte a suivi tout seul.

**T-062c — l'exclusion écrite dans `registry.ts` était fausse, et la vérifier était la tâche.** Elle
disait que les entrées prefab étaient « decided in exactly one place ». Quatre gestes sont décidés
**deux fois** — menu contextuel de la hiérarchie *et* schéma d'Inspector du composant
`prefabInstance` — et les deux ne s'accordaient pas :

| | Hiérarchie | Inspector |
|---|---|---|
| Apply Overrides | grisé sans override | **bouton actif, clic sans effet** |
| Revert Overrides | grisé sans override | **bouton actif, clic sans effet** |
| Show in Project | grisé si le prefab manque | **actif, clic avalé** |
| Unpack · Select All Instances | grisé en multi-sélection | **aucun verdict** |

Contrairement à T-062b, cette tranche **corrige de vrais bugs**. La leçon vaut pour les suivantes :
l'exclusion motivée d'hier n'est pas une réponse d'aujourd'hui — la vérifier coûte un grep.

**⚠️ Il y avait deux façons de révéler un asset, et chacune faisait la moitié du travail.**
`revealAsset` vidait dossier et filtres et amenait le panneau devant, **sans jamais poser
`revealed`** — donc ni surlignage ni défilement vers l'asset. `assetStore.reveal` posait `revealed` et
**n'amenait pas le panneau devant** — depuis un onglet Project caché derrière un autre, le bouton ne
faisait rien de visible. Le geste appelle maintenant le store et n'ajoute que la moitié qui n'est pas
la sienne (`showPanel`), ce qui **supprime trois lignes qui en étaient une copie**. Personne ne
cherchait ce bug : il est tombé de la question « laquelle des deux la commande appelle-t-elle ? ».

**Le libellé porte le compte d'instances**, et c'est un gain gratuit du registre : la hiérarchie
affichait `Select All Instances (3)`, l'Inspector un `Select All Instances` nu. Un `label(ctx)` et les
deux l'ont.

**⚠️ Un bouton d'action de l'Inspector ne peut pas être *dessiné* grisé aujourd'hui.** Tweakpane le
construit une fois (`buildInspector:269`) et le pane n'est reconstruit que sur un changement de
**structure** (`inspectorSignature`). Tenir l'état activé à jour demanderait d'abonner l'Inspector à
chaque mutation — ce que T-057 a mesuré et refusé. Donc les boutons **refusent** mais **ont l'air
actifs** : la divergence de comportement est morte, celle d'apparence reste. Inscrit dans `RESTES.md`.

**`instantiatePrefab` n'entre pas dans le registre** : appelé avec le point où le drop a atterri, donc
mutation paramétrée. Même frontière que T-062d annonce pour `sceneCommands`.

**Un test de l'éditeur fabrique enfin une instance de prefab** — il n'y en avait aucun.
`createPrefabInstance` + `putComponent` + un `PrefabDoc` dans `assetStore.prefabs`, dont les
`components` doivent être des `emptyComponentTables()` complètes : un `{}` fait tomber `chainOf` sur
`Object.values(prefab.components.prefabInstance)`.

**T-062b — le bord de la règle est trouvé, et il est structurel.** `createFolder`, `renameFolder` et
`deleteFolder` **restent des fonctions**. `Command.run` revérifie `can()` et sort quand il refuse :
un refus n'a pas de valeur à rendre, donc `run` ne peut pas en rendre. Or les trois en rendent une et
`DestinationBrowser.tsx:253-265` la lit pour naviguer. **Un geste dont un appelant lit le résultat est
un appel de fonction, pas une commande** — une commande est lancée par un menu, une touche ou une
palette, dont aucune n'est en position de faire quoi que ce soit d'un retour. Inscrit dans
`RESTES.md` : à rouvrir quand la palette (8.4) voudra « New Folder ».

**La cible dans `EditorContext` est un `assetId`, pas une `AssetEntry`.** Le contexte se lit au moment
où il sert et ne se garde jamais — c'est déjà ce que dit son commentaire pour la sélection — donc une
entrée copiée dedans serait une copie qui peut périmer : le manifeste est reconstruit après chaque
mutation et une autre fenêtre peut supprimer le fichier. La commande résout l'id quand elle tourne,
ce qui donne aussi à `can()` de quoi répondre « cet asset n'est plus là ».

**⚠️ T-062b n'a supprimé aucune divergence, contrairement à T-062a, et il faut le savoir avant de
juger les tranches suivantes.** Les trois sites d'appel passaient déjà par une seule fonction et
n'écrivaient aucune garde. Ce que la table achète ici est ce pour quoi T-062 existe — un geste avec
un id, un libellé et un verdict est listable par une palette (8.4) et nommable par un script — pas un
bug corrigé. **T-062c doit se poser la même question pour les prefabs** : sa fiche le dit déjà.

**Ce qui a été gagné concrètement : une porte au lieu de deux.** `revealAsset` et `deleteAsset` ne
sont plus exportés. Une fonction publique à côté de sa commande est exactement le chemin qui contourne
`can()`.

**`revealAsset` amène le panneau Project devant, et ce n'est pas le jalon 8.5.** Celui-là vise
`playCommands`, qui pilote la disposition **par effet de bord** en démarrant le jeu. Ici, mettre le
panneau devant **est** le geste. Écrit dans `assetCommands.ts` pour que T-066 ne s'y arrête pas.

**Le test de comptage des familles est tombé en ajoutant les assets, et c'est son travail.** Il porte
la liste des familles ; une famille ajoutée au registre et pas à cette ligne fausse le compte. Il
vérifie aussi l'**identité** de chaque commande, parce que compter seul passerait si deux familles se
télescopaient pendant qu'une troisième grossit d'une unité dans le même commit.

**T-062 était une tâche à six commits ; elle est scindée en `T-062a` … `T-062f`.** Sa propre fiche
prescrivait « un commit par famille », et la règle du chantier veut qu'on scinde dans `tasks/` avant
de coder. T-062 reste comme **chapeau** et porte le tableau des six tranches. L'ordre n'est pas
a→f : **T-062f (le transport) passe après T-066**, parce que `startPlay` appelle `showPanel` et que
T-066 doit précisément l'en sortir — l'enregistrer avant, ce serait mettre dans le registre ce que la
tâche suivante doit en retirer.

**⚠️ La cible n'est pas « ~50 fonctions », c'est 30 gestes dans 12 `.tsx`.** Compté, pas estimé.
`commands/` exporte aussi des **questions** (`sceneList`, `instanceInfo`, `overridesOf`,
`componentFits`, `placedAt`), les maths de `transformSpace.ts`, et des **mutations paramétrées** que
seuls le gizmo et Tweakpane appellent — `setEnvironmentField('fogNear', 30)` n'a pas de `run(ctx)`, et
`transformSelection` est appelé soixante fois par seconde pendant un drag. La frontière est **« ce
qu'un auteur peut demander sans argument »**, pas « ce qui est dans `commands/` ».

**T-062a — `id` a disparu de la déclaration, et c'est la vraie soustraction.** La clé sous laquelle
une commande est rangée *est* son id : `CommandId = keyof typeof COMMANDS`. Le déclarer aussi dans le
spec aurait été la même chaîne à deux endroits, ce qui est exactement d'où la liste supprimée
revenait.

**⚠️ L'objection écrite dans `registry.ts` contre les familles en modules ne tient que pour un
registre rempli par effet de bord.** Elle disait : « a module nobody imports registers nothing, and
the command simply goes missing ». Vrai d'une `Map` remplie à l'import — et c'est ce que c'était. Une
**table composée par valeur** n'a pas ce mode : une famille absente du spread disparaît de
`CommandId`, et tout appelant qui nomme un de ses ids **cesse de compiler**. C'est plus strict que le
`throw` du registre de composants de `core`, qui n'a ce recours que parce que `COMPONENT_TYPES` est
une union canonique indépendante. Les commandes n'en ont pas — d'où l'union tirée de la table.

**Le seul mode d'échec qui reste est la collision d'ids entre deux familles**, où le dernier spread
gagne en silence. Un test compte les clés de `COMMANDS` contre la somme des familles. Cassé pour
vérifier : un `save` ajouté aux commandes de scène → `expected 13, got 12`.

**`commandById` est devenu total**, ce qui a retiré un `?.` à cinq appelants qui traitaient un cas que
le type interdisait déjà : l'argument est un `CommandId`, et un `CommandId` est une clé de la table
par construction.

**Trois divergences trouvées en chemin, dans `MenuBar`, et corrigées par le déplacement seul** :
`Duplicate Scene…` et `Rename Scene…` n'avaient **aucun** `disabled` alors que les deux gestes
s'ouvrent sur `if (sceneId === null) return` — le menu prenait le clic, ouvrait un dialogue et ne
faisait rien de la réponse. `Save Scene As…` pareil, avec `if (!summary) return`. Et `Delete Scene`
portait `scenes.length <= 1` dans le menu, pas dans le geste. C'est la divergence exacte que le
registre existe pour tuer, retrouvée sur une deuxième famille.

**⚠️ `setRenameHandler` n'a aucun appelant dans tout le dépôt** — vérifié sur `packages`, `apps` et
`test`. Donc `renameCommand.run()` ne fait jamais rien : `onRenameRequested` est toujours `undefined`,
et c'est `HierarchyPanel` qui appelle `setRenaming` de son côté. C'est le jalon 8.2 et **T-063, la
tâche suivante après T-062b** ; laissé exactement en l'état plutôt qu'à moitié réparé, avec la note
au point de déclaration.

**Le harnais a servi à lire un menu**, ce qu'aucun test ne peut faire ici faute de DOM (T-055) :
`[role="menu"] [role="menuitem"]`, libellé et `disabled`. **Deux pièges** — la barre de menus et le
titre de scène sont tous deux dans un `nav.app-no-drag`, donc le déclencheur du menu Scène est le
**dernier**, pas le premier ; et son libellé est le **nom de la scène**, pas « Scene ».

**T-061 — le gain de l'index est réel, vérifié par deux chemins, et T-019 se reproduit au chiffre
près.** Projet de référence de T-060 plus 3000 textures dans 30 dossiers. Relevé complet dans
`PERF-BASELINE.md` § *Le scan d'assets (T-061)*.

| | sans index | à chaud | un renommage |
|---|---|---|---|
| `scanAssets` seul (Node, hors Electron) | **391 · 428 · 441 · 514 ms** | **130 ms** | — |
| end-to-end depuis le renderer (IPC) | **819 – 1002 ms** | **196 – 199 ms** | **210 – 229 ms** |

T-019 annonçait 391 ms sans index et 111 ms à chaud : on retrouve 391 ms exactement, et 130 ms sur le
chaud. Rapport 3,2× sur l'analyse seule, 4,3× vu du renderer.

**⚠️ Le « Pourquoi » de la fiche T-061 était faux, et la fiche le dit maintenant.** Il affirmait que le
gain n'avait pas été mesuré ; T-019 l'avait mesuré et son tableau est plus haut dans ce fichier. La
tâche reste utile parce que son **titre** dit « vérifier » : une deuxième mesure, indépendante, sur un
autre projet et par un autre chemin. Ne pas s'arrêter sur un « Pourquoi » périmé quand le « Quoi » et
le titre décrivent un travail qui a encore un objet.

**Pas de défaut d'invalidation, et c'était la question de la tâche.** Le surcoût est exactement
proportionnel à ce qui a bougé : 1 clé → +4 ms, 100 clés (un dossier renommé) → +27 ms, 3000 clés
(tous les dossiers) → +620 ms. Linéaire sur trois ordres de grandeur. Un déplacement n'invalide qu'une
entrée : un `rename` ne touche ni la taille ni le `mtime` du sidecar, et l'index est indexé sur le
chemin — seule la clé change.

**⚠️ Le pont IPC coûte ~60 ms par analyse, soit 30 % du prix d'une mutation.** 196 ms end-to-end contre
130 ms pour l'analyse seule. `AssetManifest` fait **1 238 831 octets** pour 3000 assets et traverse la
frontière de processus **en entier, à chaque appel**. Pour situer : `structuredClone` du même objet
dans le renderer prend **4,4 ms**. La sérialisation d'Electron est plus d'un ordre de grandeur au-dessus
d'une copie en processus. Personne ne l'avait chiffré ; c'est maintenant le deuxième poste après
l'analyse elle-même.

**⚠️ Le jalon 7.2 du `PLAN.md` n'est pas atteint, et l'index n'y pouvait rien.** Il demandait que
« `scanAssets` cesse de reparcourir le disque à chaque mutation ». Il le reparcourt toujours — 6000
`stat`, 3000 objets de manifeste, 1,2 Mo poussés à travers l'IPC — il ne le *lit* plus. Trois fois
moins cher, et ce n'est pas la même phrase. Descendre plus bas demande de **ne pas analyser du tout** :
une mutation qui corrige le manifeste en place, ou une analyse ciblée. Inscrit dans `RESTES.md`.

**Le renderer ne peut pas mesurer une analyse sans index**, et c'est pour ça qu'il y a deux scripts.
L'index vit dans `.studio/`, aucun canal IPC ne l'atteint, et l'éditeur l'a déjà reconstruit quand le
script de setup démarre. `measure-assets.js` contourne en **invalidant** — renommer les 30 dossiers
fait manquer les 3000 clés — ce qui est un majorant, pas la même chose. `scan-direct.ts` prend le
vrai chiffre en appelant `scanAssets` depuis Node : aucun module du chemin d'analyse n'importe
`electron`, donc esbuild le bundle et node l'exécute. **C'est la seule façon d'isoler l'analyse du
pont, et sans cette isolation les 196 ms n'auraient dit sur quoi agir.**

**T-060 — le relevé est dans `docs/chantier/PERF-BASELINE.md`, et il a un point de départ chiffré
pour le reste du lot 7.** Scène de 3005 entités, M1 Pro, three 0.185.1, le 2026-09-06 : **11,0 ms en
édition, 20,1 ms en Play, 10,8 ms pour le jeu seul.** 9 010 appels de dessin, 17,3 M de triangles,
88,6 Mo de mémoire GPU en édition et 147,0 Mo en Play. Trois passages consécutifs donnent la même
médiane à 0,1 ms près. La scène n'est pas commitée — cinq mégaoctets de JSON généré ; la recette est
dans `baseline/make-scene.mjs`.

**⚠️ La vue *Scene* continue de dessiner pendant Play, et ça double la frame.** Dockview gare l'onglet
inactif **hors de l'écran à la taille de la fenêtre entière** au lieu de le replier, donc
`host.clientWidth` reste non nul et `Presentation.visible` reste vrai. 18 016 appels au lieu de 9 006.
Vérifié en détachant la vue dans le même passage : la frame retombe exactement sur le temps
d'édition. **T-060 mesure et ne corrige pas** — inscrit dans `RESTES.md`.

**⚠️ La disposition du dock persiste dans les données d'application, et elle est partagée par tous les
projets.** `DockLayout` écrit `layouts.json` à chaque changement de disposition, sans débat. Un script
de mesure qui fermait le panneau *Scene* a enregistré une disposition sans onglet *Scene*, et les deux
passages suivants sont morts sur « the viewport never appeared » — plus rien n'appelait
`acquireViewport()`. **Un script de harnais ne doit pas toucher à la disposition** : `measure.js`
détache la vue (`viewport.detachScene()`) et remet l'onglet au premier plan en sortant. La disposition
de travail a été réparée en rouvrant le panneau par l'API du dock, donc écrite par l'application
elle-même ; les six gabarits enregistrés n'ont jamais été touchés. Seul écart avec l'état d'origine :
l'onglet *Scene* est le second du groupe au lieu du premier.

**⚠️ Un onglet inactif n'a pas la taille d'un onglet actif, et la lecture d'édition bougeait de 1,5 ms
selon ce que le passage précédent avait laissé devant.** C'est la même cause que les deux notes
ci-dessus. `measure.js` épingle l'onglet *Scene* avant de mesurer quoi que ce soit ; sans cela, un
relevé mesure le passage d'avant.

**Trois choses que le relevé apprend et qu'aucune lecture de code ne donnait :**
- **Les accessoires sont dessinés trois fois par frame** — carte d'ombre 3 000, réflexion de l'eau
  3 004, passe couleur 3 006. Une nappe d'eau re-rend le champ entier depuis une caméra miroir : c'est
  le poste le plus cher d'une grande scène.
- **« Draw calls » ne veut pas dire soumissions.** Pour un `BatchedMesh`, `WebGPUBackend.js:1832`
  appelle `info.update` une fois **par entrée du multi-draw**. Le chiffre est « instances × passes » ;
  les soumissions réelles sont les 36 lots.
- **Appuyer sur Play coûte 55,7 Mo de GPU en plus** : le moteur construit son propre binder, ses
  propres lots, sa propre capture de ciel et sa propre cible de réflexion, et le viewport ne lâche
  rien. Textures 84 → 163, géométries 54 → 105, cibles de rendu 5 → 9.

**T-056 confirmé sur une autre scène** : `_multiDrawCount` = `_instanceInfo.length` = 3000. Le culling
par instance ne cull rien dès qu'une lumière projette une ombre, et tout projet neuf en porte une.

**Les pools tiennent 8 géométries et 0 matériau, et ce n'est pas une anomalie.**
`ResourceArena.materials` pool les **assets** de matériau ; 3 000 accessoires à matériau en ligne
(`materialId: null`) n'en remplissent aucun.

**T-059 — retirer une *déclaration* n'est pas retirer un champ du format, et ça change la lecture de
la règle.** `migrateScene` remplit **sur place** (`const scene = input as SceneDoc`, puis on n'ajoute
que ce qui manque) et `serializeScene` est `stableJson(scene)`. Donc une scène qui porte un champ que
ce build ne connaît pas le garde à la lecture **et** à la réécriture. `chunk` est parti du type ; il
survivrait dans un fichier qui en aurait un.

**La moitié de la règle que rien ne tenait est maintenant tenue.** Les tests de `sceneMigration`
couvraient le *remplissage* (« un champ ajouté depuis arrive rempli ») et pas la *conservation*
(« laissez les données non reconnues exactement telles qu'elles ont été trouvées »). Un test prend
`chunk` pour sujet, ce qui est le cas exact que la règle vise. Cassé pour vérifier : reconstruire
l'entité depuis sa fabrique au lieu de la remplir sur place → rouge.

**T-058 — les trois combats contre three tiennent encore, vérifiés contre `dev` le 2026-09-06.** La
garde `FBXLoader` est toujours absente en amont **des deux côtés** (l'appelant *et* `parseNormals`, qui
lit `NormalNode.Normals.a` sans garde) ; `Node.onUpdate` est toujours une case assignée, pas une liste ;
et les quatre paramètres de `WaterMesh` sont toujours hors d'atteinte après construction. Les trois
fichiers portent la date et ce qui a été comparé.

**⚠️ Un résumé de code amont se vérifie en demandant les lignes.** La première lecture de `dev`
affirmait que `parseNormals` faisait la vérification. C'est faux. Demander le corps entier de la
méthode l'a montré.

**⚠️ `patch-package` tolère un préambule en texte libre** avant le `diff --git` — vérifié en retirant
la garde de `node_modules` puis en relançant : `three@0.185.1 ✔`, garde revenue. Un préambule qui
casse l'application ferait disparaître la garde au prochain `npm install`, sans bruit : ne pas
l'ajouter sans ce test.

**Rien n'a été remonté chez three : décision de l'auteur.** Publier sur le tracker d'un tiers se fait
sous son compte. Inscrit dans `RESTES.md`.

**Un registre est né : `RESTES.md`.** Une ligne par chose qu'une tâche aurait pu faire et n'a pas
faite, avec ce qui la rouvrirait. La boucle du `README.md` a une étape de plus pour l'alimenter, et la
règle « une pièce sans appelant, on la coupe et on le note » a maintenant une adresse. **Ce qui reste
dans ce fichier à la fin du chantier est la réponse à « qu'est-ce qui n'a pas été fait ».** Onze
lignes au moment où il est créé, remontant jusqu'à T-006.

**T-057 — la tâche demandait un abonnement ; les trois fichiers concernés expliquent, au point
d'appel, pourquoi il ne faut pas le poser.** Abonner un composant à l'expansion le fait re-rendre à
chaque changement de `scene`, donc à chaque frame d'un drag. `HierarchyPanel` (422 ms/nudge),
`InspectorPanel` (« un cube glissé rafraîchissait l'Inspector d'un autre, 60 fois par seconde ») et
`MenuBar` s'abonnent chacun à plus étroit, exprès. `derived.ts` disait déjà la même chose et
renonçait. **Non fait, inscrit dans `RESTES.md`.**

**Ce qui a été fait, c'est l'autre branche que la tâche offrait** : `derived.ts` disparaît. 60 lignes
de primitive générique à un seul appelant, plus son test, contre dix lignes de comparaison nommée dans
`expansion.ts`. Les deux propriétés que le test tenait sont passées sur la vraie chose et vérifiées en
les cassant.

**⚠️ Les lectures pendant le rendu ne sont pas des lectures périmées.** Un composant n'y arrive qu'en
rendant, et il rend parce que quelque chose auquel il *est* abonné a bougé ; la mémo rend alors la
valeur la plus fraîche. Le danger existe en principe et est vide pour ces quatre-là. Ne pas
« corriger » ça sans mesurer d'abord.

**T-056 — la question est fermée, pas résolue, et c'était la bonne issue.** Le culling par instance ne
peut pas revenir tant qu'une ombre se rend. Mesuré : 3600 sphères, 11 M de triangles, un soleil ombré
— tel que livré 3600/3600 dessinés à 11,7 ms ; culling forcé **30**/3600 à 8,2 ms. La frame est plus
rapide parce que la scène a disparu. B15 n'a pas été corrigé depuis.

**⚠️ Le mécanisme, et il n'était écrit nulle part** : sous WebGPU la carte d'ombre n'est pas une passe
qui précède la frame. `ShadowNode.updateBefore` appelle `renderer.render(scene, shadow.camera)`
**depuis l'intérieur** de la mise à jour de nœuds d'un matériau éclairé — donc dans
`Renderer.renderObject`, *après* le `onBeforeRender` de l'objet et *avant* l'encodage de son draw. Un
`BatchedMesh` n'a qu'une liste multi-draw : le rendu d'ombre imbriqué l'écrase entre les deux.
`onBeforeShadow` existe pour ça et n'est appelé que par `WebGLShadowMap`. **Il n'y a aucune couture
où intervenir.**

**La piste réelle, mesurée et laissée** : `rendering.shadows` à faux → aucun nœud d'ombre, culling
correct (3120/3600), **et 8,4 ms des deux côtés** — le vsync 120 Hz. Gain nul ici. Le prendre
coûterait un couplage du batcher à l'état d'ombre du *renderer*. À rouvrir sur un champ qui rate le
vsync, pas avant.

**À savoir pour la suite du lot 7** : tout projet neuf porte un soleil `castShadow`, donc
`shadowCasters.size === 0` n'est jamais vrai par défaut — le culling par instance du batcher est
aujourd'hui une capacité que presque aucune scène n'exerce.

**⚠️ `renderProbe` ne mesure pas la performance de rendu.** La tâche y renvoyait ; c'est en fait un
compteur d'erreurs « Destroyed texture ». Pour du temps de frame, la recette est dans la compétence
`smoke-harness` (boucle rAF, médiane et p95, dans **un seul passage** — les comparaisons entre
passages sont bruitées). Et `__studioViewport.scene` / `.camera` donnent la prise sur les
`BatchedMesh` (`_multiDrawCount` contre `_instanceInfo.length` dit si le culling cull).

**Le message de commit prescrit affirmait un correctif qui n'a pas eu lieu**, et a été remplacé.
C'est un cas à connaître : la ligne `## Commit` d'une tâche est une prédiction, pas une obligation.

**T-055 — ⚠️ l'environnement DOM n'a pas été ajouté, et c'est une décision à connaître avant de
reprendre.** Les trois décisions que la tâche invoquait pour le justifier ne sont plus dans un
`.tsx` : `buildRows` (extrait en `hierarchyRows.ts`, testé) et la mémoïsation de l'Inspector
(`inspectorSignature.test.ts`, 9 cas) l'ont été par des tâches antérieures, et le windowing vient de
l'être. Il ne restait **aucun test DOM à écrire** — jsdom plus `@testing-library` auraient été deux
dépendances et une seconde configuration sans appelant, ce que le chantier interdit. C'est ce que la
tâche prédit elle-même en pointant `overlay.test.ts` : **la frontière est qu'une décision sorte du
`.tsx`**, pas qu'un test apprenne à rendre du `.tsx`.

**« `ROW_HEIGHT` ne peut plus diverger de sa classe CSS » n'a pas été obtenu par un test, mais par
une soustraction.** Aucun test ne peut lier `24` à `h-6` : jsdom n'applique pas Tailwind, et une
assertion `expect(ROW_HEIGHT).toBe(24)` ne serait que la constante répétée. La ligne prend
maintenant sa hauteur de la constante, et il n'y a plus de seconde formulation. Vérifié dans
l'application : chaque ligne mesure 24 px, comme avant.

**`h-6` valait bien 24 px** — `1.5rem`, et le `font-size: 0.8125rem` du dépôt est sur `body`, pas sur
la racine, donc `rem` reste à 16 px. La substitution ne corrige rien : elle supprime une duplication.

**Le harnais sait mesurer le DOM rendu**, ce qui en fait le seul instrument capable de vérifier ce
genre de chose : `getBoundingClientRect().height` sur les lignes de la hiérarchie, via
`STUDIO_SMOKE_SETUP`. Le compte de nœuds (734) est resté identique au passage précédent, ce qui dit
que rien d'autre n'a bougé.

**Reste comme décision dans un `.tsx`, si on veut y revenir** : « le quart supérieur d'une ligne veut
dire *entre deux lignes* » (`HierarchyPanel:455`) et la sélection par plage de `onRowClick`. Les deux
s'extraient pareil, aucune ne demande de DOM.

**T-054 — la tâche demandait deux fonctions testées ; les tester *à travers* leur composition en a
révélé une troisième chose.** `argValue` et `queryValue` restent privées ; `windowIdentity(argv,
search)` est la seule question que le preload leur pose. Les exporter séparément aurait laissé le
défaut hors des tests : `(argValue('studio-role') ?? 'launcher') as WindowRole` ne rattrapait qu'un
rôle **absent**, et `Root.tsx` demande `=== 'launcher'` — donc toute autre chaîne, faute de frappe
comprise, ouvrait le shell **éditeur**, exactement la moitié irrécupérable que le commentaire d'à
côté décrivait.

**⚠️ `in` remonte la chaîne de prototypes.** Écrit `role in WINDOW_ROLES` d'abord, et
`--studio-role=toString` répondait oui. `Object.hasOwn`. C'est la deuxième fois du chantier que ce
piège se présente (voir `conformPatch` en T-048, où il est inoffensif parce que les clés viennent du
*modèle*) : ici la valeur est le côté non fiable, donc `in` était faux.

**Le harnais a servi à prouver la lecture de la query sans pouvoir piloter la fenêtre concernée.**
La seconde fenêtre n'est pas pilotable, mais elle est ouverte sur `?scene=<id>` et son id survit
jusqu'à la ligne de fermeture — si son preload avait lu `null`, `project.open` aurait rendu la scène
de départ et `noteScene` aurait écrasé l'entrée. Une trace du processus principal peut prouver une
lecture faite dans un renderer, à condition de trouver le chemin par lequel elle y revient.

**T-053 — la forme qui a rendu la couture indolore : des fonctions génériques sur l'entrée.**
`planOpenEditor<T extends OpenScene>(editors: readonly T[], …)` rend `{ do: 'focus', entry: T }` —
donc `windows.ts` récupère **son propre** `Editor`, fenêtre comprise, sans re-recherche et sans `!`,
pendant qu'un test passe trois champs nus. Un plan portant un `contentsId` aurait forcé une
re-recherche et une branche morte à chaque appel.

**`closeAllEditors` n'a pas eu de couture, parce que sa règle *est* `Array.every`** : s'arrêter à la
première fenêtre encore là. Réécrite comme telle, elle tient en une ligne et se lit. Inventer un
`closeEach(entries, close)` aurait été réimplémenter une primitive pour pouvoir la tester.

**Une différence de comportement évitée de justesse** : `process.env['STUDIO_SMOKE']` était lu par
**truthiness** partout ; ma première version testait `!== undefined`, ce qui fait de `STUDIO_SMOKE=`
(un shell qui dit « pas ce coup-ci ») un contournement de l'invite. Corrigé en `Boolean(...)`.

**Vérifié dans l'application réelle, et ça valait le coup** : `openSceneWindow` sur une scène non
ouverte → seconde fenêtre ; deux fois sur la même → pas de troisième ; sur sa propre scène → rien.
Puis `launch` d'un autre projet → les deux fenêtres se ferment dans l'ordre, sans launcher entre
elles. `renderer errors: none`, zéro orphelin. Deux projets jetables fabriqués dans le scratchpad
en appelant `createProject` depuis un test throwaway — plus simple que d'en copier un vrai.

**⚠️ Le harnais meurt avec la fenêtre qu'il pilote**, et c'est la seule pilotable. Un setup qui
appelle `launch` détruit sa propre page : le harnais rejette (`Object has been destroyed`), appelle
`beginQuit()` et `app.exit(1)` **au milieu** de `closeAllEditors`. Donc la fenêtre construite *après*
un changement de projet réussi, et le retour au launcher à la fermeture du dernier éditeur, ne sont
pas observables par là. Ce n'est pas un bug du produit — le log le montre ligne par ligne.

**T-052 — ce que « zéro test » cachait n'était pas les 45 délégations.** Chaque module derrière elles
est testé. Ce qui ne l'était pas, c'est la poignée de règles que le fichier gardait pour lui : le bac
à sable du projet, un jeton de capacité, et les drapeaux « non sauvé » par fenêtre. Les trois vivaient
derrière `import { ipcMain } from 'electron'`.

**Trois extractions, chacune dans le module qui possède la chose.** `session.ts` (le projet ouvert,
le travail non sauvé par fenêtre, les dossiers que ce run a écrits — **aucun import, donc les règles
tournent seules**), `requireBuildProfile` dans `exportWeb.ts` (qui se tenait déjà hors d'Electron, et
le dit dans son commentaire sur `searchRoots`), et `importSessions.commit()` (la recherche, le refus
et le `finally`). Un fourre-tour « handlers.ts » aurait été plus rapide et faux.

**Duplication trouvée au passage** : `protocol.ts` tenait sa propre copie du chemin du projet ouvert,
mise à jour à la main par `setCurrentProject` depuis `ipc.ts`. Un fait, deux copies, tenues en phase
à la main. `setCurrentProject` a disparu.

**Effet de bord agréable** : `windows.ts` lisait `isDirty` depuis `ipc.ts`, ce qui était la raison
invoquée pour `IpcDeps`. Cette raison-là est morte (les deux lisent `session.ts` maintenant) mais
**`IpcDeps` reste** : ce qu'une fenêtre fait quand une scène change sous elle est une politique à
elle, et les handlers doivent la demander plutôt que la contenir. Le commentaire dit la nouvelle
raison, pas l'ancienne.

**Les quatre garanties vérifiées en les cassant** : `requireProject` rendant `''` → 2 rouges ;
`wasExported` écrit en `startsWith` → 1 rouge (le parent d'un dossier de build est en général le
répertoire personnel de quelqu'un) ; `finally` retiré de `commit` → 1 rouge.

**Reste dans `ipc.ts`, exprès** : `announce()` — la diffusion aux autres fenêtres est la moitié
Electron, c'est ce pour quoi le fichier existe. Et le refus de `deleteScene`, qui s'appuie sur
`deps.isSceneOpenElsewhere` : la décision appartient à `windows.ts`, donc à **T-053**.

**T-051 — le modèle était déjà dans le dépôt, à côté.** `IMPORT_SCHEME` / `IMPORT_HOST` /
`importPreviewUrl` vivent dans `core` depuis leur écriture. `studio-asset`, plus ancien, ne l'avait
jamais eu : constante côté main, littéral trois fois côté renderer, six fois de plus dans le CSP.
`core/src/assets/url.ts` est le même arrangement pour l'ancien.

**Trois des cinq listes étaient déjà réglées ou presque.** Le `.scene.json` a une source depuis le
lot 9 — il restait *un* littéral (`DEFAULT_SCENE_PATH`). Les extensions de modèle et de texture
étaient de vraies copies, mais leur dérivation était triviale et les ensembles se sont avérés
identiques (vérifié : `{fbx,glb,gltf,obj}` et `{exr,hdr,jpeg,jpg,ktx2,png,webp}`). **Les numéros de
ligne des tâches tardives sont périmés ; le fond, lui, tient.**

**⚠️ `ASSET_KIND_INFO.<kind>.extensions` n'est pas seulement `importer.extensions`** : `buildKindInfo`
y ajoute aussi la dernière extension de chaque `suffix` déclaré, pour qu'un `.prefab.json` soit
offert par un sélecteur de fichiers. Seuls les importeurs `prefab` et `material` déclarent des
suffixes, donc `model` et `texture` sont inchangés — mais c'est exactement le genre de détail qui
transforme une dérivation en régression silencieuse, et il a été vérifié avant, pas après.

**Le CSP a été vérifié en l'évaluant hors du bundle construit**, avant et après : identique octet pour
octet. Aucun test ne couvre `security.ts`, et un CSP qui refuse un schéma est chaque texture du projet
qui ne charge pas, avec la raison dans une console que personne n'a ouverte.

**Ce qui n'a pas été touché** : le `.jpg`/`.jpeg` de `sniffTextureEncoding`. Ce n'est pas une copie
d'une liste mais un énoncé sur **un** format, commenté sur place. En faire une constante partagée
serait un export à un seul appelant — ce que le chantier interdit.

**`PREVIEWABLE_EXTENSIONS`** perd `gif` et `avif` et rien d'autre : la divergence avec les importeurs
est délibérée et expliquée, mais une liste d'autorisation ne peut pas nommer ce que le projet ne peut
pas contenir sans cesser de dire laquelle des deux choses elle est.

**T-050 — la particularité n'a pas été admise, elle est devenue la règle.** La tâche disait de garder
le nom temporaire suffixé par un id d'`assets.ts` « plutôt que de la perdre ». Le garder comme cas
particulier voulait dire un paramètre que personne n'aurait passé différemment. Il est donc partout :
rien n'a jamais eu besoin d'un nom prévisible. Ce que ça coûte est réel et écrit dans le module — un
processus tué en pleine écriture laisse un orphelin au lieu d'un fichier que la prochaine écriture
aurait remplacé. Inerte : ni `scanAssets` ni `discoverScenes` ne réclame un `.tmp`.

**Six sites, pas cinq.** `projectIndex.ts` est arrivé après l'audit (T-019). Les numéros de ligne des
tâches tardives sont périmés par construction — le fichier `assets.ts` que T-050 cite n'existe plus
depuis T-045. Chercher le motif, pas la ligne.

**Un seul comportement d'erreur, et les deux avaleurs restent visibles.** `atomicWrite` nettoie et
relance. `preferences.ts` et `projectIndex.ts` avalent chez eux, chacun avec la phrase qui dit
pourquoi — une disposition qui ne se sauve pas et un cache qui ne s'écrit pas ne valent pas un échec.
Mettre ça dans le module aurait demandé un drapeau, et un drapeau cache une politique.

**`safeFileName` va dans `core`, et la raison est l'éditeur.** L'éditeur *valide* un nom avant de
l'envoyer, le processus principal le *réécrit* après. Deux réponses à « est-ce un nom de fichier »,
c'est ainsi qu'un dialogue accepte ce que le disque change ensuite en silence. `core` est le seul
endroit que les deux voient.

**⚠️ Un caractère interdit est *remplacé*, pas supprimé.** Donc `safeFileName('///')` vaut `'---'` et
non `''` — seul un nom fait d'espaces et de points revient vide. Écrit d'abord faux dans le
commentaire *et* dans le test, et rattrapé par le test qui a échoué. Le commentaire aurait menti.

**Une regex globale porte `lastIndex` d'un appel à l'autre**, donc `.test()` sur elle répond vrai,
puis faux, puis vrai sur la même entrée. `FORBIDDEN_FILE_NAME_CHARS` est non-globale pour les
validateurs ; la version globale du même jeu de caractères est privée au module.

**Deux exceptions gardées, chacune avec sa ligne** : `claimAssetMeta` finit par un `link` et non un
`rename` — remplacer est exactement ce qu'il ne doit pas faire — et `createScript` assainit plus dur
(`/[^A-Za-z0-9_]/`), parce que le nom est aussi le nom de classe dans le template qu'il écrit.

**T-049 — la dérive n'était pas hypothétique, elle était déjà là, et dans les deux sens.**
`scenes` et `onSceneUnload` existaient sur `Behaviour`, étaient dans `RESERVED_PROPERTY_NAMES`, et
n'étaient publiés nulle part : l'éditeur de l'auteur lui disait qu'un hook de cycle de vie documenté
et toute l'API de transition de scène n'existaient pas. Et le vocabulaire de propriétés avait perdu
`vec2` entièrement, plus les `min`/`max`/`step` de `vec3`.

**Les noms se dérivent ; les types se vérifient. Ce sont deux mécanismes différents et il en fallait
deux.** `keyof Behaviour` donne les noms — un `Record<keyof Behaviour | ProtectedMember, true>` est
total dans les deux sens, donc `RESERVED_PROPERTY_NAMES` en tombe et la table du `.d.ts` côté desktop
est keyée dessus. Ajouter un hook casse **la compilation aux deux endroits** (vérifié en ajoutant
`onCollide?()`). Mais un `Record` ne dit rien des *signatures*, et TS 7 n'a pas d'API JS pour les
émettre : c'est le repli de la tâche qui s'applique, un test qui lance `tsc` sur une sonde.

**⚠️ `keyof` ne voit pas les membres protégés.** Les quatre helpers (`resolve`, `log`, `wait`,
`repeat`) sont écrits à la main dans `ProtectedMember`, et c'est la seule liste qui reste. Corollaire
qui a mordu dans la sonde : **une classe portant un membre protégé n'est assignable que depuis une
sous-classe**, donc les deux `Behaviour` ne peuvent pas être comparés entiers — la sonde compare
`PublicPart<T> = { [K in keyof T]: T[K] }`, qui laisse les protégés dehors.

**La sonde ne peut pas passer à vide, et c'est délibéré.** Elle importe `StudioInput` et
`StudioAudio` de `'@three-studio/runtime'` — des noms qui n'existent que dans le `.d.ts` généré. Si
la résolution attrapait un jour le vrai paquet, la sonde ne compilerait pas au lieu de passer sur
rien. Elle vit dans un `mkdtemp`, d'où aucun `node_modules` n'est visible en remontant.

**Le sens de la vérification est « le vrai doit satisfaire le publié », pas l'inverse.** Le
rétrécissement est voulu — `Object3D` devient `any`, un `EntityDoc` devient les deux champs qu'un
script en lit — donc exiger l'égalité échouerait sur tout. `AudioBus` est la seule chose vérifiée
dans les deux sens : c'est une union fermée des deux côtés.

**Coût mesuré : 0,26 s** pour le `tsc` de la sonde (compilateur natif). La suite passe de 4,2 à
4,3 s.

**Type-only, et vérifié dans le bundle.** `scripts.ts` importe `BehaviourMember` du runtime — la
règle des couches l'autorise (app est la couche haute) et `verbatimModuleSyntax` l'efface. Vérifié
en construisant : `out/main/index.js` ne contient ni `three/webgpu`, ni `Object3D`, ni
`WebGPURenderer`.

**T-048 — la validation existait déjà dans l'arbre de travail ; il y manquait le chemin d'import.**
Une session précédente avait écrit `core/src/guards.ts` et ses tests sans les commiter. Le code était
bon et il est gardé tel quel ; deux trous ont été trouvés en le vérifiant, et les deux étaient réels.

**`conform` contre `fillComponent`, et la différence est *qui a écrit les données*.** `fillComponent`
garde ce qu'il ne reconnaît pas — une scène sur le disque a été écrite par une version de cet éditeur
et ses champs inconnus sont le travail de quelqu'un. `conform` les **jette** : ce qui arrive ici vient
d'un renderer livré dans le même binaire que le modèle, et rien de ce qu'il envoie n'a été écrit par
une version plus récente. C'est pour la même raison que `savePrefab` passe par `migratePrefab` et non
par `conform` : un prefab a fait l'aller-retour par le disque, et le conformer perdrait un type de
composant que ce build ne connaît pas.

**Le modèle *est* le schéma.** Chaque valeur qui traverse a déjà une fabrique, et une fabrique est un
exemple complet et correct de son propre type qui ne peut pas se désynchroniser de lui. Aucune
dépendance ajoutée, et `core` reste sans dépendance (T-004 le vérifie).

**Trou n° 1 — le plan d'import écrivait son `kind` dans le sidecar.** `ImportPipeline.run` recopiait
`item.settings` tel quel. Un `.fbx` dont le plan disait `texture` était écrit comme une texture, et
chaque lecture ultérieure le croyait. Vérifié en rouge avant le correctif :
`expected { kind: 'texture', … } to match object { kind: 'model', scale: 1 }`. Le `kind` vient
maintenant de l'importeur qui a réclamé la **source**, jamais de la charge — la même règle que
`updateAssetSettings`, où il vient du sidecar.

**Trou n° 2 — `Object.entries` parcourt une chaîne caractère par caractère.**
`conformBuildProfiles` marchait sur `given.profiles` sans vérifier que c'en était une table :
`profiles: 'oops'` frappait quatre profils, un par caractère, chacun une copie du modèle sous les ids
`0`…`3`, et ça atterrissait dans `project.json`. Une table est un objet, et il fallait l'écrire.

**Ce qui est vérifié par un test qui touche le disque, et ce qui ne l'est pas.** Deux des cinq
charges le sont de bout en bout — le plan d'import et `updateAssetSettings` — parce que leur garde est
posée dans le module qui écrit, là où le `kind` est connu. Les trois autres (`conformSettingsPatch`,
`conformMaterial`, `conformLayoutPreferences`) sont appelées depuis `ipc.ts`, qui a besoin d'Electron :
les gardes sont testées, le câblage ne l'est pas. **C'est exactement l'objet de T-052** (« handlers IPC
extraits en fonctions pures et testés sans Electron ») ; ne pas le pré-empter ici.

**L'instrument a été vérifié en le cassant**, une fois de plus : en remplaçant le `conformAssetSettings`
d'`assetScan.ts` par `settings`, le nouveau test passe au rouge. Un test vert posé sur un câblage qu'on
n'a pas essayé de casser ne dit rien.

**Ce qui n'est pas validé, et pourquoi.** `project:saveScene` écrit une **chaîne** arbitraire dans un
`.scene.json`. Ce n'est pas un oubli : la scène est le document du renderer, elle traverse déjà
`migrateScene` à la lecture, et la conformer à l'écriture jetterait le travail de l'auteur — la règle
« laisser intact ce qu'on ne reconnaît pas » s'applique là, pas celle-ci. Les champs `folder` et
`fileName` d'un `ImportPlanItem` non plus : un non-string y fait lever `posix.join` avant toute
écriture, et `resolveInside` couvre l'évasion de chemin. Un refus reste un refus.

**T-047 — le *type* du pont était déjà dans `core` ; c'est le *câblage* qui ne l'était pas.**
`IPC_INVOKE` est désormais le seul endroit où un nom de canal est écrit, et `BridgeHandlers` est une
table **totale** de `StudioBridge` vers ce que le processus principal lui doit. `ipc.ts` est une table
au lieu de quarante-quatre appels `ipcMain.handle`, enregistrée en la parcourant.

**⚠️ Le piège de typage, et il vaut la peine d'être retenu.** La façon évidente de sélectionner les
namespaces — `StudioBridge[K] extends Record<string, …>` — n'en sélectionne **aucun** : une
`interface` n'a pas de signature d'index implicite (un `type` en a une). Tous les types mappés
s'effondrent alors en `{}`, et **toutes les vérifications passent à vide**. Écrit comme ça d'abord,
et découvert en supprimant un canal et en regardant la compilation rester verte. Le filtre est
maintenant une **exclusion** (`Omit<StudioBridge, 'platform' | …>`), ce qui fait qu'un membre ajouté
au pont est présumé être une API tant que personne ne dit le contraire.

**Les deux moitiés vérifiées en les cassant** : supprimer `project:close` de la table de canaux →
`Property 'close' is missing` ; supprimer le handler `listRecent` → `Property 'listRecent' is
missing`. Un zéro obtenu d'un instrument mort ressemblant exactement à un zéro obtenu d'une garantie
qui marche — deuxième fois cette session (voir T-046) — la vérification n'est pas facultative.

**Les quatre membres qui ne traversent pas en appel/réponse restent écrits à la main**, et c'est
`Invocable` (« tout ce qui rend une promesse ») qui les exclut : `setDirty` dit sans demander,
`onProjectChanged` et `onProgress` sont des abonnements, `pathForFile` ne quitte jamais le renderer.
`windowRole`/`projectPath` sortent toujours d'argv et `sceneId` de la query string.

**Ce qui n'a pas été fait, et pourquoi** : les annotations de types que chaque handler porte encore
(`(_event, projectPath: string): Promise<void>`). Elles sont maintenant **vérifiées** contre le pont
— une annotation fausse ne compile plus — donc elles ne peuvent plus diverger. Les retirer des
quarante-quatre est cosmétique et se ferait au régex ; le gain de la tâche était qu'elles cessent
d'être une seconde source de vérité, et il est acquis.

**Vérifié dans l'éditeur qui tourne** : onze appels couvrant les cinq namespaces, dont un qui crée une
scène et deux qui écrivent des dossiers. Aucune erreur renderer. Zéro comment perdu dans la
restructuration de `ipc.ts` (vérifié en comparant les lignes de commentaire avant/après).

**T-046 — 741 → 281, et le dernier abonnement global du dépôt est parti.** Onze sélecteurs, un par
champ affiché. Ce qui réveillait le panneau pour rien : `revision`, `loading`, et les tables de
matériaux et de prefabs, dont il ne dessine rien.

**`memo` et « pas de callbacks » vont ensemble, et c'est le point.** Une tuile à qui l'on passe
`onOpen={() => store.setFolder(path)}` reçoit une **fonction neuve à chaque rendu du panneau** — donc
à chaque frappe dans la recherche — et `memo` compare alors deux fonctions différentes et re-rend
quand même. Les tuiles vont chercher le store elles-mêmes ; c'est ce qui rend le memo réel.

**Mesuré, quarante textures et un compteur temporaire dans la tuile** :

| | |
|---|---|
| arrivée | 40 tuiles, 40 rendus |
| le filtre change, les 40 restent | **0 rendu** |
| un `revealed` bascule | **1 rendu** — contre **40** avant ce commit |

La dernière ligne est l'avant/après sur le même instrument : un champ du panneau re-rendait **toute**
la grille et n'en re-rend plus que la tuile dont les props ont bougé. Le compteur est retiré ; ce qui
tient, c'est le `memo`.

**⚠️ La première sonde ne mesurait rien, et il a fallu s'en apercevoir.** Taper dans le champ via un
`PointerEvent`… non : via le setter natif de `HTMLInputElement` plus un événement `input` synthétique
donnait **0 rendu même sans `memo`** — l'événement n'atteignait pas `onChange`. Un zéro obtenu d'un
instrument mort ressemble exactement à un zéro obtenu d'une optimisation qui marche. Le témoin
(`revealed`, qui *doit* toucher une tuile) est ce qui l'a démasqué, et la mesure finale passe par
`setQuery` sur le store.

**`KIND_FILTERS` avait perdu `prefab`** — une liste de paires, donc rien ne pouvait le dire, et les
prefabs étaient infiltrables. Il sort d'un `Record<AssetKind, string>` maintenant. **Prefabs** est
visible dans la barre de filtres sur la capture du harnais.

**⚠️ `HierarchyPanel.tsx` porte cinq imports morts** (`EntityDoc`, `ExpandedScene`,
`createPrefabVariant`, `Row`, `usePrefabModeStore`), trouvés par le même
`tsc --noEmit --noUnusedLocals` que T-045. Hors périmètre ici, mais c'est la quatrième fois.

**T-045 — 856 lignes → quatre modules.** `assetScan` 385, `assetLibraries` 233, `assetMutations` 210,
`assetFiles` 74.

**Les deux lignes de partage, écrites en tête de chaque fichier.** Entre `assetScan` et
`assetMutations` : est-ce qu'on **lit un sidecar pour décider quoi faire**. Entre `assetLibraries` et
le reste : est-ce que le fichier est **un document à nous** — un matériau ou un prefab a une version
de format, une migration à la lecture, et une écriture qui doit garder l'empreinte du sidecar en phase
avec les octets.

**`assets.ts` a disparu plutôt que de devenir un tonneau.** La fiche dit « les quatre consommateurs
importent la même chose qu'avant » ; il y en a **six** (plus six fichiers de test), et ils importent
les mêmes noms depuis le module qui les porte. Un `assets.ts` qui ne ferait que ré-exporter aurait
gardé la fiction du module unique que la tâche démonte.

**`claimAssetMeta` intact** — le compare-and-swap par `link()`, le chemin `EEXIST` et le repli
exFAT/réseau. `upgradeContracts.test.ts` vérifie toujours que **trois scans concurrents s'accordent sur
un id**, et il passe. La seule modification apportée à un fichier de test, tous fichiers confondus, est
un chemin d'import.

**⚠️ Troisième fois que `noUnusedLocals` éteint coûte quelque chose.** Les quatre modules sont partis
avec la liste d'imports complète de l'original ; les élaguer a demandé de lancer
`npx tsc --noEmit --noUnusedLocals` à la main et de filtrer sur les quatre fichiers. Ça marche très
bien comme outil ponctuel — c'est l'argument pour l'allumer, et l'argument contre est le bruit qu'il
ferait ailleurs dans le dépôt. À trancher un jour ; noté ici pour la troisième fois.

**T-044 — 704 → 404, plus `history.ts` 144 et `revisionLog.ts` 228.** Les trois métiers ne se
rencontraient qu'à un seul endroit : `mutate`.

**La ligne passe à « qu'est-ce qui a besoin du store ».** `history.ts` garde tout ce qui se décide
sans y toucher : ce qu'est une action utilisateur, quand deux éditions sont un seul geste, comment un
drag de six cents patches devient une entrée. **Appliquer** une entrée reste au store, parce que c'est
là que sont la scène et la sélection. `pushEdit` remplace vingt-huit lignes de coalescence écrites à
la main dans `mutate`.

**⚠️ `past`/`future` ne pouvaient pas sortir du store, et c'est ce qui a décidé la forme.**
`selectCanUndo` lit `state.past.length` — un `History` mutable hors zustand aurait cessé de réveiller
la barre de menus. D'où des fonctions pures sur `{past, future}` plutôt qu'un objet qui les détient.

**`revisionLog.note(patches)` est la vraie déduplication.** `mutate`, `undo` et `redo` écrivaient
chacun le même `append({ entities: touched.entities.has('*') ? … })` de quatre lignes, puis relisaient
les deux mêmes drapeaux sur l'analyse. Les drapeaux reviennent parce qu'ils sont **au store** — un
changement structurel et un changement de composant pilotent chacun un compteur auquel un panneau
s'abonne — et ça n'est en rien l'affaire d'un journal.

**Les trois invariants que la fiche protégeait ont voyagé avec leurs commentaires** :
`selectionBefore`/`selectionAfter` toujours non optionnels (un champ optionnel est un champ qu'on
oublie, et c'est B2) ; `revision` **descend** à l'undo pendant que le compteur du journal monte ;
`compact` fait toujours d'un drag de dix secondes une seule entrée.

**Aucun fichier de test modifié.** `history.test.ts` teste une propriété — quarante commandes
aléatoires, N undos ramènent au départ, N redos à la fin — et c'est le filet autour duquel la tâche
était écrite. Vert sans y toucher. `changesSince` a ses propres tests dans `documentStore.test.ts`,
verts aussi. **Pas de passage par le harnais** : ces deux fichiers couvrent mieux que l'application ne
le montrerait.

**T-043 — 1170 lignes → 708, en trois commits.** `ViewportInput` 177, `ViewportRenderer` 288,
`PlaySession` 243. Un commit par coupe : 540 lignes déplacées d'un coup dans la classe dont dépend
tout l'éditeur ne se relisent pas et ne se bissectent pas. Chaque coupe a été vérifiée seule dans
l'éditeur qui tourne.

**Coupe 1 — `ViewportInput` (`9751524`), piège : l'ordre d'enregistrement.** L'écouteur d'arbitrage
doit être posé **avant** ceux de `FlyControls` et `TransformControls` — sur un même élément les
écouteurs tournent dans l'ordre d'enregistrement, et cet ordre *est* l'arbitrage. D'où une classe
construite avant eux, qui reçoit la vue elle-même : `InputSubjects` dit que ses champs sont lus **au
moment de l'événement**. *Vérifié* : un clic sélectionne le sol ; une pression droite verrouille
`navigating` et un relâchement **sur la window** le déverrouille ; un relâchement à 200 px ne
sélectionne rien.

**Coupe 2 — `ViewportRenderer` (`462bc56`), la ligne passe aux caméras.** `resize` mesurait trois
boîtes puis corrigeait **trois caméras qui ne lui appartiennent pas** (l'éditeur, le moteur, l'aperçu
d'import). Il mesure et dimensionne la surface, et répond à une seule question : est-ce que la boîte
de la vue Scene a bougé. La boucle fait les trois corrections. `sizeDirty` reste ce qu'il était — un
drapeau que l'observer lève et que **seule la boucle** consomme — et l'appel depuis `beginPlay`
s'appelle maintenant `markResized()`. *Vérifié* : surface = panneau × devicePixelRatio, aspect caméra
= aspect panneau, fps/draw calls/vitesse de vol dans le store, et une caméra mise volontairement à
`aspect = 99` revient juste une frame après `markResized()`.

**Coupe 3 — `PlaySession` (`6039edb`), et les deux annonces sont tout l'intérêt.** Ce que la session
demande à la vue tient en quatre choses (`PlayHost`) : le renderer, le canvas du panneau Game, les
réglages de rendu, et **`onPlayStarted` / `onPlayStopped`**. Un jeu qui tourne éteint la caméra et
cache les poignées — *lesquelles* des pièces de la vue ça touche reste à la vue. *Vérifié* : en Play,
moteur présent, contrôles éteints, gizmo caché ; en Stop, moteur parti, contrôles revenus, warnings
vidés, et un sol déplacé avant Play remis là où il était écrit.

**⚠️ Un cycle connu a gagné un membre, et ce n'est pas un cinquième cycle.** `PlaySession` demande
quel est le nom de la scène ouverte (`commands/sceneFiles`), ce qui est une question légitime pour ce
qui la fait tourner ; le nœud reste `state/projectStore` qui atteint la vue, et c'est le lot 4 qui le
ferme. Consigné dans `KNOWN_CYCLES` plutôt que contourné.

**⚠️ Six imports morts trouvés dans `EditorViewport`, deux commits après leur mort.** Même cause qu'en
T-041 : **`noUnusedLocals` est éteint**. C'est la deuxième fois dans ce chantier qu'il coûte quelque
chose.

**T-043 est en cours : une tâche, trois commits, un seul est fait.** 540 lignes déplacées d'un coup
dans la classe dont dépend tout l'éditeur ne se relisent pas et ne se bissectent pas. La fiche
`T-043` décrit les trois coupes et où passent leurs coutures — **la lire avant de reprendre**.
`EditorViewport` : 1170 → 1064 lignes.

**Coupe 1 — `ViewportInput` (`9751524`), et son piège est l'ordre d'enregistrement.** L'écouteur
d'arbitrage doit être posé sur le canvas **avant** ceux de `FlyControls` et de `TransformControls` :
sur un même élément, les écouteurs tournent dans l'ordre d'enregistrement, et cet ordre *est*
l'arbitrage. Donc `ViewportInput` se construit avant eux et reçoit **la vue elle-même** — ses champs
sont remplis aux lignes suivantes. Ce n'est plus un commentaire qui le dit mais un type,
`InputSubjects`, avec la raison dessus. Le clic-sélection est un second appel, fait en dernier.

**L'`AbortController` part avec les écouteurs**, et c'est le motif que les deux autres coupes doivent
garder : quatre closures anonymes jamais retirées, invisible tant que le canvas est un singleton.

**Vérifié dans l'éditeur qui tourne**, avec des `PointerEvent` synthétiques : un clic sélectionne le
sol ; une pression droite verrouille `navigating` et **un relâchement sur la `window`** le déverrouille
— c'est le cas qui laissait autrefois la caméra désactivée sans retour possible, parce qu'un reparent
de dockview avait mangé le relâchement ; et un relâchement à 200 px de sa pression ne sélectionne rien.

**⚠️ Trois erreurs renderer pendant cette vérification, et elles sont de la sonde.**
`NotFoundError: … 'setPointerCapture' … No active pointer with the given id is found` — un
`PointerEvent` synthétique n'a pas de pointeur actif, donc toute bibliothèque qui capture lève ça.
Ce **n'est pas** l'`InvalidStateError` que l'arbitrage existe pour empêcher ; les trois campagnes de
harnais précédentes, sans événements synthétiques, disaient « renderer errors: none ».

**T-042 — déplacé en bloc, commentaires compris.** `SceneBinder` 978 → 621 lignes, plus un
`EnvironmentBinder` de 400. Chacun de ces commentaires est une matinée perdue par quelqu'un : le
placeholder 1×1 que renvoie un loader HDR et que `PMREMNode` lit comme prêt puis met en cache **noir
pour toujours** ; les instances `Color`/`Fog` réutilisées parce que le backend WebGPU indexe ses nœuds
sur l'**identité** de l'objet, donc une instance neuve par sync recompile chaque matériau derrière,
à chaque cran d'un curseur. Rien n'a été « nettoyé ».

**Deux contraintes passent de la discipline au type.** L'arena est un **argument de constructeur**, pas
un champ : ce que ce binder relâche doit atterrir dans la même file de retire que les systèmes, et il
n'y a plus moyen de lui en donner une à lui. Et le `renderer` est `readonly` — c'est exactement ce que
la contrainte 2 de `bindScene` demandait depuis toujours (le device en main **avant** que
l'environnement soit construit, pas seulement avant la première frame). Avant, `SceneBinder.renderer`
était un champ public mutable que personne n'écrivait jamais.

**« Un binder, une scène » a déménagé avec le code et est dit là où il vit maintenant** : `scene` est
un champ unique parce qu'une image qui finit de décoder **après** le retour de `sync` arrive dans un
callback sans scène en main. C'est ce qui a tué l'idée de partager un binder entre l'éditeur et le jeu.

**Renommages au passage** : les préfixes `environment*` sur les champs et méthodes privés étaient du
bruit une fois la classe devenue l'environnement — `environmentMaps` → `maps`,
`dropUnclaimedEnvironmentMap` → `dropUnclaimed`, etc. `SceneBinder.syncEnvironment` **garde son nom**
et délègue : les appelants (`EditorViewport`, `bindScene`, les tests) ne bougent pas, et l'ordre que
`bindScene` documente reste lisible.

**Vérifié dans l'éditeur qui tourne**, parce que le test de parité ne voit rien de tout ça : brouillard
exponentiel allumé, puis une seconde édition du même mode **rendant la même instance `FogExp2`** —
c'est l'invariant qui justifie l'existence de ces champs, et il tient à travers le déplacement ; le
ciel analytique mettant `scene.background` à `null` comme il le doit, étant un mesh ; et le retour à la
couleur. Aucune erreur renderer.

**T-041 — un cycle de moins : `KNOWN_CYCLES` en compte trois, plus quatre.** Le test d'architecture
échoue désormais aussi fort si celui-là revient.

**Ce qu'`assetField` allait chercher lui est passé, en deux fonctions.** `AssetFieldActions` —
« importe et dis-moi ce qui est entré », « montre-moi cet asset ». Le chemin :
`InspectorPanel` → `InspectorBinding(container, target, actions)` → `PaneBinder(container, plugins)`
→ `assetFieldBundle(actions)`. C'est ADR-7 appliqué : le contexte est un paramètre.

**`PaneBinder` prend les *plugins*, pas les services.** La différence compte : un binder n'a pas à
savoir quels contrôles maison existent. Le panneau de réglages d'import n'en enregistre **aucun** — un
importeur déclare des nombres, des interrupteurs, des énumérations et des boutons, et aucun de ces
contrôles n'est écrit à la main.

**Le geste « révéler » est parti en entier dans `commands/assetCommands.ts`.** Le scinder aurait
laissé la moitié « store » dans le contrôle et sorti seulement la moitié « dock » — ce n'est pas là
qu'est la couture. `commands/` atteint déjà `shell/` (`playCommands`), donc rien de neuf.

**Le second site de la fiche était plus simple qu'annoncé : sept imports morts.** `inspector/schema.ts`
« atteignait le renderer » via `peekViewport`, mais **aucun des sept imports hérités du déménagement
des panneaux (T-030) n'était utilisé** — `peekViewport`, `setComponentNestedField`, `audioPreview`,
`useAssetStore`, `askForText`, `useDocumentStore`, `expandedScene`. Le fichier n'importe plus rien hors
d'`inspector/`.

**⚠️ `noUnusedLocals` est éteint dans le `tsconfig`** — c'est ce qui a permis à sept imports morts de
survivre à un déménagement. L'allumer est un changement de dépôt entier, hors périmètre ici, mais
c'est un filet bon marché pour exactement ce genre de résidu.

**Ce qui reste et que la fiche ne demandait pas** : `importStore` et `plan` importent `SettingsDraft`
depuis `settingsPane.ts` — un store et un plan qui dépendent d'un module de panneau Tweakpane pour un
type de données. Ce n'est plus un cycle, donc le test se tait ; le type appartiendrait à `plan.ts`.

**Vérifié dans l'éditeur qui tourne** : dix slots d'asset sur un mesh, chacun dessinant le contrôle
maison avec ses quatre boutons — pas la zone de texte vers laquelle Tweakpane retombe quand le plugin
n'est pas enregistré. Aucune erreur renderer. **Non exercé** : les deux boutons eux-mêmes — le projet
jetable n'a aucun asset, et le chemin d'import ouvre une boîte de dialogue native.

**T-040 — quatre morts, pas trois.** La fiche listait `EntityTarget.write`, `EntityTarget.can` et
`Reading.mixed`. **`EntityTarget.read` n'avait pas d'appelant non plus** : les seuls `.read()` de
production sont ceux de `ComponentTarget`. `EntityTarget` passe donc de quatre méthodes à une,
`components()`.

**`Reading` et `compare()` sont partis avec `mixed`.** Une fois `mixed` retiré, `Reading` est un
enrobage à un champ et `compare()` renvoie `values[0]` — les garder aurait laissé la coquille que la
tâche enlève. `read()` rend un `unknown`.

**`mixed` n'est pas affiché, et la raison est écrite dans le code.** Le tiret que Unity et Unreal
montrent demande de changer le **libellé** d'une rangée, or Tweakpane le fixe à la liaison : un tiret
qui va et vient au fil d'une édition a besoin d'un endroit où vivre qu'un `refresh` puisse atteindre.
C'est une fonctionnalité, pas un champ en attente — c'est ce que la fiche disait, et c'est noté sur
`ComponentTarget.read` pour la prochaine personne qui se demandera où est passé le tiret.

**`EntityTarget.can` était un doublon de `Selection.can`**, jusqu'au même test : `selection.test.ts`
vérifie déjà qu'un membre verrouillé refuse `translate` en laissant passer `rename`. Rien de couvert
n'a été perdu.

**Trois tests supprimés, un remanié.** Les trois ne tenaient que la surface morte. Celui qui reste
vérifie ce que le panneau demande vraiment : qu'une cible de composant **re-résout depuis le document
à chaque lecture** au lieu de répondre depuis le composant avec lequel elle a été construite — vérifié
mordant en la faisant répondre depuis celui-là.

**Deux commentaires devenus faux, corrigés au passage.** Celui de `MultiTarget` décrivait un `read` et
un `write` qui n'existent plus ; celui de `SingleTarget` disait « every case until phase 8 », et la
phase 8 est là.

**T-039 — un `*_LABELS` à côté de chaque union, et rien d'autre.** Un `Record<Union, string>` **total**,
dans la tranche qui déclare l'union ; `optionsFrom` en tire les choix d'un contrôle. `GEOMETRY_LABELS`
avait déjà cette forme depuis le début — c'est le reste qui manquait, douze listes.

**L'erreur tombe au bon endroit, et c'est le seul point qui comptait.** Vérifié en ajoutant
`'kinematicVelocity'` à `BodyType` : `Property 'kinematicVelocity' is missing in type … but required
in type 'Record<BodyType, string>'`, **deux lignes sous l'union**, dans le fichier qu'on vient
d'éditer. Un record dans l'éditeur aurait donné la même garantie mais l'erreur dans un autre paquet.

**L'ordre reste une question distincte de l'union.** Un `bodyType` se lit Dynamic, Fixed, Kinematic et
se déclare fixed-first — d'où un *record* plutôt qu'un tableau de membres : l'ordre du littéral est
l'ordre du contrôle. Les douze listes dérivées ont été comparées une à une aux littéraux d'origine :
valeurs, libellés et ordre identiques.

**⚠️ `satisfies` ne vérifie pas la totalité, et un commentaire du dépôt prétendait le contraire.**
`AUDIO_BUSES` était une seconde liste écrite à la main de la même union, sous
`satisfies readonly AudioBus[]`, avec « adding a bus to the union without adding it here is a compile
error ». **Faux** : `satisfies` vérifie que chaque élément *est* un `AudioBus`, jamais que chaque
`AudioBus` est un élément. La liste pouvait perdre un bus et le mixer construire un gain node de
moins. Elle sort maintenant de `Object.keys(AUDIO_BUS_LABELS)`.

**Le même trou reste ouvert sur `COMPONENT_TYPES`** (`scene/components.ts`), qui n'a pas de libellés
et n'entrait donc pas dans cette tâche. Il est plus gênant qu'il n'en a l'air : `emptyComponentTables`
construit un `Record<ComponentType, …>` total à partir de cette liste avec un `{} as`, et **les deux
invariants de l'Inspector itèrent `COMPONENT_TYPES`** — un type absent de la liste serait sauté sans
bruit. À traiter quand quelqu'un ajoutera un type.

**`sameShape()` n'existe plus, et ce n'était pas la frontière qu'il prétendait être.** Il comparait
des `typeof` à chaque frappe, dans **les deux setters du panneau scène et nulle part ailleurs** — les
panneaux d'entité n'en ont jamais eu, ils écrivent à travers `Record<string, unknown>`. Ce qu'il
tenait est énoncé une fois dans `inspectorSchema.test.ts` : chaque contrôle déclaré est confronté à la
valeur que le document garde à son chemin, et la valeur d'une rangée `enum` doit être un des choix que
son union a produits. Vérifié mordant en cassant un libellé. La vraie frontière — un fichier écrit par
une version antérieure — reste celle de la migration de format, qui n'a pas bougé.

**⚠️ Un commit sans numéro de tâche : `de42d5a`, le pivot du gizmo.** Signalé par l'utilisateur au
milieu du chantier — le gizmo de rotation revenait sur les axes du monde au relâchement. Ce n'est pas
une étape du refactor, donc pas de fiche dans `tasks/` ; c'est une correction de bug, et elle est
consignée ici pour que la suite du chantier ne s'étonne pas de trouver un commit hors liste.

**Un seul défaut, trois symptômes — candidat pour T-068 (le registre des bugs).** Le pivot synthétique
que pilote `GizmoController` avait une position et **aucune orientation** : `update` le remettait à
l'identité à chaque frame qui n'était pas un drag. Or `TransformControls` oriente ses poignées
d'après le quaternion monde de l'objet auquel il est attaché — le pivot. D'où :
1. le gizmo de rotation tournait avec le geste et retombait à plat au relâchement (l'objet, lui,
   gardait bien sa rotation — seules les poignées se remettaient à zéro) ;
2. **le bouton Global/Local de la barre d'outils ne faisait rien du tout**, dans aucun mode : ses deux
   branches lisaient la même identité ;
3. une mise à l'échelle sur un axe d'un objet tourné se faisait sur un axe du **monde** — mauvais axe
   quand les axes s'alignent encore, et du **cisaillement** sinon, que `Matrix4.decompose` jette sans
   rien dire.

**Décision prise avec l'utilisateur : comportement Unity.** Local oriente les poignées sur l'objet
actif, Global les laisse sur les axes du monde, et le bouton pilote *déplacement et rotation*.
L'échelle est orientée quoi qu'en dise le bouton — three force `space = 'local'` pour l'échelle en
interne, et le cisaillement ci-dessus est ce que l'autre réponse veut dire.

**`pivotPose` est une fonction pure exportée**, et c'est ce qui la rend testable :
`new TransformControls(camera, dom)` réclame un `HTMLElement`, et il n'y a pas de DOM sous vitest
(T-055). Le calcul du delta n'a pas bougé et n'avait pas à bouger : `maintenant × avant⁻¹` avec les
deux dans le même repère, donc une base tournée s'annule d'elle-même.

**Vérifié dans l'éditeur qui tourne**, harnais sans tête sur un projet jetable : sol tourné d'un
huitième de tour autour de Y, quaternion du pivot lu par `__studioViewport` →
`[0, 0.3827, 0, 0.9239]` en Local (identique à celui de l'objet) et `[0, 0, 0, 1]` en Global. Aucune
erreur renderer.

**T-038b — `FieldSpec` est maintenant `FieldDef | { type?: undefined }` croisé avec la moitié
éditeur.** `BindingParams` a disparu de tout `src/`. Une rangée dit `type: 'number', min, max, step`
là où elle disait `params: { min, max, step }` — et **ne dit rien** là où elle ne disait rien :
Tweakpane lit la valeur liée pour choisir une case à cocher, un sélecteur de couleur ou un champ
texte, et redire ça sur quarante rangées serait une nouvelle façon de contredire le document.

**Le piège de typage qui a coûté le plus de temps** : `(A | B) & X` laissé en intersection fait lire
à `Omit` et au contrôle des propriétés excédentaires les clés **communes**, donc `min` disparaissait
de partout. Il faut distribuer par un paramètre de type (`EachWith` dans `fields.ts`), et
`SceneFieldBase` a besoin d'un `DistributiveOmit` pour la même raison.

**La traduction a migré dans le binder.** `PaneBinder.bind` appelle `declaredControl(spec)` et laisse
la rangée écraser ce qu'elle veut. Un adaptateur pour les trois producteurs, au lieu d'un par
producteur plus un sac de paramètres pour les panneaux.

**⚠️ Un bug introduit et attrapé, qui dit ce que ce genre de passage risque.** `water.sunDirection`
portait `...asVec3` **sans** `params` ; le script mécanique a retiré le spread et n'avait rien à
convertir en `type: 'vec3'`. Résultat : un tuple lié à un contrôle qui veut `{x,y,z}`, sans erreur,
invisible tant qu'on n'ouvre pas ce panneau-là. D'où **les deux invariants testés** dans
`inspectorSchema.test.ts`, tous deux vérifiés mordants en les cassant exprès :
1. une rangée dont la valeur stockée est un tuple déclare un pavé, et l'inverse ;
2. rien de ce qu'une rangée déclare n'atteint Tweakpane hors des paramètres qu'il connaît.

**`asDegrees` reste, `asVec2`/`asVec3` partent.** La ligne : convertir un tuple en pavé est **forcé
par le type** (aucune rangée `vec3` n'y échappe), montrer un angle en degrés est un **choix** —
`particleEmitter.velocity` est un `vec3` qui n'est pas un angle. Et les convertisseurs par rangée
restent de toute façon (interrupteur/cadran de `audioSource`), donc une variante `angle` serait une
seconde façon de dire ce qui se dit déjà.

**Les bornes d'un pavé sont uniformes sur les axes.** Les trois déclarations qui existaient posaient
les mêmes `min`/`step` sur chaque axe ; `vec2`/`vec3` prennent donc un seul jeu, et `numeric()` reçoit
exactement l'objet par axe qu'il recevait avant. Une forme par axe est à inventer le jour où une
diffère.

**⚠️ Reste ouvert : deux contrôles pour une idée.** Le slot d'asset d'un panneau (vignette,
glisser-déposer, import) et la variante `asset` d'une propriété de script (liste déroulante) sont la
même chose écrite deux fois. Les réunir change ce qu'un designer voit **et** demande que « pas de
`kind` » veuille dire « tous les kinds » dans `assetField.ts` (517 l. de plugin Tweakpane à la main).
Pas fait ici ; c'est une tâche à part, voisine de T-041 qui touche déjà ce fichier. En attendant, le
slot garde un `params`, **typé `AssetSlotParams` et non plus `BindingParams`** — une échappatoire
nommée, pour un contrôle, au lieu de la surface entière de Tweakpane.

**Pas lancé dans l'éditeur.** Les paramètres remis à Tweakpane sont identiques à ceux d'avant, rangée
par rangée — c'est ce que le second invariant fixe. Ce qu'aucun test ne couvre reste le panneau qui se
construit vraiment, faute de DOM (T-055).

**T-038 — ⚠️ scindée, et la raison est un troisième vocabulaire que l'audit n'a pas vu.** La tâche dit
« deux systèmes parallèles ». Il y en a **trois** : `ScriptPropertyDef` (runtime), `FieldSpec`
(éditeur) et **`ImportField` (core)**, présent depuis le commit initial et absent de D12. Et il y avait
**deux** adaptateurs, pas un : `extraFields` pour les scripts (~100 l.) et `specFor` dans
`settingsPane.ts` (~25 l.), dont les commentaires se citaient mutuellement sans que personne ne les
réunisse.

**Ce qui rend la scission nécessaire, et pas seulement commode.** `FieldSpec` n'est pas une
déclaration, c'est une **liaison** : `path`, `visibleWhen`, `toModel`, `fromModel`, `optionsProvider`
sont des fermetures, et `params` est **`BindingParams`, le type de Tweakpane**. Rien de tout ça ne
descend dans `core`. Donc « un vocabulaire, deux producteurs » se lit : les deux producteurs qui
*déclarent* — importeurs et scripts — et pas les treize panneaux qui *lient*. Ceux-là sont
**T-038b**, écrite avant de coder comme la boucle l'exige.

**`scriptFields()` s'appelait `extraFields` depuis T-030** (`components/script/inspector.ts`), même
`switch` sur `def.type`, même longueur. Les repères `schema.ts:66` et `schema.ts:1313-1408` de la tâche
et de PLAN D12 sont morts depuis la tranche éditeur ; le fond, lui, tenait exactement.

**Trois contraintes ont dicté la forme du vocabulaire, et deux viennent de code qu'on ne possède pas.**
1. Le tag reste **`boolean`**, pas `toggle` : c'est ce qu'un script utilisateur écrit. Le builder garde
   `field.toggle()` — il est nommé d'après ce qu'il dessine.
2. Les options d'`enum` acceptent **les deux orthographes** (`'run'` et `{ value, label }`) : les
   scripts écrivent la première, les importeurs ont besoin de la seconde (`srgb` → « sRGB (colour) »).
   `fieldOptions()` normalise en un seul endroit.
3. `ScriptProperties` reste un **`Record`** ; seuls les producteurs ordonnés portent `key` sur la
   rangée. D'où `FieldDef` (sans clé) et `FieldRow = (FieldDef & { key }) | groupe | action` —
   l'intersection distribue sur l'union, donc le narrowing par `type` survit.

**Un seul changement de comportement, et il est du côté import.** `specFor` pose maintenant un
`toModel` sur toutes les rangées, donc la chaîne `valeur ?? défaut déclaré ?? zéro du type` s'applique
aussi aux réglages d'import, qui n'en avaient pas. Elle est là pour les scripts : `props` est stocké
**creux**, donc « pas encore de valeur » est le cas ordinaire et une rangée qui disparaîtrait serait
une propriété impossible à régler. Côté import elle ne se déclenche jamais — `defaultSettings` remplit
chaque clé et la montée de sidecar la remplit à nouveau.

**`apps/desktop/src/main/scripts.ts` recopie encore le type à la main** dans `RUNTIME_DTS`, la chaîne
de `.d.ts` écrite dans chaque projet. Une ligne mise à jour ici (les options d'enum) ; la copie reste
une copie. La fermer demande de générer le `.d.ts` depuis le type — un travail de build, pas de
refactor, et personne ne l'a demandé.

**Pas vérifié dans l'éditeur qui tourne.** L'adaptateur est pur et testé variante par variante
(`packages/editor/test/declaredFields.test.ts`, 11 cas — il n'y en avait **aucun**). Ce que le test ne
couvre pas : Tweakpane construisant réellement les rangées, ce qui demande un DOM (T-055).

**T-037 — `docs/adr/0001-compression-enters-through-the-importers.md`.** Premier fichier de
`docs/adr/`, qui n'existait pas : format pris dans `ADR-FORMAT.md` (`docs/adr/NNNN-slug.md`,
numérotation séquentielle). **Le numéro `0001` est à trancher par T-067** — rien ne le cite dans le
code, donc soit la série reconstruite commence à `0002`, soit T-067 renumérote celui-ci au passage.
Aucun coût dans les deux cas.

**Écrit en anglais, et sans un seul numéro de tâche.** Les ADR sont citées *depuis le code*, dont les
commentaires sont en anglais ; et `docs/chantier/` disparaîtra, donc un « voir T-034 » dans un document
permanent serait une référence morte. Les faits que les tâches ont établis y sont nommés par ce qu'ils
sont (« content-hashed asset names », « the size report »), pas par leur numéro.

**Ce que la lecture du code a apporté et que la tâche ne pouvait pas anticiper** — l'argument le plus
fort n'est pas la taille, c'est que **`AssetResolver.settings()` est le seul endroit du dépôt lu à
l'identique par les trois consommateurs** (viewport, Play, build exporté). La compression est *avec
perte* : posée là, l'artefact apparaît dans le viewport à côté de la case qui l'a causé. Posée dans
l'exportateur, le premier endroit où on le voit est le build livré. Le précédent exact est
`sniffTextureEncoding` : un fait tiré des octets, décidé une fois à l'import, écrit dans le sidecar.

**Trois formats, trois problèmes différents — et c'est WebP qui se fait en premier.** Déjà dans
`TextureImporter.extensions`, déjà décodé par le navigateur, déjà prévisualisable : transcoder un PNG
en WebP à l'import est un changement d'importeur et rien d'autre. KTX2 et Draco demandent des décodeurs
**servis** (WASM + wrapper, ~250 kB et ~575 kB — mesurés dans `node_modules/three/examples/jsm/libs/`),
là où Meshopt est câblé parce que c'est un module ES qui se bundle.

**Deux contraintes trouvées dans le code, pas devinées** : `KTX2Loader.detectSupport(renderer)` réclame
le renderer, et `ModelCache` n'en prend pas — les deux consommateurs le créent bien avant leur
`SceneHost`, mais le préchargeur de `SceneHost` est écrit pour vivre *avant* un moteur, donc le
plomber ne doit pas le rendre dépendant d'un. Et `applyTextureSettings` perd deux champs : un KTX2 ne
se retourne pas à l'upload et porte sa propre chaîne de mips, donc `flipY` et `generateMipmaps`
cessent d'appartenir à l'auteur pour ces fichiers.

**La seule chose que l'exportateur gagnerait, et elle est tranchée dans l'ADR** : poser les décodeurs
dans le build. Les mettre dans `apps/web-template/public/` les fait payer ~0,8 Mo à *tous* les builds,
sur le rapport de taille même qui aurait motivé le travail. L'ADR recommande de copier le décodeur dont
le build a besoin — les sidecars le savent — ce qui garde en plus le template opaque à l'exportateur
(la contrainte notée en T-035) : les décodeurs sont une troisième source à copier, pas un répertoire
*dans* le player. Et ça reste une copie de fichier, jamais un encodeur qui tourne.

**Le trou que la compression ne doit pas rouvrir** : un `.gltf` nomme ses images *dans le fichier*.
Compresser une texture qu'un `.gltf` référence par son nom est exactement le trou laissé ouvert par
T-034 côté compagnons. D'où « on commence par les textures autonomes » dans l'ADR.

**T-036 — ⚠️ affiché dans le toast, pas dans `PackageDialog` comme la tâche le dit.** Le dialogue se
**ferme avant** que le build démarre (`onClose()` puis `runExport()`), donc il n'est pas à l'écran
quand il y a un résultat à montrer. Le toast est là où tous les résultats d'export atterrissent déjà :
le total rejoint les compteurs sur la ligne de résumé, et la ventilation va derrière la même
divulgation qui portait déjà le chemin du dossier. `Alert` rend ce bloc en monospace avec les blancs
préservés, donc le padding suffit à en faire un tableau. Le montrer *dans* le dialogue demanderait de
le garder ouvert pendant le build et d'y ajouter une vue de résultat — une refonte, pas une addition.

**Par *kind* d'asset, pas par les trois catégories qui comptent d'habitude.** Modèles, textures et
audio sont trois des sept ; sans les quatre autres, les octets des materials, prefabs et shaders
tombaient dans une ligne qui n'est pas la leur ou nulle part. Les répertoires sont lus depuis
`ASSET_KIND_INFO` (donc depuis les importeurs), et `KIND_LABELS` est un record **total** : un kind
ajouté aux importeurs est une erreur de compilation ici.

**L'invariant qui rend la ventilation lisible** : chaque fichier tombe dans exactement une ligne et les
lignes somment au total. Ce que rien ne réclame va dans `player` — pas de seau résiduel à expliquer.
Le seul octet non compté est `files.json` lui-même, écrit en dernier et absent de sa propre liste
(voir T-035). Testé.

**Vérifié dans l'éditeur qui tourne** — File > Package… > Build, puis lecture du toast :

```
4.3 MB · 1 scene · 2 assets · 1 script
  Player    4.3 MB
  Scenes    7.3 kB
  Scripts   4.0 kB
  Models    1.2 kB
  Textures    79 B
  ----------------
  Total     4.3 MB
```

**Un doublon repéré, pas touché** : `formatBytes` existe deux fois — `import/preview/facts.ts`
(décimal, 1000, réutilisé ici) et une copie privée dans `ProjectPanel.tsx` (binaire, 1024). Les deux ne
donnent pas le même nombre pour le même fichier. Unifier changerait les tailles affichées dans le
panneau Projet ; à faire quand quelqu'un s'en apercevra.

**T-035 — `files.json` est un fichier à part, et c'est le raisonnement de T-032 pris à l'envers.** Les
trois documents repliés dans `build.json` étaient petits et **toujours** nécessaires, donc une requête
chacun était un aller-retour pour rien. Celui-ci n'est **jamais** nécessaire à l'exécution : le player
téléchargerait la liste de tous les fichiers du build, avant la première frame, pour l'ignorer. Le
garder dehors permet en plus de **lister et vérifier `build.json` lui-même** — un manifeste ne peut pas
porter sa propre empreinte, donc la liste n'aurait jamais pu vérifier le fichier où elle vivait.
`files.json` est le seul fichier que rien ne cautionne ; ce qui le cautionne est hors du dossier
(signature, artefact CI).

**La liste est une *marche du dossier*, pas un décompte tenu à l'écriture.** Un décompte dit ce que
l'exportateur *voulait* produire ; la marche dit ce qui est sur le disque, et c'est la seule chose
qu'un vérificateur peut comparer. Elle n'oublie pas non plus les fichiers du player, qui arrivent par
copie d'un dossier et ne sont jamais nommés un par un.

**D'où le `rm scenes/` dans ce commit et pas dans T-033.** Une marche ne distingue pas ce que *cet*
export a écrit de ce que le précédent a laissé : une scène supprimée ou renommée serait listée comme
faisant partie du build, et la vérification bénirait un dossier qui contient deux exports. Même ligne
que `assets/` avait déjà.

**⚠️ Reste `_studio/` et la racine.** Le bundle Vite est haché, donc **mettre à jour l'éditeur puis
ré-exporter par-dessus laisse l'ancien bundle** (4 Mo) dans le dossier — listé comme s'il en faisait
partie. Pareil pour un `scripts.mjs` d'un projet qui n'a plus de script. Pas fermé ici : l'exportateur
copie le template en bloc et ne connaît pas sa disposition interne, donc supprimer `_studio/` serait le
coupler au `vite.config` du template. Les deux formes possibles : vider tout le dossier de sortie
(destructif pour ce que l'auteur y aurait mis), ou **élaguer d'après le `files.json` précédent** — ce
qui demande de tenir le décompte à l'écriture en plus de la marche. À trancher si ça gêne.

**`verifyBuild` n'a pas d'appelant** hors ses tests. La CI visée par la tâche vit hors du dépôt, et
câbler un bouton est du travail produit que la tâche ne décrit pas. L'endroit naturel le jour venu :
`BuildApi` dans `core/src/bridge.ts` → un handler `build:verify` dans `ipc.ts` → le panneau de build.

**Vérifié sur un vrai build** : neuf fichiers listés — bundle Vite, un glTF avec son buffer et son
image, une texture, la scène, `build.json`, la page, le favicon. Vérification propre ; un
`<script src="//evil">` injecté dans `index.html` la fait échouer et nomme le fichier. Joli recoupement
de T-034 et T-035 : le nom du glTF porte `d0cb0462` et son empreinte listée commence par `d0cb0462`.

**T-034 — le hash sort des octets, pas du sidecar.** C'est la seule décision qui comptait.
`AssetMeta.hash` est l'empreinte **à l'import**, rafraîchie uniquement quand l'éditeur réécrit
lui-même un material ou un prefab (`saveMaterialAsset`, `savePrefabAsset`) : une texture retouchée
dans Photoshop garde la sienne pour toujours. La réutiliser aurait reproduit le bug exact que la tâche
ferme, pour la façon la plus courante de le rencontrer. Donc `hashFile(source)` à l'export — une
lecture de plus par asset, une fois par export.

**`assets/` est vidé avant la copie.** Conséquence directe du hachage : un nom haché se pose **à côté**
de son prédécesseur au lieu de l'écraser. Sans ça, un dossier ré-exporté pendant une matinée de
réglages porte chaque itération de la texture — et c'est ce dossier que l'auteur met en ligne. Vidé
seulement `assets/`, que l'exportateur est seul à créer et remplir ; vider tout le dossier de sortie
emporterait ce que l'auteur y aurait mis, et les fichiers du player sont déjà écrasés par la copie.

**⚠️ `scenes/` accumule encore** — résidu de T-033, pas de T-034 : une scène supprimée ou renommée
laisse son `scenes/<ancien id>.json` derrière elle. Rare (ça demande une suppression, pas une édition),
mais c'est le même défaut. **T-035** est le moment : un manifeste des fichiers émis sait exactement ce
qui doit être là, donc il sait aussi ce qui ne doit plus y être.

**Les compagnons gardent leur nom, et deux trous restent ouverts.** Un `.gltf` nomme son buffer et ses
images *dans le fichier*, relativement à lui-même ; hacher un compagnon casserait la référence. Hacher
le modèle seul est sûr parce qu'il ne bouge pas de dossier. Restent :
- un compagnon modifié **sans** que le modèle change est encore servi périmé. Fermer ça demande de
  réécrire le `.gltf` (option 2 de la tâche) ou de hacher le **dossier** du modèle à partir de
  l'ensemble modèle + compagnons.
- deux modèles dans un même dossier qui nomment un compagnon identique se marchent dessus. Pré-existant.

**Vérifié dans un navigateur, deux fois.** Sol texturé rouge, `ground.293f3f7f.png`. Texture réécrite,
dossier ré-exporté par-dessus, page rechargée **sans vider le cache** : sol vert,
`ground.f3ce8f02.png`, l'ancien fichier absent du dossier. Puis un glTF avec buffer et image externes :
le journal montre `Tri.d0cb0462.gltf`, `Tri.bin`, `maps/albedo.png`, tous en 200, et le triangle est
dessiné dans la couleur de sa texture.

**Un détail qui n'a pas été traité** : les `.material.json` et `.prefab.json` sont toujours copiés dans
`assets/` alors que le player les lit depuis le manifeste (T-032) et ne va jamais chercher le fichier.
Du poids mort dans le build. À voir avec T-035.

**T-033 — les trois fonctions sont parties, et le format 5 n'est pas additif.** `sceneMap`,
`loadingSceneName()` et `sceneFileName()` n'existent plus. Chaque scène est `scenes/<id>.json` ; le
chemin est *dérivé* de l'id par `buildScenePath` dans `core`, la même fonction des deux côtés, donc
l'exportateur qui écrit et le player qui lit ne peuvent pas être en désaccord sur l'emplacement.

**`sceneNames` est un alias, pas une seconde adresse.** Nom → id. Rien n'est *trouvé* par nom : un nom
se résout en id, et c'est l'id qui dit où est le fichier. `apps/web-template/src/scenes.ts` (ex-
`entryScene.ts`, `git mv`) lit la table dans les deux sens — en avant pour un script, et une fois au
démarrage pour répondre « comment s'appelle la scène d'entrée », qui **doit** coïncider avec l'éditeur
ou `scenes.current` dit une chose en Play et une autre dans le build téléchargé. C'est le bug que
`entryScene.ts` documentait depuis le début, et il reste épinglé.

**Vérifié dans un navigateur.** Build à deux scènes + un script appelant `scenes.go('Level2')` **par
nom**, servi en statique : le journal d'accès montre `build.json`, `scenes/<id entrée>.json`,
`scripts.mjs`, puis `scenes/<id Level2>.json`, et la page finit sur la seconde scène (fond rouge). Plus
aucun `scene.json` dans le dossier.

**⚠️ Ce que le format 5 révèle, et qui est un vrai point ouvert.** C'est le **premier bump non
additif** : un fichier déplacé n'a pas de valeur par défaut et n'est plus là où il était, donc aucun
repli par champ ne peut l'exprimer — seul le numéro de version le peut. Conséquence : le repli de
T-032 dans `documentsOf` (aller rechercher `assets.json`/`materials.json`/`prefabs.json`) **est
devenu inatteignable**, parce qu'un build assez ancien pour en avoir besoin a ses scènes ailleurs.
Et il n'est pas seul : **tous les champs optionnels de `BuildManifest`** décrivent maintenant des
builds qu'aucun player ne sait lire.

Laissé debout exprès, avec le pourquoi écrit dans `documentsOf` : c'est **une décision à prendre en
une passe**, pas six fois en six endroits. Les deux formes possibles :
- une borne basse sur la garde de version (`version < OLDEST_READABLE_BUILD` refusé), et alors tous
  les replis par champ partent et les champs deviennent obligatoires ;
- ou on assume que le player voyage *toujours* avec ses données — l'export copie le player à côté de
  ce qu'il vient d'écrire — et alors la garde suffit telle quelle et les replis sont du décor.
À trancher dans le lot 10 (T-035 « manifeste des fichiers émis » est le moment naturel).

**Un aller-retour de plus au démarrage, assumé.** La scène d'entrée ne peut être demandée qu'une fois
le manifeste arrivé, puisque c'est lui qui la nomme ; `scene.json` partait dans le même souffle que
`build.json`. Ce nom fixe *était* l'asymétrie. Un `<link rel="preload">` injecté dans `index.html`
le rendrait, mais casserait l'invariant « sans base, la page est le template octet pour octet » que
`exportWeb.test.ts` tient — donc pas ici.

**Un id peut contenir des `/`.** Un `.scene.json` écrit à la main ne porte pas d'id et `discoverScenes`
le rabat sur **son chemin projet** : `buildScenePath` rend alors `scenes/scenes/Hand.scene.json.json`.
L'exportateur crée les dossiers, le player encode l'URL, personne ne suppose un nom plat.

**Ce qui a changé de comportement, dans le bon sens** : une scène de chargement que le profil n'embarque
pas était mise à `null` en silence par `loadingSceneName()`. L'id passe maintenant tel quel et le player
dit qu'il ne sait pas la lire. Un avertissement à l'export serait mieux encore — pas demandé, pas fait.

**T-032 — six requêtes deviennent quatre, dont deux de données.** `assets.json`, `materials.json` et
`prefabs.json` sont trois champs de `build.json`. **Compté, pas supposé** : un build réel exporté puis
servi en statique, chargé dans Chrome, demande la page, le bundle du player, `build.json` et
`scene.json`. Pas de `scripts.mjs` — ce projet n'a pas de script, et le manifeste le *nomme* au lieu
de laisser le player sonder le serveur. Le journal d'accès du serveur dit la même chose, et le dossier
ne contient plus les trois fichiers.

**`BuildManifest` vit dans `core/src/assets/schema.ts`**, à côté du `BUILD_FORMAT_VERSION` qui le
versionne et dont la docstring revendiquait déjà le terrain (« Shape of the files an exported build
carries beside the player »). Ça ajoute deux arêtes d'import à `assets/schema.ts` — `project/schema`
pour `RenderingSettings`, `scene/prefab` pour `PrefabDoc` — vérifiées sans cycle par le test
d'architecture.

**La troisième déclaration était `EntrySceneManifest`**, dans `web-template/src/entryScene.ts` : une
copie partielle de deux champs. Devenue `Pick<BuildManifest, 'scenes' | 'sceneMap'>`, ce qui garde les
fixtures de son test inchangées — c'est l'intérêt du `Pick` sur un paramètre `BuildManifest` entier.

**Format 4 reste additif, mais pas de la même façon que 2 et 3.** Celles-là l'étaient parce qu'un champ
absent avait un défaut sensé ; une table d'assets absente n'en a pas. Ce qui la rend additive ici, c'est
que la donnée est *encore là où elle était* : `documentsOf` va rechercher les trois fichiers quand les
champs manquent, ce qui coûte à ces builds-là exactement les trois requêtes qu'ils faisaient déjà.
**À revoir** si T-035 (manifeste des fichiers émis) ou T-033 rendent ces builds illisibles pour une
autre raison : la garde de version ne couvre qu'un sens (données plus récentes que le player).

**Ce que T-033 va trouver.** `sceneMap` est écrit deux fois (par nom *et* par id), `loadingSceneName()`
résout un id en nom, et `sceneFileName()` aplatit `scenes/main.scene.json`. Le PLAN (§ lot 10) dit que
les trois disparaissent quand toutes les scènes passent sous `scenes/<id>.json`. `entrySceneName()` et
son test disparaissent probablement avec.

**T-031 — la mesure : 9 fichiers neufs dans 3 dossiers, 10 fichiers partagés, 29 lignes.** Contre les
**14 fichiers obligatoires** que l'audit avait comptés (PLAN, point 1). Le type ajouté est
`particleEmitter` : un nombre fixe de particules facturées, nées dans un point, une boule ou une
boîte, portées par une vitesse et une accélération constante, et renées à la fin de leur vie. Un draw
call, un shader, aucun état porté d'une frame à l'autre.

**Les neuf fichiers neufs sont tous dans les trois dossiers du type.** `core` (schema, defaults,
définition), `runtime` (système, enregistrement, sprite par défaut), `editor` (inspector, menu,
overlay). Le troisième fichier du runtime est `particleSprite.ts` — même raison et même forme que
`waterNormals.ts` : le dépôt n'a aucun binaire, et le premier ne sera pas un fallback.

**Cinq des dix fichiers partagés sont le dispositif qui marche.** `tsc` refuse de compiler sans la
ligne, donc rien ne peut être oublié en silence : l'union dans `scene/schema.ts`, les trois tables
totales de T-030 (`panes.ts`, `overlays.ts`, `menus.ts`) et `ICON_PRIORITY` dans `HierarchyPanel.tsx`.

**Cinq sont la fuite.** Une ligne oubliée dans l'une d'elles n'est jamais une erreur de type :

| Fichier | Ce qui arrive si on l'oublie |
|---|---|
| `core/src/scene/components.ts` | `COMPONENT_TYPES` — throw au chargement de `components/index.ts` |
| `core/src/components/index.ts` | l'`import` qui enregistre — même throw |
| `runtime/src/components/index.ts` | l'`import` **et** l'entrée `DRAWN_TYPES` — throw au chargement |
| `core/src/index.ts` | le type et `createParticleEmitterEntity` : sans eux la tranche éditeur ne peut pas atteindre sa propre fabrique |
| `core/src/components/registry.ts` | `ComponentIcon` est une union fermée dans `core`, résolue par une table dans `HierarchyPanel` (d'où deux lignes de plus là-bas) |

**Le lot 1 ne peut donc pas être déclaré terminé** — c'est ce que la case de T-031 demande. Ce qui
reste, avec ce qu'on en sait :

- **Les trois listes indépendantes** (`COMPONENT_TYPES`, les deux listes d'imports d'enregistrement)
  sont trois énoncés du même fait. La forme plus forte a déjà été pesée en T-028 : un test qui dérive
  la liste des dossiers de `components/` et la compare aux imports. Ça ne supprime pas la ligne, ça
  supprime l'oubli silencieux — et c'est probablement tout ce qu'on peut viser, puisque
  l'enregistrement *est* l'import.
- **`core/src/index.ts`** est la porte du paquet. Une tranche éditeur qui importerait sa fabrique par
  un chemin profond supprimerait la ligne, mais casserait la règle que les onze autres suivent. À
  trancher, pas à supposer.
- **`ComponentIcon`** : l'union pourrait devenir un `string` avec une icône par défaut. On échangerait
  une erreur de compilation contre une icône générique silencieuse, ce qui est le mauvais sens.
  Probablement un coût à assumer plutôt qu'une fuite à boucher.

**Ce que la mesure a trouvé et que le typecheck n'aurait pas trouvé.** Vérifié dans l'éditeur réel avec
le harnais (`.claude/skills/smoke-harness`), pas seulement en test :

- ⚠️ **Un attribut instancié doit être un vrai `InstancedBufferAttribute` posé sur la géométrie.**
  Passer un `Float32Array` nu à `instancedBufferAttribute` de TSL le range dans un `InterleavedBuffer`
  qui n'est pas instancié : `WebGPUAttributeUtils.createShaderVertexBuffers` teste
  `data.isInstancedInterleavedBuffer` et jamais le drapeau que `BufferAttributeNode.setup` vient de
  poser. Ça compile, ça dessine, et les deux cents particules se superposent à l'origine, sans une
  erreur nulle part. D'où la géométrie propre à l'émetteur — qui en prime est la seule chose que
  `dispose()` libère : un attribut de niveau nœud accroché à une géométrie que personne ne jette
  n'est libéré par rien.
- **Deux lignes « Size » dans le même panneau** (les extents de la boîte, et la taille d'une
  particule). Vu à l'écran, pas à la relecture : les deux déclarations sont à quinze lignes l'une de
  l'autre dans le source et à un panneau d'écart à l'affichage.

**`patch` ne répond jamais `'remount'`**, et c'est le bénéfice direct du point ci-dessus : les
constantes par particule sont des attributs de géométrie, pas des valeurs pliées dans le graphe de
nœuds. Changer le nombre ou la forme échange une géométrie *poolée par l'arène*
(`particles:<count>:<shape>` — les seeds sont déterministes, donc deux émetteurs identiques la
partagent), et le matériau, son pipeline et le `Mesh` survivent.

**T-030 : treize commits — les douze types, puis l'assemblage.** Chacun vert, 808 tests à chaque fois.
Ordre de T-024 respecté : light, audioListener, prefabInstance, script, playerController, rigidbody,
collider, camera, audioSource, model, water, mesh.

**Deux modules bas ont dû exister d'abord, et c'est le vrai travail du premier commit.**
`inspector/fields.ts` tient le vocabulaire (`FieldSpec`, les convertisseurs, `GEOMETRY_FIELDS`,
`MATERIAL_FIELDS`) — même découpe et même raison que `scene/primitives.ts` en T-023 : une tranche est
écrite dans ce vocabulaire, l'assemblage importe les tranches, les deux ne peuvent pas partager un
module. `components/registry.ts` tient ce qu'une tranche déclare (`EntityMarker`, `AddMenuEntry`,
`AddMenuGroup`, `EntityOverlay`).

**⚠️ Le piège qui a coûté un test rouge, et qui décide de la forme finale.** `AddMenuEntry` dit *quoi*
créer, jamais *comment* le placer. Première version : la tranche appelait `addEntityInView`. Résultat
immédiat — `markerStyles.ts` a rejoint le cycle connu n°2, parce que l'overlay lit les mêmes
déclarations et que `state/projectStore` importe encore le viewport (violation de couche que le **lot
4** ferme). D'où :

**Trois tables totales et non une** : `components/panes.ts`, `components/overlays.ts`,
`components/menus.ts`. Un panneau atteint les commandes et les stores ; un overlay est lu depuis
l'intérieur du viewport. Un seul module important les deux moitiés remet `markerStyles` dans le nœud.
**Quand le lot 4 aura fermé cette violation, les trois peuvent redevenir une** — c'est la seule raison
qu'elles soient trois, et elle est écrite dans `panes.ts`.

**Ce qui a cessé d'être une liste.** `SelectionHelpers` construisait sa table de trois noms ; elle vient
des types qui déclarent un `helper`. Les sous-menus Add sont fusionnés par libellé et ordonnés par un
numéro que chaque groupe déclare — deux types partagent « Audio » en le nommant. **Menu vérifié
identique** (groupes, ordre, entrées) par un test jetable, supprimé après.

**Le rang du marqueur est un nombre sur le marqueur**, plus l'ordre des clés de `STYLES` : un type
déclare son marqueur dans son dossier, et un dossier n'a pas de place dans l'ordre des clés de qui que
ce soit. Toujours **pas** `ICON_PRIORITY` de la hiérarchie — deux affichages, deux décisions, comme
l'Attention de la tâche l'exige.

**Trois facettes optionnelles sur `ComponentSchema`** (`geometryFields`, `extraFields`, `paneKey`),
déclarées par `mesh` et `script` seuls — même forme que les capacités de T-029. `paneEntriesFor` les
nommait par leur type.

**`ICON_PRIORITY` reste dans `HierarchyPanel.tsx`** : c'est une décision d'affichage, pas une propriété
du type. Non touché, volontairement.

**Ce que T-031 va mesurer.** Un type neuf coûte aujourd'hui : une ligne dans l'union `ComponentDoc`,
`core/src/components/<type>/` (3 fichiers) + une ligne d'import dans `components/index.ts`,
`runtime/src/components/<type>/` (2 fichiers) + un import **et une entrée dans `DRAWN_TYPES`** s'il
dessine, `editor/src/components/<type>/` (3 fichiers) + **trois lignes** dans `panes.ts`,
`overlays.ts`, `menus.ts` (une par table, chacune totale donc le compilateur les exige). Plus
`COMPONENT_TYPES` dans `scene/components.ts`.

**T-029 : une capacité est une *méthode optionnelle*, et sa présence est la déclaration.**
C'est la forme qui supprime les casts au lieu de les déplacer. `batchable?(handle): BatchableHandle` —
le système rend son propre handle, donc il *prouve* qu'il est batchable au lieu de le promettre ; un
drapeau `batchable: boolean` aurait laissé le `as MeshHandle` intact. Même raison pour
`materialAsset?(handle): string | null` et `whenLoaded?(): Promise<void>`. Précédent exact côté `core` :
`assets: (component) => ids` et `placeable: (component) => boolean`.

**Une seule déclaration sert deux parcours.** `whenLoaded` présent = « ce système charge », ce qui
répond à la fois à `whenLoaded()` et à `entitiesThatLoad()` (ex-`entitiesWithModels`). Pas de drapeau
`loadsAsynchronously` en plus.

**`BatchableHandle` vit dans `systems/ComponentSystem.ts`** et tient les quatre champs que `MeshBatcher`
lit vraiment (`mesh`, `geometry`, `material`, `batchKey`) — vérifié au grep, il n'en lit pas d'autres.
`MeshBatcher` n'importe plus rien de la tranche `mesh`. **C'est une interface à un seul implémenteur**
(`MeshHandle`), ce que le chantier interdit d'ordinaire ; assumé parce que sans elle la capacité n'est
pas typable du tout, et que le consommateur existe. À revoir si un second type batchable n'arrive
jamais.

**`ComponentSystem.type` supprimé** — la question laissée ouverte par T-028. Lu nulle part, et depuis
que `registerSystem` porte la clé, c'était le même fait écrit deux fois.

**`Reconciler.ts` ne nomme plus aucun type de composant**, pas seulement plus de `doc.type === …` —
vérifié au grep. **Checkbox 2 vérifiée pour de vrai** : `override whenLoaded()` ajouté temporairement à
`CameraSystem` (rejet) → `sceneBinder.test.ts` échoue sur ce rejet, sans une ligne touchée dans
`Reconciler`.

**T-028 : `runtime/src/components/<type>/` existe, et `systems/` est devenu le vocabulaire partagé.**
Les cinq classes de système ont déménagé (`git mv`, l'historique suit) ; `systems/` ne garde que ce que
plusieurs tranches lisent : `ComponentSystem.ts`, `ResourceArena.ts`, `identity.ts`, `geometry.ts`,
`material.ts`, `sky.ts`. **`WaterSurface.ts` et `waterNormals.ts` y sont restés alors qu'ils ne servent
qu'à `water`** — même choix que `scene/water.ts` en T-025 : laissé où il est, à trancher quand ça
gênera. Ça ne fausse pas la mesure de T-031, qui ajoute un type neuf et lui donnera son propre dossier.

**`registerSystem` vit dans `systems/ComponentSystem.ts`**, à côté de l'abstraction, exactement comme
`registerBehaviour` vit dans `behaviour/Behaviour.ts`. Le commentaire de classe qui disait
« Deliberately not a registry keyed by type at module scope » a été réécrit, pas supprimé : sa moitié
vraie (un système possède une ressource à durée de vie) est justement ce qui fait qu'on enregistre une
**fabrique**, pas un singleton.

**Le cast d'effacement est devenu typé.** `registerSystem<T extends ComponentType, H>(type, factory: ()
=> ComponentSystem<ComponentOfType<T>, H>)` : ranger un système sous le mauvais type ne compile plus.
C'est le seul endroit où le `as unknown as AnySystem` est écrit, et son commentaire a suivi.

**`ComponentSystem.type` (`abstract readonly type`) n'est lu nulle part** — vérifié au grep avant et
après. Depuis T-028 il double la clé passée à `registerSystem`. Pas supprimé : il pré-existe, et T-029
va poser des capacités à côté. **À trancher en T-029** : le fondre dans la déclaration de capacité, ou
le supprimer.

**Le `throw` au chargement a un coût que `core` n'a pas.** `components/index.ts` porte `DRAWN_TYPES`,
qui est la liste des cinq `import` écrite une seconde fois dans le même fichier. Côté `core`,
`COMPONENT_TYPES` vit ailleurs et existe pour ses propres raisons. Ici c'est le seul énoncé
indépendant de ce qui devrait être là, et `componentCoverage.test.ts` ne peut pas le remplacer : il lit
les fichiers sur le disque, donc un dossier présent mais jamais importé lui paraît couvert. **Vérifié
pour de vrai** : `import './water'` commenté → `Error: Component types that draw but registered no
system: water.` La forme plus forte serait un test qui dérive la liste des dossiers de
`components/` et la compare aux imports — à peser si le doublon gêne.

**Lecture retenue de « le `Reconciler` reçoit la table »** : il l'obtient de `buildSystems()` au lieu de
la construire en dur. Pas de paramètre de constructeur — tous les appelants passeraient la même chose,
et `Reconciler` est exporté publiquement.

**Ce que T-029 trouve.** `Reconciler.ts` ne nomme plus aucune classe de système ; il nomme encore un
type aux quatre endroits que T-029 annonce : `meshHandles` (`'mesh'`), `entitiesUsingMaterialAssets`
(`'mesh' | 'model'`), `entitiesWithModels` (`'model'`) et `whenLoaded` (`'model'`). Ce dernier ne peut
plus tenir le système par sa classe : il fait `this.systems.get('model') as { whenLoaded?: … }`. Cast
structurel volontairement laid, et étiqueté comme dette de T-029 — l'alternative aurait été de poser
`whenLoaded?()` sur `ComponentSystem`, c'est-à-dire la capacité asynchrone de T-029 livrée en avance,
avec un seul implémenteur.

**T-027 : le défaut est *dans `fillComponent`*, pas dans `defineComponent`.** Le PLAN (ligne 801) dit
« le défaut de `defineComponent` », et c'est la seule chose que j'ai faite autrement — pour une raison
que `tsc` impose, pas par goût. Normaliser à l'enregistrement demande un second type d'entrée
(`Omit<ComponentDefinition<T>, 'fill'> & { fill?: … }`), et `T` ne s'infère pas à travers un `Omit`
d'un type générique : il retombe sur `ComponentType`, `stored` devient l'union entière, et les `fill`
de `light`, `mesh` et `water` ne compilent plus. Le contourner voulait dire recopier les huit champs
dans une seconde interface. `fill?` optionnel + un `if` chez l'unique lecteur coûte deux lignes.

**`fillComponent` est le seul lecteur de `fill`** — vérifié au grep : `registry.ts:182` et rien
d'autre. Les douze `xxxComponent` exportés par les tranches ne sont consommés nulle part non plus (les
occurrences dans `dist/` sont du build périmé). C'est ce qui rend le choix ci-dessus sans conséquence.

**Ce que le défaut ne sait pas faire, et pourquoi ce n'est pas une régression de sécurité.** Un objet
imbriqué a besoin de son `fill` — c'est le bug qui a shippé deux fois. Le compilateur ne l'exige plus
pour un type neuf qui gagnerait un sous-objet. Assumé : le défaut ne devine rien, il passe par le
`create()` du type (règle du format persisté respectée à la lettre), et les trois qui surchargent
disent chacun dans leur module ce qu'un spread plat détruirait. **Aucun test neuf** — la tâche demande
`sceneMigration.test.ts` vert *sans modification* comme preuve, et il l'est.

**Le commentaire de `model` a survécu à son `fill`.** Il expliquait pourquoi `nodePath`, `nodeName` et
`materialId` sont trois champs plats plutôt qu'un `node: { … }` — un fait sur le schéma, pas sur le
`fill`. Déplacé dans `model/schema.ts`, au-dessus des trois champs.

**T-026 : une tranche ne nomme toujours pas l'union — elle demande ce qu'elle lit.**
Le `switch` est parti dans `collider/defaults.ts` sous `createColliderFor(siblings)`. Le point qui
demandait une décision : la signature d'origine prenait `readonly ComponentDoc[]`, et une tranche n'a
pas le droit de nommer l'union (T-023). Trois options se présentaient — importer `ComponentDoc` quand
même (pas de cycle *aujourd'hui*, mais c'est la règle qui paie tout le lot), recopier la forme de
`MeshComponent` (dérive silencieuse garantie), ou déclarer le paramètre par ce qui est lu.
Retenu : `type Sibling = ComponentBase & { type: string }`, et `MeshComponent` importé depuis
`../mesh/schema`. `ComponentDoc[]` s'y assigne, le prédicat `(c): c is MeshComponent` tient, et rien
ne peut dériver de `MeshComponent` sans que `tsc` le dise.

**C'est le premier import tranche → tranche du dépôt** (`collider/defaults.ts` → `mesh/schema.ts`), et
c'est voulu : un collider deviné depuis un mesh *dépend* du mesh. Pas de cycle possible tant que
`scene/schema.ts` ne vise que les `<type>/schema.ts` — aucun `defaults.ts` n'est joignable depuis
l'union.

`components/index.ts` ne nomme plus `'mesh'`, `'model'` ni `GeometryKind` (vérifié au grep) ; il garde
`if (type !== 'collider')` pour savoir à qui déléguer, ce que la tâche demandait. `core/src/index.ts`
n'a pas été touché : surface publique inchangée par construction, toujours 236 noms. 808 tests verts.
`createColliderFor` n'est pas exporté par le baril — c'est la brique de la tranche.

**T-025 : `placeable` est une *fonction du composant*, pas un drapeau du type — et c'est le point.**
`isPlaceable` demandait si tous les composants d'un template étaient une lumière ambient ou hemisphere.
Un booléen sur la définition n'aurait pas su le dire : le seul type qui répond « non » répond par son
`kind`. D'où `placeable: (component) => boolean`, même forme qu'`assets`. Demandé aux **douze** (onze
répondent `() => true`) pour la raison que `runtime` et `addable` sont demandés : un type neuf répond
dans son propre module, là où le compilateur exige une réponse. `assets: () => []` chez sept d'entre
eux est le précédent exact.

`isPlaceable(template)` vit maintenant dans `components/index.ts`, à côté de `createComponent` et
`createComponentForEntity` — les trois questions que le registre répond au nom d'une chose entière. Le
booléen est strictement le même : `!every(unplaced)` ≡ `some(placeable)`.

**`componentIsPlaceable` n'est pas exporté par `core/src/index.ts`.** C'est la brique interne ;
`isPlaceable` est la question que l'extérieur pose. Surface publique toujours 236 noms, diff vide —
vérifié depuis T-023 à chaque commit du lot 1.

**`scene/schema.ts` a été remis à plat.** Les onze insertions mécaniques de T-024 y avaient laissé une
traînée : imports et ré-exports entrelacés, un marqueur `// --- material ---` orphelin. Il se lit
maintenant en trois blocs — le vocabulaire partagé, les douze tranches, le document — et ce qu'il
*déclare* est exactement le document (union, `EntityDoc`, `ComponentTables`, `SkySettings`,
`EnvironmentDef`, `SceneDoc`).

**Ce qui nomme encore un type, et pourquoi c'est correct.** `createStarterScene` nomme mesh, light et
camera : une scène de départ *est* un sol, un soleil, un ciel et une caméra. C'est du contenu, pas une
règle — la distinction à garder en tête si quelqu'un relit la case de T-025 au pied de la lettre.

**Resté ouvert, à trancher quand ça gênera** : `scene/water.ts` (`SUN_FROM_SKY`, `isEntitySun`,
`skySunDirection`) n'est ni une tranche ni du vocabulaire de composant — c'est la conversion de soleil
sur laquelle le ciel et la surface doivent s'accorder, lue par le runtime et l'éditeur. Laissé où il
est.

**Le lot 1 n'est pas fini** : T-031 est fait, mais la mesure qu'il rapporte laisse la case
« aucun fichier partagé hors la ligne d'union » ouverte. Voir la note de T-031 en haut.

**T-024 — les douze tranches sont là. Ce que T-025 trouvera, et ce qu'il ne trouvera plus.**

Onze commits, un par type, vert à chaque fois (808 tests), surface publique inchangée aux onze (236
noms, diff vide), et toujours exactement les quatre cycles connus.

**`blankComponent` a disparu** (au commit `script`). C'était une fonction générique sur les quatre
types dont le défaut est un littéral — `model`, `audioListener`, `script`, `prefabInstance` — écrite
ainsi pour qu'un littéral recopié dans un module de composant ne cesse pas *silencieusement* de
correspondre à son interface. Cette raison est partie avec les dossiers : une fabrique posée à côté de
son propre type est vérifiée contre lui par `tsc`. Quatre fabriques ordinaires à la place.

**Deux modules de vocabulaire partagé en plus de `primitives.ts`** : `scene/geometry.ts` (`GeometryDef`,
`GeometryKind`, `createGeometry`, `createBoxGeometry`, `GEOMETRY_LABELS`, `FLAT_KINDS`,
`restingOffsetY`) et `scene/material.ts` (`MaterialDef`, `MaterialSide`, `TextureWrap`,
`createMaterial`). Chacun tient **un type et la fabrique qui le produit** — c'est la règle, et c'est
pour ça qu'ils ne sont pas dans `primitives.ts` : 150 lignes de géométrie à côté de `Vec3` en auraient
fait un tiroir. Ils sont partagés, pas ceux de `mesh` : `water` est un plan, un modèle importé pointe
un matériau par id, et le côté assets de l'éditeur lit des matériaux sans composant en main.

**Une maladresse assumée dans l'historique** : géométrie et `MaterialSide` sont passés par
`primitives.ts` au commit `water` avant de rejoindre leurs modules au commit `mesh`. Un déplacement de
plus que nécessaire. Chaque commit était vert et cohérent ; l'état final est le bon.

**`scene/defaults.ts` ne fait plus que trois choses** : `isPlaceable`, l'environnement/ciel, et les
trois constructeurs de scène. Il **importe** les tranches (`camera`, `light`, `mesh`) au lieu de rien
déclarer. Il vise chaque `<type>/defaults.ts`, **jamais** `<type>/index.ts` — importer un index inscrit
le type, et l'ordre d'inscription est l'ordre du menu Add Component.

**Ce qui reste vraiment pour T-025**, la liste de la tâche étant maintenant à moitié périmée :
- `isPlaceable` + `UNPLACED_LIGHTS` — le dernier endroit de `scene/defaults.ts` qui nomme un type. À
  transformer en propriété déclarée par la définition (douze réponses).
- `scene/schema.ts` : reste l'union, `EntityDoc`, `ComponentTables`, `SkySettings`, `EnvironmentDef`,
  `SceneDoc`, plus les ré-exports de `primitives`/`geometry`/`material` et des douze tranches. Décider
  si les ré-exports restent (ils gardent la surface publique et les ~19 importeurs intacts) ou si on
  fait bouger les importeurs.
- `scene/water.ts` (`SUN_FROM_SKY`, `isEntitySun`, `skySunDirection`) n'a pas bougé : c'est du
  vocabulaire partagé runtime/éditeur, pas un des trois fichiers d'une tranche. À trancher.
- `createComponentForEntity` et son `switch` géométrique : c'est **T-026**, pas T-025.

**T-023 — À LIRE AVANT T-024. La forme d'une tranche, et les deux coutures qui la rendent possible.**

Une tranche, c'est trois fichiers :

```
components/<type>/
  schema.ts    les types stockés          → ../../scene/primitives   (et rien d'autre)
  defaults.ts  les fabriques + templates  → ./schema, ../../scene/entity, ../../ids
  index.ts     defineComponent({...})     → ../registry, ./defaults
```

**La contrainte qui décide de tout : une tranche ne doit jamais importer l'union.** Une tranche importe
le vocabulaire, et `scene/schema.ts` importe les tranches pour assembler `ComponentDoc`. Mettre les
deux dans le même module ferait de *chaque* tranche un cycle — douze fichiers de large à la fin, et le
test d'architecture le nomme. D'où les deux fichiers neufs, qui sont l'apport réel de T-023 :

- **`scene/primitives.ts`** — `Vec2`, `Vec3`, `Hex`, `Transform`, `ComponentBase`. Le vocabulaire dans
  lequel un composant se décrit. `schema.ts` **ré-exporte tout**, donc aucun des 19 importeurs n'a
  changé. *T-024 : y déplacer `GeometryDef`, `MaterialDef`, `TextureWrap`, `MaterialSide`,
  `ScriptPropValue`, `AudioBus`/`AUDIO_BUSES`, `PrefabOverride` au fur et à mesure qu'une tranche en a
  besoin — `mesh` en dernier en amènera le gros.*
- **`scene/entity.ts`** — `createEntity`, `createTransform`, `EntityTemplate`. Un type dans son dossier
  emmène son `create<Type>Entity`, et `scene/defaults.ts` construit la scène de départ avec ces
  templates : sans cette extraction, `light/defaults.ts` ↔ `scene/defaults.ts`.

**`components/<type>/index.ts` n'est pas un baril, et ne doit pas le devenir.** L'importer **inscrit**
le type, et l'ordre d'inscription est l'ordre du menu Add Component. `scene/defaults.ts` et
`core/src/index.ts` passent donc *à côté*, vers `./schema` et `./defaults`, qui n'ont aucun effet de
bord. Le seul fichier qui importe un `index.ts` de tranche est `components/index.ts`, qui veut
justement tout inscrire — et dans son ordre à lui.

**La surface publique se vérifie, elle ne se suppose pas.** 236 noms exportés par `core/src/index.ts`,
diff vide avant/après. À refaire à chaque tranche : les noms bougent de module, jamais de la liste.

**Ce que T-023 n'a pas fait, et pourquoi.** `isPlaceable` et `UNPLACED_LIGHTS` restent dans
`scene/defaults.ts`. T-025 les nomme et transforme `isPlaceable` en propriété déclarée par la
définition — douze définitions à répondre, donc pas une tranche. `LIGHT_LABELS`, `LIGHT_INTENSITY` et
`SHADOW_CASTERS`, en revanche, **sont déjà partis** : ce sont des helpers privés des fonctions qui ont
déménagé, ils suivent. La liste de T-025 est donc à moitié faite ; ne pas la relire comme une liste
intacte.

**Le commentaire de `components/index.ts:56-70`** (« les modules ci-dessus importent leurs fabriques
depuis `defaults.ts`, donc y chercher fermerait un cycle ») reste vrai pour **onze** types sur douze.
Il se retire tout seul à la fin de T-024, pas avant.

**T-022 : sérialiser les *écritures* n'aurait rien réparé.** Le bug n'est pas deux `writeFile`
simultanés, c'est un lire-décider-écrire : deux fenêtres lisent, la seconde écrit par-dessus la
décision de la première. La section critique va donc de la lecture à l'écriture, et c'est ce que fait
`updateProject(path, change)`. `writeProject` est **privé** derrière : une seconde porte est un second
moyen de contourner la file.

**Une seule file pour le processus, pas une par projet.** `ipc.ts` tient un `activeProjectPath` unique,
donc un seul projet est ouvert à la fois ; et deux projets qui s'attendraient ne coûteraient rien. Une
`Map` par chemin aurait demandé une politique de nettoyage pour un cas qui n'existe pas.

**La queue de la file ne doit jamais rejeter.** `writes = result.catch(() => undefined)` : sans ça, un
changement qui lève — nom déjà pris, dernière scène refusée — emporte tous ceux qui attendent derrière.
Un test l'épingle.

**La boîte de la tâche décrivait un scénario qui ne court plus.** « Deux fenêtres qui renomment deux
scènes différentes » : depuis T-017/T-018, un renommage **n'écrit pas `project.json`** — il déplace le
fichier et s'arrête. Le vrai scénario aujourd'hui est *scène de départ + réglages en même temps*, et
c'est celui qui est testé. Le renommage est épinglé aussi, pour que le jour où il réécrirait des
références, il passe par la file comme le reste.

**Vérifié dans les deux sens.** Le test de course est rouge sans la file (les deux écritures se
disputent le `project.json.tmp` partagé) et vert avec. Un test qui n'a pas été vu rouge ne prouve rien.

**Le garde « dernière scène » est passé *dans* la file, celui de `setStartScene` non.** Asymétrie
voulue : un `startScene` qui nomme un fichier qu'une autre fenêtre a supprimé, `openProject` s'en
rabat ; un projet à zéro scène, non — et deux fenêtres supprimant chacune une des deux dernières en
voyaient chacune deux.

**Pour T-050 : `writeProject` est un sixième site** du motif `.tmp` + `rename`, et son nom temporaire
est fixe — c'est sûr uniquement parce que la file interdit deux écrivains. À noter quand le module
partagé arrivera.

**Hors périmètre, trouvé en chemin : `writeSceneFile` a la même course, et elle n'est pas couverte.**
Deux `createScene('Boss')` concurrentes passent toutes deux `requireFree` (le fichier n'existe encore
pour personne), écrivent le même `Boss.scene.json.tmp` et l'une des deux est perdue en silence. Ce
n'est pas `project.json`, donc pas T-022 ; ça demande un verrou par chemin ou un `O_EXCL`.

**T-021 : l'audit s'est trompé sur `engineVersion`, et il faut le savoir avant de relire le PLAN.**
`PLAN.md` et la tâche le donnaient « écrit et jamais lu ». Il **est** lu :
`packages/editor/src/shell/ProjectSettingsDialog.tsx:108`, champ « Engine version », depuis le premier
commit. Ce qui était faux, c'est la description du champ (« last wrote ») : seul `createProject` le
posait, donc il nommait le build qui avait *créé* le projet. Décision assumée : gardé, et rendu vrai —
`writeProject` l'estampille. Un champ qui promet et ne tient pas est pire qu'un champ absent.

**Le prix de l'estampille : une ligne qui bascule entre deux builds différents.** Deux personnes sur
0.2.0 et 0.2.1 se renvoient la ligne à chaque écriture de `project.json`. Accepté : une écriture est
déjà un diff délibéré (changement de scène de départ, sauvegarde de réglages, suppression qui déplace
`startScene`), la ligne y est exacte, et « ne pas salir en *lisant* » — la règle que T-017 et T-020
tiennent — porte sur les lectures, pas sur les écritures.

**`writeProject` mute l'objet qu'on lui donne.** Volontaire : les trois appelants (`scenes.ts` ×2,
`ipc.ts`) renvoient ce même objet au renderer juste après. Écrire une copie estampillée aurait laissé
la fenêtre afficher une version et le disque en porter une autre.

**Les sept dossiers ne sont pas testés par leurs noms.** Le test compare `readdir(assets/)` à
`new Set(Object.values(ASSET_KIND_INFO).map(i => i.directory))` — dérivé des deux côtés. Nommer les
sept aurait recréé la liste déclarée qu'on venait de supprimer ; ce qui doit tomber, c'est le jour où
quelqu'un retape une liste dans `project.ts`. Les trois qui manquaient (`prefabs`, `shaders`, `audio`)
sont dans le commentaire, pas dans une assertion.

**Deux `.gitignore`, et c'est voulu.** Racine (`.studio/`) : celui de l'auteur, qu'il éditera, et sans
lequel un projet mis dans git commite son cache. `.studio/.gitignore` (`*`) : la garantie de l'éditeur
sur son propre dossier, qui tient encore si la racine est réécrite ou le cache copié ailleurs. Le
second ne couvre pas le premier cas : git ne regarde pas dans un répertoire que rien ne lui demande de
suivre.

**T-020 : la migration lit le disque, pas le registre que le fichier portait.** Le format 1 adressait
la scène de départ par chemin et la scène de chargement par nom ; les résoudre demande la liste des
scènes, et c'est `discoverScenes` qui la donne — pas la clé `scenes` du fichier, qui pouvait déjà être
périmée le jour où elle a été écrite. Conséquence pratique : une scène ajoutée ou supprimée dans le
Finder depuis se migre aussi bien qu'une qui n'a jamais bougé.

**Le `discoverScenes` de la migration est dans la branche, pas avant.** `saveScene` et `readSceneFile`
passent par `readProjectFile` à *chaque* sauvegarde : un projet à jour ne doit pas parcourir un
répertoire pour s'entendre dire qu'il est à jour. Un projet ancien marche deux fois à l'ouverture (ici,
puis dans `openProject`) — l'index de T-019 en fait deux `stat` à chaud. Faire passer `scenes` en
paramètre aurait touché les 7 appelants de `readProject` pour ça.

**Migré en mémoire, tamponné, jamais réécrit.** Même route que la clé `scenes` de T-017 et que
`migrateScene` dans `core` : la version est estampillée sur l'objet, et la forme migrée atteint le
fichier à la prochaine écriture faite pour une autre raison. Le test « ne réécrit pas le fichier en le
lisant » vaut donc aussi pour un projet migré, et il est épinglé.

**Une référence qui ne résout rien est laissée telle quelle.** Lever aurait remis en place, par une
autre porte, exactement le refus que la tâche supprimait : le fichier nommé a pu être supprimé dans le
Finder, et `openProject` se rabat sur la première scène.

**La fixture format 1 est écrite à la main, et c'est le fond du test.** Pas
`PROJECT_FORMAT_VERSION - 1` avec les fabriques courantes : une fixture qui suit la forme courante
cesse d'être un vieux fichier le jour où la forme bouge — précisément le jour où ce test doit tomber.
Elle porte donc `version: 1` en dur, un chemin dans `startScene`, un nom dans `loadingScene`, des
chemins dans le profil de build, et **ni `batching` ni `basePath`**, qui n'existaient pas encore.

**T-019 : les mesures, pour qu'on n'ait pas à les refaire.** Sur 3000 assets et 20 scènes de 3000
entités (24 Mo de JSON de scène) :

| | sans index | à chaud | après renommage d'un fichier |
|---|---|---|---|
| `scanAssets` | 391 ms | 111 ms | 120 ms |
| `discoverScenes` | 78 ms | < 1 ms | — |

Le premier scan est **plus lent** qu'avant (284 ms → 391 ms) : il écrit l'index en plus. Tous les
suivants font moins de la moitié. Un scan qui ne trouve rien de changé n'écrit rien.

**Ce qui reste dans les 111 ms** : deux `stat` par asset (celui du fichier, dont le manifeste porte la
taille et la date, et celui du sidecar, qui dit si ce qu'on a lu tient toujours), plus la construction
de 3000 objets de manifeste et deux `relative()` par asset. Les deux `stat` sont irréductibles tant
qu'on veut détecter à la fois un fichier modifié et un sidecar modifié. Si on veut descendre plus bas
un jour, c'est le JS du walk qu'il faut regarder, pas les I/O.

**`builtBy` n'est pas décoratif.** L'index est jeté si la chaîne ne correspond pas, et elle contient
`ENGINE_VERSION` **en plus** de `ASSET_META_VERSION`. Raison : `readAssetMeta` fusionne
`defaultSettings` dans ce qu'il renvoie, donc **les mêmes octets donnent une valeur différente dans un
build qui a ajouté un réglage**. Sans le numéro de version de l'app, un index survivant à la mise à
jour servirait l'ancienne forme pour toujours. Toute donnée dérivée mise en cache doit nommer ce qui
l'a dérivée — c'est la règle générale que cet incident illustre.

**Le cache évite une lecture, jamais une réparation.** Seul un sidecar trouvé *déjà à jour* est mis en
cache. Un sidecar absent ou périmé repasse par `readOrCreateMeta`, donc `claimAssetMeta` et sa
convergence par `link()` sont intactes — `upgradeContracts.test.ts` vert 6 fois sur 6, et un nouveau
test épingle que trois scans concurrents s'accordent **à chaud comme à froid**.

**En cas de doute sur un index : supprimer `.studio/`.** C'est la réponse, pas un contournement. Testé
et vérifié au harnais : ids d'assets et de scène identiques après suppression et réouverture.

**T-018 : ce qui reste dans `scenes.ts`, et pourquoi.** Les quatre invariants sont traités. Trois
étaient au service de la copie de `scenes/` que tenait `project.json` : le pruning des profils de
build et le nettoyage de `loadingScene` sont **supprimés**, parce que les deux devaient de toute
façon tolérer un id sans fichier — une suppression dans le Finder ne passe jamais par ce module. Une
fois la tolérance obligatoire, refaire le travail dans le seul chemin qui s'exécute parfois n'achète
rien, et c'est cette moitié-là qui pourrit. `startScene` est **conservé** : plus pour tenir une liste
(`openProject` se rabat tout seul) mais pour que `project.json` continue de dire quelque chose de
vrai. Une suppression qui ne le déplace pas n'écrit désormais rien du tout.

Les deux règles qui survivent n'ont jamais porté sur une liste : **noms uniques** (un script peut
nommer une scène) et **la dernière scène reste**. Cette dernière est une propriété d'`openProject`,
pas d'un registre : c'est le seul refus qui empêche l'éditeur de produire un projet qu'il ne sait
plus rouvrir. Le Finder peut toujours le faire — mais lui le dit à l'ouverture suivante, en une
phrase ; une action de menu confirmée qui casse un projet, non. Vérifié au harnais : l'entrée
« Delete Scene » est désactivée à une scène, **et** l'IPC refuse.

**La boucle de point fixe de `toSceneName` a plus d'objet qu'avant**, contrairement à ce que la tâche
laissait envisager. Mesuré : `Boss.json` écrit tel quel donne `Boss.json.scene.json`, qui se relit
`Boss` ; `Boss.scene.json` donne `Boss.scene.json.scene.json`, qui se relit `Boss.scene`. Comme le
chemin est maintenant la seule source du nom, ce n'est plus une étiquette qui diverge d'un fichier,
c'est la scène qui s'appelle autre chose que ce qui a été demandé. Épinglé par un test.

**`sceneRegistry.test.ts` → `sceneOperations.test.ts`.** Il portait le nom d'un registre disparu.

**Ce que T-018 n'a pas fait, et qui reste discutable.** `SceneChange` porte encore `project` pour les
trois opérations qui ne l'écrivent pas (create, duplicate, rename). Le type serait plus vrai s'il
distinguait « opérations qui touchent `project.json` » et « opérations qui n'y touchent pas » — mais
ça change `onProjectChanged` et le store de l'éditeur, pour un gain de typage seul. Laissé tel quel.

**T-017 a laissé beaucoup moins à T-018 que prévu.** La fonte a commencé d'elle-même : trois des
quatre invariants n'avaient plus d'objet une fois la liste devenue le répertoire, et les retirer était
la tâche. `scenes.ts` est passé de 263 à ~300 lignes — plus long, pas plus gros : le code a diminué,
les commentaires expliquant *pourquoi* chaque invariant est parti ont augmenté. Ce qui reste vraiment
à faire dans T-018 : décider du sort de la dernière scène (le disque ne l'interdit plus), et vérifier
la boucle de point fixe de `toSceneName` — elle a **plus** d'objet qu'avant, pas moins, puisque le nom
se relit maintenant depuis le chemin à chaque découverte.

**Le nom vient du chemin, donc renommer déplace le fichier.** C'est la conséquence non écrite de
« `name` — dérivable du chemin » et elle est structurante. Elle inverse une moitié d'ADR-15 : les
*références* ne bougent toujours pas (ce sont des ids), mais le *fichier*, si. Et elle oblige la
fenêtre qui montre la scène à se recibler (`retarget`) après un renommage — sans ça, la sauvegarde
suivante réécrit l'ancien fichier et on se retrouve avec deux scènes. Vérifié au harnais.

**`freePathFor` a disparu, et c'est voulu.** Chercher `Boss 2.scene.json` quand `Boss.scene.json` est
pris n'avait de sens que tant que le nom vivait dans `project.json` et pouvait diverger du fichier.
Maintenant un nom pris *est* un chemin pris : on refuse. Le test « finds another file when the obvious
one is taken » est devenu « frees the file when a scene is renamed away from it » — le comportement
inverse, et le bon.

**Deux fichiers, un id : le premier par ordre de chemin gagne.** `SceneEntry.shadowedBy` porte le
chemin du gagnant sur le perdant. Trois lecteurs réels : le menu Scene (ligne désactivée),
`ProjectSettingsDialog` (radio désactivé + mention « duplicate id »), `PackageDialog` (filtré). Le
fichier perdant reste listé — un fichier qui contient du travail et qui a disparu de l'éditeur est
bien plus dur à retrouver qu'une ligne avec sa raison à côté.

**Le tri est en unités de code, pas `localeCompare`.** « Le premier » doit être une propriété du
projet, pas de la machine qui le lit.

**La version de format reste 2.** Un projet format 2 garde exactement le sens de chacune de ses
références ; le seul champ parti est celui que plus rien ne lit. Bumper aurait refusé des projets qui
s'ouvrent correctement — c'est précisément l'échec que T-020 existe pour supprimer. La clé `scenes`
est retirée de l'objet en mémoire, pas du fichier : lire un projet ne le réécrit pas (test épinglé),
donc elle quitte `project.json` à la prochaine écriture faite pour une autre raison.

**Un `.scene.json` sans id est adressé par son chemin.** Un fichier écrit à la main ne porte pas
d'identité ; l'adresser par où il est dit exactement ça — une référence que son prochain déplacement
cassera. Mieux que de refuser de le lister.

**Un profil de build qui nomme une scène absente est un avertissement d'export**, plus une erreur.
Mais un profil dont *aucune* scène ne résout lève encore : le player charge `scene.json` avant tout le
reste, et un dossier sans lui est une page noire, pas un message.

**T-016 laissait un test rouge une fois sur deux** — `componentTables.test.ts`, « survives a round trip
through the file ». `serializeScene` trie les clés depuis T-016, donc deux composants d'un même type
ressortent d'un fichier dans l'ordre de leurs ids, qui sont aléatoires ; le test épinglait l'ordre
d'ajout. `componentsOf` documentait déjà que cet ordre-là ne veut rien dire. Corrigé dans son propre
commit (`9db6017`), avant T-017, parce que « vert à chaque commit » ne peut pas être un tirage au sort.

**`docs/` ne se commite pas.** Décision du propriétaire du dépôt : le chantier vit dans l'arbre de
travail, pas dans l'historique. Un `STATE.md` modifié et non commité est donc l'état normal — ce n'est
pas un oubli à rattraper.

Le plan complet est dans `PLAN.md`, la boucle dans `README.md`.

**Ce que T-002 a révélé.** Trois erreurs réelles dormaient dans les tests des apps, et une seule était
une négligence de typage (`asset.path` sur un indice non vérifié). Les deux autres étaient la même
faute : un objet de configuration recopié à la main au lieu de sortir de sa fabrique. `sceneRegistry`
écrivait un `BuildProfile` complet, et il est devenu faux le jour où `basePath` a été ajouté — sans
que rien ne le dise, puisque ces fichiers étaient hors de portée de `tsc`. La règle « remplir depuis la
fabrique du type, jamais depuis une seconde liste » vaut aussi dans les tests ; c'est même là qu'elle
se paie le plus tard.

**Ce que T-003 laisse à T-004.** La source commune est `workspace-aliases.ts`, à la racine. Elle
exporte `WORKSPACE_PACKAGE_NAMES`, `WORKSPACE_PACKAGES`, `workspaceAliases` (les entrées Vite),
`threeWebgpuAlias` et `WORKSPACE_TSCONFIG_PATHS` — c'est ce dernier que le test compare à
`tsconfig.base.json`. T-004 résout les alias : `workspaceAliases` porte des `RegExp`, mais
`WORKSPACE_PACKAGE_NAMES` est probablement la forme la plus commode pour construire le graphe.

**Un dossier `test/` existe maintenant à la racine**, ajouté à l'`include` de `vitest.config.ts` et à
celui de `tsconfig.json`. C'est la maison que T-004 réclame pour le test d'architecture : il n'y a plus
qu'à y déplacer `packages/runtime/test/package-boundary.test.ts`, pas à créer l'emplacement.

**`three` est aliasé vers `three/webgpu` sous Vitest depuis T-003.** Les 755 tests passent inchangés —
aucun n'importait `three` nu, seuls les addons de three le font. Si un test se met à échouer sur un
`instanceof` ou sur un matériau, c'est cette ligne qu'il faut regarder d'abord : elle est correcte, et
elle rend visible une divergence qui existait déjà en production.

**T-004 : il y a quatre cycles, pas deux.** À corriger dans `PLAN.md` D6 quand on y repassera. Les deux
que l'audit avait vus à la main sont réels et confirmés. Les deux autres n'avaient jamais été vus parce
que rien n'avait jamais construit le graphe :

| Cycle | Nature | Ferme en |
|---|---|---|
| `ImportPipeline ↔ ImportSession` (`apps/desktop/src/main/import/`) | `import type` dans un sens | — non planifié |
| `viewportHost → EditorViewport → sceneFiles → projectStore → viewportHost` | **valeurs**, le seul vrai | lot 4 |
| `importStore → plan → settingsPane → PaneBinder → assetField → importStore` | valeurs + types | lot 3 |
| les quatre `import/preview/*` | `import type` + un `import()` dynamique | — non planifié |

Les deux non planifiés sont **bénins** : effacés à la compilation ou différés, ils n'ont jamais rien
coûté à l'exécution. C'est pour ça qu'ils ont survécu. Ils sont dans la liste de dette de
`test/architecture.test.ts` — les retirer de la liste sans les casser fait échouer le test autant que
d'en ajouter un cinquième.

**Le scan regex lisait des spécificateurs dans des chaînes.** Cinq dans le repo, dont les deux littéraux
de gabarit de `apps/desktop/src/main/scripts.ts` qui *engendrent* un script utilisateur : l'app desktop
avait l'air d'importer `@three-studio/runtime` alors qu'elle ne fait qu'écrire cette ligne dans le bundle
de quelqu'un d'autre. Le nouveau motif ancre la déclaration en début de ligne. Le piège du délimiteur que
l'ancien commentaire décrivait est donc clos par construction, mais il vaut toujours d'être connu.

**Le test vit dans `test/architecture.test.ts`**, pas dans `tools/` comme le suggérait `PLAN.md:790` —
`test/` existait déjà depuis T-003 et est câblé partout. `packages/runtime/test/package-boundary.test.ts`
est supprimé ; ses deux assertions survivent, l'une absorbée par la règle de couches, l'autre gardée à
part (`core` ne nomme que `.` et `node:`, plus strict que la couche).

**T-005 a touché `packages/core`, que la liste de fichiers de la tâche ne mentionnait pas.** C'était
inévitable : « `ADDABLE` dérivé du registre » exige un champ dans le registre, et il n'y en avait aucun
qui distingue `model` et `prefabInstance` des dix autres. Ajouté comme `addable: boolean` sur
`ComponentDefinition`, à côté de `runtime`, avec `addableTypes()` dérivé exactement comme
`typesWithoutRuntime()` — le précédent était déjà dans le fichier. Les douze modules répondent.

**Changement visible dans l'UI** : le menu Add suit maintenant l'ordre d'enregistrement. `water` passe
de 2ᵉ à dernier, `script` de dernier à 8ᵉ. C'est le prix de la dérivation, accepté. Si l'ordre du menu
redevient une décision, elle se prendra ailleurs que dans une liste recopiée.

**Sentinelles** : `FALLS_THROUGH` (`Number.POSITIVE_INFINITY`) dans `ICON_PRIORITY`, `null` dans
`STYLES`. `mesh` a l'icône `shapes` mais tombe volontairement sur la boîte générique dans la hiérarchie
— rendre la table totale sans sentinelle aurait changé l'icône de toutes les lignes de mesh.

**Pas touché, et volontairement** : `MUTUALLY_EXCLUSIVE` (`commands/sceneCommands.ts:395`) est un
`Partial<Record>` où l'absence veut dire « n'exclut rien ». C'est un défaut total et correct, pas un
oubli possible. Autre classe de problème.

**`markerStyles.RENDERABLE` est un `Record` total à lui, pas une dérivation de `STYLES`** comme le
suggérait le tableau de la tâche : « dessine de la géométrie » et « mérite un marqueur » sont deux
questions, et `Record<ComponentType, MarkerStyle | null>` ne peut pas répondre à la première. Deux
tables totales, conformément à « on rend les tables totales, on ne les fusionne pas ».

**T-006 : les deux contrôles que la tâche demandait ne détectent pas la panne qu'elle demandait de
détecter.** « Échoue si le probe rapporte une erreur renderer ou un canvas de taille nulle » — mesuré :
en retirant `renderer.render`, le canvas garde 1904×1202, il n'y a aucune erreur, et **les FPS montent
à 120** parce qu'il n'y a plus rien à dessiner. Le seul nombre qui tombe est le compte de draw calls.
C'est donc lui qui est asserté, via `viewportStore` (ce que `WebGPURenderer.info.render` a rapporté au
dernier tick). Vérifié rouge : verdict `drew-nothing`, `drawCalls: 0`, `triangles: 0`.

**Deux démarrages, pas un.** Le harnais a besoin d'un projet sur disque avant d'ouvrir une fenêtre
d'édition, et rien hors d'Electron ne peut en écrire un : `createProject` passe par `recentProjects`,
qui importe `electron`. Le launcher le fabrique via `project:create` — le même IPC que son propre
bouton, qui n'ouvre aucune fenêtre et ne détruit donc pas la page où tourne le setup.

**Les scripts de setup renvoient un verdict, ils ne lèvent pas.** Une exception dans le setup coupe la
course avant `capturePage` : la seule exécution dont la capture aurait de la valeur serait la seule
sans capture. Le job lit le verdict dans le log.

**`STUDIO_SMOKE_SOFTWARE_GPU`** (nouveau, `apps/desktop/src/main/index.ts`) pose les commutateurs
SwiftShader. Séparé de `STUDIO_SMOKE` exprès : forcer le rendu logiciel sur une machine qui a un GPU
mesurerait autre chose. `electron-vite` n'a pas de passe-plat pour les drapeaux Chromium — d'où le
passage par `app.commandLine`.

**Découverte au passage** : le launcher a lui aussi un canvas (864×1200). Un contrôle « il y a un
canvas » ne prouve donc rien sur le viewport, même en mode launcher.

### Ce que T-006 n'a pas pu vérifier

Vérifié en local sur macOS, GPU logiciel compris : les drapeaux reproduisent exactement le chemin CI
(`backend: webgl`, 4 FPS, 6 draw calls, capture d'une vraie scène), et les deux corps d'étape du
workflow tournent tels quels sous `bash`. **Restent inconnus, et seuls un runner peut répondre :**

- `xvfb-run` est-il présent sur `ubuntu-latest` (attendu oui, non vérifié)
- Electron trouve-t-il ses bibliothèques système et son bac à sable Linux (`--noSandbox` est passé)
- le critère « le job passe sur une PR » — **non coché**, rien n'a été poussé

Si le job échoue au premier passage, regarder d'abord ces trois-là, pas la logique du check.

**T-007 : les deux divergences annoncées sont latentes, pas actives.** Mesuré, pas supposé.

- Le `default:` du `switch` ne concernait que `rigidbody`, `audioListener` et `prefabInstance` — et
  aucun des trois ne déclare de ligne conditionnelle aujourd'hui. Le piège était réel, la panne pas
  encore.
- `sceneSignature` ne consultait pas `section.visibleWhen`, mais la seule section qui en a une lit
  `backgroundMode`, qui était dans la liste manuelle. Couvert par chance.
- Sur `rectArea`, la case `castShadow` est bien cachée (`isLightKind` ne la nomme pas), **mais**
  `casts()` sans arguments ne teste que `castShadow`. Basculer `castShadow` change donc bien la forme,
  même sur une `rectArea`. Ma première version du test affirmait le contraire : c'est le test qui avait
  tort, pas le code.

**Bug trouvé au passage, hors périmètre — pour le lot 3b (T-038 → T-041).** Une lumière avec
`castShadow: true` passée en `rectArea` (ou `ambient`, `hemisphere`) affiche les six lignes d'ombre
**sans la case qui permettrait de les enlever** : `casts()` (`schema.ts:206`) ne teste que
`castShadow`, alors que la case elle-même est conditionnée au `kind` (`:633`). Atteignable en changeant
le `kind` d'une lumière qui projetait. Le commentaire de `casts()` dit « la case est toute la
condition » — elle ne l'est plus depuis que la case est elle-même conditionnelle.

**Une seule différence de comportement dans T-007** : un `model` ne reconstruit plus son panneau quand
on lui lie un matériau. Le `switch` portait `model:${materialId}`, copié du bras `mesh` où ça change
deux boutons — un `model` n'en a aucun. Tous les autres champs structurels du `switch` discriminent
toujours, vérifiés un par un.

**T-008 : le champ seul, aucun consommateur.** `batching: boolean` dans `RenderingSettings`,
`true` dans `createRenderingSettings()`. Le commentaire périmé d'`Engine.ts:135` (« allumé pour un jeu,
éteint dans l'éditeur ») **est toujours là et toujours faux** — c'est T-009 qui le corrige en câblant le
champ. Ne pas s'en alarmer en lisant le code entre les deux.

Critère « un `project.json` écrit avant ce champ obtient `batching: true` » : asserté sur le test dont
la fixture est un bloc `rendering` complet *de sa version*, ce qui est exactement la forme qu'un
réglage ajouté plus tard doit traverser. Vérifié non vacant : en passant le défaut à `false`, le test
tombe.

**Piège d'outillage à connaître** : `packages/editor/src/state/documentStore.ts` contient un octet NUL
**volontaire** (`patch.path.join('\0')`, `:375`) comme séparateur non ambigu. Conséquence : `file` le
voit comme « data » et **`grep` le saute en silence**. Utiliser `grep -a` sur ce fichier. Ce n'est pas
une corruption, ne pas « réparer ».

**T-009 : les trois modes disent 4096, mesuré et non déduit.** Sur un projet réglé à 4096, au
harnais : `binder.shadowMapSize` et le `shadow.mapSize` de la lumière liée valent 4096 dans la vue
Scene ; les mêmes deux valent 4096 en Play (`playState: playing`, aucune erreur renderer) ; le build
exporté par l'app, servi et ouvert dans Chrome, rapporte 4096 sur sa lumière directionnelle. La
lecture dans le build a demandé une sonde : le player n'expose ni scène ni moteur sur `window`, donc
un `Behaviour` écrit à la main dans une copie du build (`scripts.mjs` + un composant `script` sur la
lumière dans `scene.json`) lit `this.transform` et le journalise. C'est le seul angle depuis
l'extérieur ; à refaire si un jour on remesure.

**Le champ `batching` du binder perd son setter, et deux tests le pilotaient.** Aucun code produit ne
le changeait après construction, mais deux tests de `sceneBinder.test.ts` le basculaient à chaud :
« gives it back » et « batches again after batching is turned off and back on ». Réécrits vers les
portes qui existent encore :

- le retour d'un membre dans le raycast passe maintenant par un départ de groupe (`castShadow` est
  dans la clé de batch, et un cube seul est sous `MIN_BATCH_SIZE`), pas par une extinction ;
- « rallumé » devient « un projet avec `batching: false` dessine chaque mesh lui-même », qui est la
  question que le produit pose désormais.

Vérifiés non vacants tous les deux, en cassant le code sous eux. Attention au piège en les lisant :
`MIN_BATCH_SIZE` est un seuil de **création** — un groupe qui passe dessous **garde** son batch, donc
« supprimer un cube sur quatre » ne démonte rien. Le `clear()` de `MeshBatcher.sync` n'est plus
atteint que sur un binder qui n'a jamais batché, où il ne fait rien ; il n'a pas été retiré.

**Le helper `binderWith` monte un binder qui ne batche pas**, alors que `createRenderingSettings()`
dit `batching: true`. Délibéré et commenté : les tests hors des blocs de batching interrogent l'objet
qu'un composant mesh a construit, et un mesh batché est caché et dessiné par autre chose. Les trois
tests éditeur (`picking`, `overlay`, `selectionOutline`) prennent au contraire les réglages d'usine,
donc batching allumé comme dans le vrai viewport — ils passent, ils bindent moins de quatre meshes
identiques.

**`EditorViewport` construit son binder dans le constructeur, pas en initialiseur de champ.** Un
initialiseur de champ tourne avant que le constructeur ait appris quoi que ce soit, ce qui est
exactement pourquoi ces réglages étaient assignés à un binder déjà fini, une instruction à la fois.
`binder` et `overlay` sont donc déclarés sans initialiseur.

**T-010 : le fond `#2b2f33` du viewport était une seconde source de la même constante.**
`bindScene` finit par `syncEnvironment`, qui écrit `scene.background` depuis le document, et
`createEnvironment()` répond déjà `#2b2f33`. La ligne codée en dur était donc morte dès que la
projection binde un document ; elle est supprimée. Mesuré, pas déduit : la projection construite sans
renderer rapporte `0x2b2f33`.

**La projection binde le document à la construction, et `lastSeen` reste à zéro.** Ce n'est pas un
oubli. La première passe de la boucle de frame est ce qui enregistre `lastSources` ; la sauter
laisserait les ids produits par une instance de prefab inconnus de l'édition suivante — exactement le
bug que `expandDirty` existe pour éviter. Le coût est un `sync` complet redondant au démarrage, qui ne
reconstruit rien (le reconciler compare des identités, et l'expansion rend les mêmes objets).

**`TransformGizmo` est le seul des six groupes que la projection laisse vide.** `TransformControls`
exige un canvas, donc `EditorViewport` y parente `gizmo.helper` et `gizmo.pivotObject` après coup. Le
nom est quand même posé par la projection : un overlay qui manque *seulement* quand personne ne tient
une souris est pire qu'un groupe vide.

**`bindScene` et `SceneBinderOptions` sont maintenant exportés du baril du runtime.** L'éditeur
importait `SceneBinder` par là ; il lui faut les deux autres, et `EditorProjectionOptions` étend
`SceneBinderOptions` plutôt que de recopier ses cinq champs.

**Ce que T-010 laisse à T-011.** `createEditorProjection({ scene, resolver, rendering, … })` a
volontairement la forme de `EngineOptions` : `scene` est le `SceneDoc`, requis, et `renderer` reste
optionnel — c'est le typage qui dit « appelable sans GPU ». Les six overlays sont ajoutés à la `Scene`
**dans l'ordre d'`EDITOR_OVERLAYS`**, après `binder.root` que `bindScene` y met : `scene.children`
moins la racine du binder est donc exactement la constante, sans tri. Vérifié sous Node et au harnais.

**T-011 : le digest mesure ce qui est arrivé sur un objet, pas ce qui est posé sur un champ.**
C'est la bonne question et il faut le savoir avant de s'en servir. Vérification de non-vacuité menée
en reproduisant le monde d'avant T-009 — binder par défaut à 2048, éditeur qui écrit la valeur du
projet — et **la première reproduction est passée au vert** : en assignant `binder.shadowMapSize`
*après* `bindScene`, le `sync` avait déjà écrit 2048 dans la lumière, donc les deux modes
s'accordaient. C'est en l'assignant *entre* la construction et le premier `sync` — ce que
`EditorViewport` faisait réellement avant T-009 — que le test tombe, sur
`lights[0].shadowMapSize` : `[4096,4096]` contre `[2048,2048]`. Le digest lit `light.shadow.mapSize`,
jamais `binder.shadowMapSize`, parce qu'un champ qui n'a atteint aucun objet ne dessine rien.

Deuxième vérification, gratuite : en privant Play de la bibliothèque de matériaux, le cube lié rend
son matériau embarqué gris là où la vue Scene rend le laiton. C'était l'autre moitié de la même classe
de bug, et elle est couverte.

**`Engine.create` tourne sous Node avec quatre lignes.** `window`, `document` et le `domElement` sont
un seul objet portant `addEventListener` / `removeEventListener` — `Input` n'en relit jamais rien sur
ce chemin. `enablePhysics: false` saute Rapier, omettre `audioContext` est un jeu sans son. C'est le
premier test du dépôt à construire un `Engine`, et rien en production n'a été touché pour le rendre
testable.

**`BatchedMesh.type` vaut `'Mesh'`** — three ne le surcharge pas. Le champ `batch` du digest est ce
qui les distingue, et il le fait mieux : remplacer le batch par un `InstancedMesh` laisserait `batch`
à `null`.

**`pools.materials` vaut 1 pour cinq cubes plus un lié, et c'est correct** — seul le cas lié est mis
en pool (`MeshSystem.materialFor`), un matériau embarqué appartenant à son mesh. Ne pas le lire comme
une anomalie en découvrant le digest.

**Ce que T-011 laisse aux suivants.** `packages/runtime/test/sceneDigest.ts` est un helper de test
sans appelant en production, et il n'est complet que de ce qu'il nomme : ajouter un champ à une
projection sans l'ajouter au digest le laisse hors du `toEqual`. Le sens de lecture est donc
« un overlay nouveau va dans `EDITOR_OVERLAYS`, une propriété nouvelle va dans le digest ».

**T-012 : les quatre critères sont mesurés au harnais, pas déduits.** Sur un projet neuf, les
lumières retirées de la scène de départ : la boîte de stats affiche
`Backend · WEBGPU · … · Lighting · Editor default`, Play rapporte la phrase exacte du warning et le
Game panel la rend dans son `<li>`, et un `undo` fait disparaître les deux. Les draw calls passent de
6 à 5 : la paire de secours remplace deux lumières réelles, ce qui est aussi la preuve qu'elle s'est
allumée.

**Le prédicat est partagé, et sa formulation est délibérée.** `Engine.checkLighting` demande
`entitiesWith(scene, 'light')`, exactement la question que `EditorViewport` pose pour allumer la
paire — et sur la scène **étendue** des deux côtés, puisque `SceneHost` étend avant `Engine.create`.
Conséquence à connaître : une scène éclairée **uniquement par un HDRI** (`environmentMode: 'texture'`
avec une image) n'a aucun composant `light`, donc elle reçoit la paire de secours *et* s'entend dire
« renders black », ce qui est faux de la première phrase. La seconde reste vraie, et c'est celle qui
porte le sujet. Séparer les deux conditions ferait diverger le warning de la paire qu'il décrit ; si
on veut le corriger un jour, il faut déplacer **les deux** en même temps. Le défaut d'un projet neuf
est `environmentTexture: null`, donc le cas courant est bien noir.

**Rien n'a été ajouté aux tests.** Le contrôle est comportemental et il vit dans le harnais ; le
script utilisé est jetable (scratchpad), pas un fichier du dépôt. `packages/editor/test/parity.test.ts`
couvre déjà l'autre moitié — la paire est un overlay et ne fuit pas dans `binder.root`.

**T-013 : le viewport a trois canvas, et un seul reçoit des pixels.**
`surface` (le canvas du renderer, dans aucun document) plus un `Presentation`
par panneau. Le renderer dessine chaque vue dans le **coin haut-gauche** de la
surface via `setViewport`, et chaque panneau recopie son propre rectangle au
`drawImage`. La surface fait la taille du **plus grand** panneau visible :
la redimensionner par vue ferait deux `setSize` par frame, donc deux
destructions de la cible de tone mapping — précisément ce que
`retireFrameBufferTarget` ramène à une par resize.

**Le coin haut-gauche est le même dans les deux backends, et c'est vérifié, pas
supposé.** `Renderer._renderScene` recopie le viewport du canvas sur le
`frameBufferTarget` (`Renderer.js:1490-1509`), donc le viewport *est* respecté
malgré le tone mapping ; la passe de sortie échantillonne en `screenUV =
fragCoord / drawingBufferSize`, donc le rectangle retombe pixel pour pixel au
même endroit. Le backend WebGPU passe le viewport tel quel (origine haut-gauche)
et le fallback WebGL le retourne (`renderContext.height - height - y`) : les deux
s'accordent sur le haut-gauche. Mesuré sur les deux, panneaux de hauteurs
différentes (952×255 et 952×352, surface 1904×704 en pixels physiques).

**Ce que le viewport ne fait plus, et ce qu'il fait en plus.** Pendant Play, la
vue Scene est une vue **du document** : elle `syncDocument` et se dessine à
chaque frame — un fond repeint en rouge pendant la partie arrive dans la Scene
et pas dans le jeu, vérifié. Mais le gizmo, lui, ne tourne plus du tout tant
qu'un moteur existe : `gizmo.update` finit par `helper.visible = true`, donc le
laisser tourner rallumait à l'écran des poignées que `beginPlay` venait
d'éteindre. (Le même ordre `setEnabled` puis `update` fait déjà réapparaître les
poignées pendant un déplacement de caméra ; c'est antérieur, non touché, et
c'est une question à part.)

**Un panneau que personne ne regarde a une boîte de taille zéro et n'est pas
dessiné.** C'est la même réponse qu'avant — un onglet caché ne recevait pas le
canvas — mais obtenue en mesurant plutôt qu'en regardant qui tient le canvas.
Conséquence : avec la disposition par défaut (Game est un **onglet** au-dessus
de Scene), Play met le Game devant et la vue Scene n'est plus dessinée. Pour
voir les deux, il faut séparer les panneaux ; `PANEL_DEFS` n'a pas été touché.

**La boîte de stats compte les deux vues** : three remet `info` à zéro une fois
par frame d'animation, pas par `render`. Inchangé pour une frame qui n'a dessiné
qu'une vue.

**Chaque panneau porte ses propres entrées** : le pointeur de l'éditeur sur le
canvas de la vue Scene, l'`Input` du moteur sur celui du Game. Ils se
partageaient un élément et devaient donc se céder le tour. `data-view="scene"`
et `data-view="game"` sont posés sur les canvas pour que le harnais puisse les
distinguer ; c'est leur seul usage.

**Le harnais a servi de preuve, deux fois.** `__studioRenderProbe` (arm/mark/
report) rapporte **0 erreur** `Destroyed texture … used in a submit` : 4,2 s en
WebGPU, 17,6 s en WebGL logiciel. Attention, il est publié par
`EditorViewport.create`, donc **après** la demande de device — sur GPU logiciel
c'est bien au-delà des 3 s que le harnais attend avant de lancer le setup : un
script qui l'attrape à l'aveugle échoue sur `reading 'arm'`. Attendre
`window.__studioRenderProbe`.

**Deux erreurs à ne pas confondre avec une régression** : un `pointerdown`
synthétique fait lever `setPointerCapture` / `releasePointerCapture` par
`TransformControls` (« No active pointer with the given id is found »). C'est le
clic simulé, pas le produit — et le clic sélectionne bien le sol, ce qui est ce
qu'il vérifiait.

**T-014 : le premier critère a deux lectures, et celle retenue est la moitié « mécanisme ».**
`shouldSkipRender` portait deux conditions, et **les deux** figeaient l'écran. Celle qui saute est
`rendererCount() > 1`, exactement celle que `PLAN.md` D2 et le jalon 2.7 nomment. Celle qui reste est
le modal : « personne ne regarde la Scene derrière un panneau opaque » est une décision mesurée et
documentée qui vaut toujours quatre mille draw calls, et ce qu'elle abandonne tient dans les neuf
pixels du liseré. Conséquence à assumer : **ouvrir un dialogue fige toujours ce liseré**. Ce qui ne
fige plus, c'est le renderer — il dessine l'aperçu pendant tout ce temps, et c'est vérifié plus bas.
Si le propriétaire voulait l'autre lecture, la ligne à supprimer est le corps entier de
`shouldSkipRender`, et il faut alors dire ce qu'on fait des draw calls.

**`rendererCount()` n'a plus aucun lecteur en production.** Il reste exporté du baril du runtime, et
le compteur plus l'enrobage de `dispose` dans `RendererFactory` n'existent que pour lui. C'est de la
dette au sens du chantier (« une pièce sans appelant, on la coupe ») — pas coupée ici parce que c'est
l'observable que le critère 2 de la tâche nomme, et que le danger qu'il décrit est réel et désormais
écrit dans `Presentation`. À trancher dans un lot tardif, pas au passage.

**L'aspect de la caméra d'aperçu s'écrit sans condition dans `resize()`**, comme celui du jeu et pour
une raison de plus : choisir un autre fichier dans la boîte d'import **échange une caméra pour une
autre sans que le panneau bouge d'un pixel**. Sous un garde `previewMoved`, la deuxième caméra
gardait le 1:1 de son constructeur. Le piège vaut pour toute quatrième vue.

**`onFrame` existe pour l'amortissement d'`OrbitControls`**, et pour rien d'autre. Un `update()` par
frame est obligatoire tant que `enableDamping` est vrai ; le faire depuis une boucle à soi remettrait
le travail hors de la frame à laquelle le rendu appartient — la faute même que le commentaire
`render()` / `renderAsync()` décrit. Ce commentaire a déménagé de `ModelPreview.start()`, qui n'existe
plus, vers `EditorViewport.draw()`, qui fait maintenant le geste.

**Le harnais a mesuré les quatre choses, sur un glTF d'un triangle écrit dans le scratchpad**
(`__studioStores.import.open([chemin])` ouvre la boîte ; le store `import` est exposé par
`devtools.ts`, ce que la fiche du harnais ne dit pas) :

| Question | Mesure |
|---|---|
| L'aperçu est-il un blit et pas un device ? | `canvas[data-view="preview"].getContext('2d')` répond non-nul |
| Y a-t-il un second renderer quelque part ? | **tous** les canvas du document rendent un contexte 2D |
| Le renderer dessine-t-il pendant le modal ? | effacé à la main → repeint entier (1 723 080 px) à la frame suivante |
| La vue Scene revient-elle après Annuler ? | effacée → repeinte entière (971 040 px), vue d'aperçu disparue |

Et `[smoke] renderer errors: none` sur toute la course, **y compris à la fermeture de la boîte** :
l'erreur unique que l'ancien commentaire de `shouldSkipRender` consignait (« exactement une, à la
première boîte d'import fermée dans une session ») était le démontage du second renderer. Il n'y en a
plus.

**Deux choses à ne pas prendre pour des anomalies en comptant les canvas.** Le document de l'éditeur
en porte un **64×64 sans `data-view`** : c'est le sélecteur de couleur de Tweakpane (`div.tp-colpv`),
antérieur et sans rapport. Et avant l'ouverture de la boîte il n'y en a que **deux**, pas trois : avec
la disposition par défaut Game est un onglet au-dessus de Scene, donc son panneau n'est pas monté —
même cause que la note de T-013.

**`ModelPreview` importe maintenant `viewport/viewportHost`.** Nouvelle arête aperçu → viewport ; elle
ne referme rien, `test/architecture.test.ts` passe et `KNOWN_CYCLES` est inchangé. `acquireViewport()`
plutôt que `peekViewport()` : un viewport sans panneau mesure une boîte nulle pour la vue Scene et
dimensionne sa surface sur ce qui reste, donc l'aperçu marche même si le panneau Scene est fermé.

**T-015 : la réponse est oui, et elle est lue dans les sources de three, pas déduite.** Rien n'a
bougé dans le produit — la tâche demandait une vérification et un endroit où l'écrire. Le seam est la
phrase qui était déjà dans le commentaire de classe d'`Engine` : le moteur ne possède ni le renderer
ni la boucle, et il rend `scene` et `activeCamera`, qui sont exactement la paire dont
`pass(scene, camera)` est fait. Il y a **deux** appels de rendu dans tout le produit —
`EditorViewport.draw` et la boucle du player (`apps/web-template/src/main.ts:254`) — et chacun est une
ligne à échanger contre `pipeline.render()`. `LauncherScene` fait déjà tourner un `RenderPipeline`
(`pass()` + `bloom()`) sur un renderer sorti de `createRenderer` : le précédent existe, l'argument
n'est pas seul.

**Le nom a changé côté three** : `PostProcessing` est déprécié depuis r183, c'est `RenderPipeline`
(three 0.185.1 ici). Un futur lecteur cherchant « EffectComposer » ne trouvera rien — c'est l'API
WebGL, elle n'existe pas sur ce chemin.

**Deux pièges consignés, avec leurs lignes de source :**

- `RenderPipeline.render()` pose `NoToneMapping` sur le renderer avant son quad, ce qui **ressemble** à
  la perte du tone mapping et de l'exposition du projet. Ils survivent : `_update()`
  (`RenderPipeline.js:179-228`) reconstruit la sortie en
  `renderOutput(node, renderer.toneMapping, renderer.outputColorSpace)` dès que l'un des deux bouge, et
  l'exposition dedans est un `rendererReference` (`ToneMappingNode.js:145`). Ce qui les perdrait
  vraiment, c'est `outputColorTransform = false` sans `renderOutput()` à soi — et ça les perdrait
  **dans un build** pendant que la vue Scene continuerait d'avoir l'air juste.
- `PassNode` dimensionne sa cible sur `renderer.getDrawingBufferSize()` (`PassNode.js:801/805`), et un
  rendu **vers une cible** prend le viewport de cette cible, pas celui que `setViewport` vient
  d'écrire (`Renderer.js:1619-1626`). Depuis T-013 la surface fait la taille du **plus grand** panneau
  visible : une passe y dessinerait donc la scène à la taille de la surface, et le quad de composition
  serait écrasé dans le coin de la vue. Un hôte à une seule vue plein canvas (le build, le launcher) ne
  rencontre jamais ça. C'est pour ça que le pipeline est **par vue**, pas par renderer.

**`PLAN.md` a reçu la ligne que la tâche demandait** (jalon 2.8, plus le verdict sous le tableau du
lot 2). C'est la seule modification de `PLAN.md` du chantier jusqu'ici ; elle ne se commite pas, comme
le reste de `docs/`.

**T-016 : `stableJson` vit dans `packages/core/src/json.ts`**, exporté du baril, et c'est lui que
`serializeScene` appelle. Pas dans `scene/serialization.ts` : les prefabs et les matériaux s'écrivent
depuis `apps/desktop/src/main/assets.ts` (quatre appels), et un utilitaire JSON n'a rien à faire sous
`scene/`. Le replacer de `JSON.stringify` reconstruit chaque objet à clés triées — c'est la seule façon
de fixer un ordre de clés — et rend les tableaux tels quels.

**Ce qui n'est délibérément pas passé par là** : les sidecars `.meta` (`writeAssetMeta`,
`assets.ts:164`). Ils sont bâtis à partir de littéraux, donc leur ordre de clés est déjà fixé par
construction, et ils portent `importedAt` plus un hash qui bougent de toute façon. Quels fichiers
appartiennent à git est la question de **T-021**, pas de celle-ci. `project.json`
(`main/project.ts:72/142`) non plus, pour la même raison — construit depuis une fabrique, ordre stable.

**Le vrai précédent est dans le runtime** : `stableKey` (`systems/geometry.ts:31`) triait déjà, et son
commentaire dit exactement la même chose depuis l'autre bout — « property order depends on which build
of the editor wrote the scene ». Les deux ne sont **pas** fusionnés : `stableKey` est une clé de cache,
à un seul niveau et jamais indentée. Ne pas les réunir en croyant supprimer un doublon.

**Un test existant est tombé, et il avait raison de tomber.** `componentTables.test.ts:226` comparait
deux documents migrés par `JSON.stringify` — une égalité profonde bon marché. Avec les clés triées, un
document fraîchement migré et le même document relu diffèrent **par l'ordre des clés et par rien
d'autre**. Il compare maintenant les deux *fichiers* (`serializeScene` des deux côtés), ce qu'il voulait
dire. C'est le seul appelant qui lisait un ordre de clés dans tout le dépôt.

**La seule conséquence visible du tri** : un ordre d'objet n'était lisible qu'à un endroit —
`components[type][entityId]`, quand une entité porte **deux composants du même type** (deux colliders ;
`componentFits` n'interdit que la paire mesh/model, pas les doublons de type). Cet ordre était
l'insertion, il devient l'id une fois le document passé par un fichier. Rien ne le lit pour du sens ;
ce qu'on y gagne, c'est que deux machines s'accordent sur lequel des deux `findComponent` appelle « le
premier ». Le commentaire de `componentsOf` disait « insertion order » : corrigé, il ne l'est plus après
un aller-retour disque.

**Critère 3 mesuré sur un vrai projet, copié hors de portée** (« Demo prototype Athena » → scratchpad,
`git init`, jamais l'original) : ouvrir et sauver sans rien toucher a donné **+340 / −339** sur
`scenes/main.scene.json` et rien d'autre. Comparaison structurelle avant/après : les **seules**
différences de contenu sont la migration qui fait son travail sur un fichier de format 8 — `water: {}`
qui apparaît et `version` qui passe à 9. Commité, puis re-sauvé : `git status` vide. Une
réorganisation, puis stable.

**Piège si on refait la mesure** : `__studioStores.project.getState().save()` est la porte (elle passe
par `saveScene` sur le pont). Attendre que `scenePath` ne soit plus `null` avant de la pousser, sinon on
sauve avant que le document soit la scène.

Une chose à savoir avant de toucher au code : **il est bon**. 737 tests, zéro `TODO`, 50 échappatoires
de typage sur 62 k lignes, et des commentaires qui expliquent le *pourquoi* à un niveau de détail rare.
Le chantier n'est pas une réécriture — c'est une série de déplacements précis. Quand un commentaire
explique pourquoi le code est comme il est, **il déménage avec le code**.

## L'ordre

Les tâches se prennent dans l'ordre des numéros, sauf indication contraire dans la tâche. L'ordre a été
choisi par bénéfice visible :

1. **T-001** le dispositif · **T-002 → T-006** le filet
2. **T-007** la dérivation de l'Inspector — autonome, corrige à elle seule la moitié
   « répond mal à l'Inspector »
3. **T-008 → T-015** la parité éditeur/jeu. **T-009 corrige `shadowMapSize`**, très probablement le
   symptôme visible à l'écran
4. **T-016 → T-022** le format de projet — tôt, parce que tout ce qui touche aux scènes en dépend
5. **T-023 → T-031** la tranche verticale — le plus gros, et ce dont tout le reste tire sa scalabilité
6. **T-032 → T-070** l'export, l'Inspector, les god objects, les contrats, la couverture, la perf,
   les commandes, la mémoire du projet

## Tableau

| Lot | Tâches | Sujet | Statut |
|---|---|---|---|
| 0 | T-001 → T-006 | Le dispositif et le filet | **6/6 ✅** |
| 3a | T-007 | L'Inspector se dérive de son schéma | **1/1 ✅** |
| 2 | T-008 → T-015 | Parité éditeur / jeu / build | **8/8 ✅** |
| 9 | T-016 → T-022 | Le format de projet | 1/7 |
| 1 | T-023 → T-031 | La tranche verticale par composant | 9/9, fuite mesurée à corriger |
| 10 | T-032 → T-037 | L'export | 6/6 |
| 3b | T-038 → T-041 (+ T-038b) | L'Inspector, le reste | **5/5 ✅** |
| 4 | T-042 → T-046 | Les god objects | **5/5 ✅** |
| 5 | T-047 → T-051 | Les contrats de frontière | **5/5 ✅** |
| 6 | T-052 → T-055 | Les couches sans tests | **4/4 ✅** |
| 7 | T-056 → T-061 | Le moteur et la performance | **6/6 ✅** |
| 8 | T-062 → T-066 | La couche de commandes | T-062a → T-062e, T-063 → T-065 faits ; restent T-066 puis T-062f |
| 11 | T-067 → T-070 | La mémoire du projet | 0/4 |

**70 tâches.** Une par commit, une MR à la fin.
