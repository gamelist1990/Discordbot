import { CoreFeatureModule } from '../registry.js';
import { OthelloFeature } from './OthelloFeature.js';

export function createOthelloFeature(): CoreFeatureModule {
    return new OthelloFeature();
}