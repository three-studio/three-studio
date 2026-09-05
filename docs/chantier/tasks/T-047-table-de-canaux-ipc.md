# T-047 — Une table de canaux IPC, dérivée de `StudioBridge`
Lot 5 · dépend de T-046 · statut: **TODO**

## Pourquoi
**47 noms de canaux** sont des littéraux dupliqués entre `apps/desktop/src/main/ipc.ts` (45 `handle`
+ 2 `send`) et `apps/desktop/src/preload/index.ts`. Rien ne lie la signature d'un handler au membre de
`StudioBridge` correspondant, et chaque handler réannote ses types à la main des deux côtés :

```ts
// ipc.ts:265
ipcMain.handle('project:createScene', async (event, name: string): Promise<SceneChange> => {
// preload/index.ts:83
createScene: (name): Promise<SceneChange> => ipcRenderer.invoke('project:createScene', name),
```

Une faute de frappe est une erreur d'exécution (`No handler registered`), pas de compilation. Rien
n'assure que chaque membre de `StudioBridge` a un handler, ni l'inverse.

Le **type** est bien centralisé (`core/src/bridge.ts:268`, et le fichier dit pourquoi). C'est le
**câblage** qui ne l'est pas.

## Quoi
Une table de canaux typée depuis `StudioBridge`, d'où l'on dérive et l'enregistrement `ipcMain.handle`
et le pont preload. Un handler manquant ou une signature divergente devient une erreur de compilation.

## Attention
Trois valeurs ne passent **pas** par IPC et ne doivent pas y entrer : `windowRole` et `projectPath`
sortent de `process.argv` (`preload/index.ts:30`), `sceneId` de la query string (`:44`). La raison est
écrite aux deux endroits : `argv` est rejoué tel quel par `webContents.reload()`, donc la seule valeur
mutable doit être dans l'URL. Et `pathForFile` est synchrone (`webUtils.getPathForFile`, `:136`).

`IpcDeps` (`ipc.ts:105-122`) est injecté depuis `index.ts:27` exprès pour casser le cycle
`ipc.ts ↔ windows.ts`. Le garder.

## Terminé quand
- [ ] Supprimer un handler casse la compilation
- [ ] Ajouter un membre à `StudioBridge` sans handler casse la compilation
- [ ] Aucun nom de canal écrit deux fois
- [ ] `npm run typecheck && npm test` verts

## Commit
`refactor(desktop): the IPC channels are one table, derived from the bridge`
