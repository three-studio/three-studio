import { fixedId } from '@three-studio/core';
import type { SubsystemDefinition } from './world/World';

/**
 * The batches redrawn once a frame, from their members' world matrices: in the
 * last phase, once everything that moves has moved. Read before physics wrote
 * back, they drew every batched object one frame behind.
 *
 * Holds nothing of its own — the binder keeps the batches — so a factory's
 * object rather than a class.
 */
export const batchingSubsystem: SubsystemDefinition = {
  id: fixedId('subsystem', 'batching'),
  create: (world) => ({
    renderPrep: () => world.binder.updateBatches(),
    dispose() {},
  }),
};
