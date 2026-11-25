import { isRecord } from '@three-studio/core';
import { atomicWrite } from '../atomicWrite';
import { readFound } from '../devices/settingsFile';

/*
 * `output-folders.json`, in the app's data directory: the folder each build
 * profile of each project last exported to, on this computer.
 *
 * Not in the project, where it was a field of the profile: it is an absolute
 * path on the author's computer, and a project is a thing that gets shared.
 * By project path, since a project has no id — its recent entry and its
 * screenshot folder are kept by path for the same reason — then by profile id.
 *
 * Written by the main process alone, when the folder picker is answered. A
 * file of another version is not read and the next choice starts it over, as
 * `layouts.json` does: all it loses is where a picker opens.
 */

export const OUTPUT_FOLDERS_FILE_NAME = 'output-folders.json';
const OUTPUT_FOLDERS_VERSION = 1;

/** Every project's entry as the file holds it; none when it is missing, unreadable or of another version. */
async function projectsIn(file: string): Promise<Record<string, unknown>> {
  const found = await readFound(file);
  const projects = found !== null && found['version'] === OUTPUT_FOLDERS_VERSION ? found['projects'] : null;
  return isRecord(projects) ? projects : {};
}

/** A project's output folders, by profile id. */
export async function readOutputFolders(
  file: string,
  projectPath: string,
): Promise<Record<string, string>> {
  const folders: Record<string, string> = {};
  const found = (await projectsIn(file))[projectPath];
  if (!isRecord(found)) return folders;
  for (const [profileId, folder] of Object.entries(found)) {
    if (typeof folder === 'string' && folder !== '') folders[profileId] = folder;
  }
  return folders;
}

/** Remembers one profile's folder, leaving every other profile's and every other project's as found. */
export async function rememberOutputFolder(
  file: string,
  projectPath: string,
  profileId: string,
  folder: string,
): Promise<void> {
  const projects = await projectsIn(file);
  const kept = projects[projectPath];
  projects[projectPath] = { ...(isRecord(kept) ? kept : {}), [profileId]: folder };
  await atomicWrite(file, JSON.stringify({ version: OUTPUT_FOLDERS_VERSION, projects }, null, 2));
}
