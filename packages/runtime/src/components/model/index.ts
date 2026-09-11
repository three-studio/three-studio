import { registerSystem } from '../../systems/ComponentSystem';
import { ModelSystem } from './ModelSystem';

registerSystem('model', () => new ModelSystem());
