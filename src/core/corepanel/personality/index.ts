import { CoreFeatureModule } from '../registry.js';
import { PersonalityFeature } from './PersonalityFeature.js';

export function createPersonalityFeature(): CoreFeatureModule {
    return new PersonalityFeature();
}
