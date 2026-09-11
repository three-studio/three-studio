import { registerSystem } from '../../systems/ComponentSystem';
import { MeshSystem } from './MeshSystem';

registerSystem('mesh', () => new MeshSystem());
