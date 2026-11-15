import { defineSystem } from '../../systems/ComponentSystem';
import { ModelSystem } from './ModelSystem';

export const modelSystem = defineSystem('model', () => new ModelSystem());
