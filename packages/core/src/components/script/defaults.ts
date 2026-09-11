import { createId } from '../../ids';
import type { ScriptComponent } from './schema';

export function createScript(): ScriptComponent {
  return { id: createId(), type: 'script', assetId: '', props: {} };
}
