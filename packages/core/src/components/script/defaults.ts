import { createComponentId } from '../../ids';
import type { ScriptComponent } from './schema';

export function createScript(): ScriptComponent {
  return { id: createComponentId(), type: 'script', assetId: '', props: {} };
}
