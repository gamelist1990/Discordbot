import React, { useState, useEffect } from 'react';
import AntiCheatUnified from './AntiCheat';

/**
 * AntiCheat page with viewport detection
 * Renders Desktop or Mobile component based on screen width
 */
const AntiCheatPage: React.FC = () => {
    const [, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return <AntiCheatUnified />;
};

export default AntiCheatPage;
