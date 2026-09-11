import { registerSystem } from '../../systems/ComponentSystem';
import { LightSystem } from './LightSystem';

registerSystem('light', () => new LightSystem());
