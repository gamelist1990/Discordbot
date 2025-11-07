import React from 'react';
import { Card } from './types';
import styles from './ProfileSettings.module.css';

interface CardInspectorProps {
  card: Card | null;
  onChange: (patch: Partial<Card>) => void;
  onClose?: () => void;
}

const CardInspector: React.FC<CardInspectorProps> = ({
  card,
  onChange,
  onClose,
}) => {
  if (!card) return null;

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <h3>カードプロパティ</h3>
        {onClose && (
          <button onClick={onClose} className={styles.closeButton}>
            <span className="material-icons">close</span>
          </button>
        )}
      </div>

      <div className={styles.inspectorBody}>
        <div className={styles.formGroup}>
          <label>位置 X (px)</label>
          <input
            type="number"
            value={card.x}
            onChange={(e) => onChange({ x: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div className={styles.formGroup}>
          <label>位置 Y (px)</label>
          <input
            type="number"
            value={card.y}
            onChange={(e) => onChange({ y: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div className={styles.formGroup}>
          <label>幅 (px)</label>
          <input
            type="number"
            value={card.pxW}
            onChange={(e) => onChange({ pxW: parseFloat(e.target.value) || 1 })}
          />
        </div>

        <div className={styles.formGroup}>
          <label>高さ (px)</label>
          <input
            type="number"
            value={card.pxH}
            onChange={(e) => onChange({ pxH: parseFloat(e.target.value) || 1 })}
          />
        </div>

        <div className={styles.formGroup}>
          <label>回転 (度)</label>
          <input
            type="number"
            value={card.rotation || 0}
            onChange={(e) =>
              onChange({ rotation: parseFloat(e.target.value) || 0 })
            }
            min="0"
            max="360"
          />
        </div>

        <div className={styles.formGroup}>
          <label>Z-Index</label>
          <input
            type="number"
            value={card.zIndex || 1}
            onChange={(e) =>
              onChange({ zIndex: parseInt(e.target.value) || 1 })
            }
          />
        </div>

        <div className={styles.formGroup}>
          <label>不透明度</label>
          <input
            type="number"
            value={card.opacity ?? 1}
            onChange={(e) =>
              onChange({ opacity: parseFloat(e.target.value) || 1 })
            }
            min="0"
            max="1"
            step="0.1"
          />
        </div>

        <div className={styles.formGroup}>
          <label>コンテンツ</label>
          {card.type === 'text' ? (
            <textarea
              value={card.content}
              onChange={(e) => onChange({ content: e.target.value })}
              rows={4}
            />
          ) : (
            <input
              type="text"
              value={card.content}
              onChange={(e) => onChange({ content: e.target.value })}
              placeholder="画像URL"
            />
          )}
        </div>

        {card.type === 'text' && (
          <>
            <div className={styles.formGroup}>
              <label>フォントサイズ</label>
              <input
                type="number"
                value={card.meta?.fontSize || 14}
                onChange={(e) =>
                  onChange({
                    meta: { ...card.meta, fontSize: parseInt(e.target.value) || 14 },
                  })
                }
              />
            </div>

            <div className={styles.formGroup}>
              <label>文字色</label>
              <input
                type="color"
                value={card.meta?.color || '#000000'}
                onChange={(e) =>
                  onChange({
                    meta: { ...card.meta, color: e.target.value },
                  })
                }
              />
            </div>

            <div className={styles.formGroup}>
              <label>配置</label>
              <select
                value={card.meta?.align || 'left'}
                onChange={(e) =>
                  onChange({
                    meta: { ...card.meta, align: e.target.value as 'left' | 'center' | 'right' },
                  })
                }
              >
                <option value="left">左</option>
                <option value="center">中央</option>
                <option value="right">右</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CardInspector;
