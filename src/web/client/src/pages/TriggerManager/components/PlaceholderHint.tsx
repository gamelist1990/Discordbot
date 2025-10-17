import React, { useState } from 'react';
import { PLACEHOLDERS } from '../utils/placeholders.js';
import styles from './PlaceholderHint.module.css';

interface PlaceholderHintProps {
    title?: string;
}

const PlaceholderHint: React.FC<PlaceholderHintProps> = ({ title = '使用可能なプレースホルダ' }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className={styles.placeholderHint}>
            <button
                className={styles.toggleBtn}
                onClick={() => setIsExpanded(!isExpanded)}
                type="button"
            >
                <span className="material-icons">
                    {isExpanded ? 'expand_less' : 'expand_more'}
                </span>
                <span className={styles.title}>
                    💡 {title}
                </span>
            </button>

            {isExpanded && (
                <div className={styles.hintContent}>
                    <div className={styles.placeholderList}>
                        {PLACEHOLDERS.map((placeholder) => (
                            <div key={placeholder.name} className={styles.placeholderItem}>
                                <div className={styles.placeholderName}>
                                    <code>{placeholder.name}</code>
                                </div>
                                <div className={styles.placeholderInfo}>
                                    <p className={styles.description}>{placeholder.description}</p>
                                    <p className={styles.example}>例: <code>{placeholder.example}</code></p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlaceholderHint;
