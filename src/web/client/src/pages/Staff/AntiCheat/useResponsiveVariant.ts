import { useEffect, useState } from 'react';

export type AntiCheatVariant = 'mobile' | 'desktop';

const MOBILE_QUERY = '(max-width: 767px)';

function getVariant(): AntiCheatVariant {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'desktop';
}

export function useResponsiveVariant(): AntiCheatVariant {
  const [variant, setVariant] = useState<AntiCheatVariant>(getVariant);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setVariant(media.matches ? 'mobile' : 'desktop');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return variant;
}
