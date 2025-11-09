import React, { useState, useEffect } from 'react';
import AntiCheatDesktop from './Desktop';
import AntiCheatMobile from './Mobile';

/**
 * AntiCheat page with viewport detection
 * Renders Desktop or Mobile component based on screen width
 */
const AntiCheatPage: React.FC = () => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return isMobile ? <AntiCheatMobile /> : <AntiCheatDesktop />;
};

export default AntiCheatPage;
