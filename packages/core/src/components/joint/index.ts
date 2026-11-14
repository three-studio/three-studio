import { conform } from '../../conform';
import type { ComponentDefinition } from '../registry';
import { conformJointMotion, createJoint } from './defaults';
import type { JointComponent } from './schema';

/**
 * Holds the body its entity moves with to the body of the entity it names, or
 * to the world, as they were placed: built with the world, after the bodies, a
 * hinge's angle and a slider's offset starting at zero there.
 *
 * Read field by field against its factory, as every physics component is, and
 * what it does not know is dropped; its motion against the factory of the kind
 * it names.
 */
export const jointComponent: ComponentDefinition<JointComponent> = {
  id: 'joint',
  label: 'Joint',
  create: () => createJoint(),
  fill: (stored) => ({ ...conform(stored, createJoint()), motion: conformJointMotion(stored.motion) }),
  assets: () => [],
  entities: (component) => [component.connectedEntity],
  icon: 'link',
  placeable: () => true,
  runtime: true,
  addable: true,
};
