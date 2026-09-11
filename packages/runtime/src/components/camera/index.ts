import { registerSystem } from '../../systems/ComponentSystem';
import { CameraSystem } from './CameraSystem';

registerSystem('camera', () => new CameraSystem());
