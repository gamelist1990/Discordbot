import { CoreFeatureModule } from '../registry.js';
import { RequestFeature } from './RequestFeature.js';

export function createRequestFeature(): CoreFeatureModule {
    return new RequestFeature();
}
