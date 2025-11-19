import React from 'react';
import { motion } from 'framer-motion';
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
        <h3>カード設定</h3>
        {onClose && (
          <button onClick={onClose} className={styles.closeButton}>
            <span className="material-icons">close</span>
          </button>
        )}
      </div>

      <div className={styles.inspectorBody}>
        <div className={styles.section}>
            <h4 className={styles.sectionTitle}>コンテンツ</h4>
            <div className={styles.formGroup}>
            {card.type === 'text' ? (
                <textarea
                className={styles.textarea}
                value={card.content}
                onChange={(e) => onChange({ content: e.target.value })}
                rows={3}
                placeholder="テキストを入力"
                />
            ) : (
                <input
                className={styles.input}
                type="text"
                value={card.content}
                onChange={(e) => onChange({ content: e.target.value })}
                placeholder="画像URL"
                />
            )}
            </div>
        </div>

        <div className={styles.section}>
            <h4 className={styles.sectionTitle}>配置・サイズ</h4>
            <div className={styles.row2}>
                <div className={styles.formGroup}>
                    <label htmlFor="cardX">X</label>
                    <input
                        id="cardX"
                        name="cardX"
                        className={styles.input}
                        type="number"
                        value={Math.round(card.x)}
                        onChange={(e) => onChange({ x: parseFloat(e.target.value) || 0 })}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label htmlFor="cardY">Y</label>
                    <input
                        id="cardY"
                        name="cardY"
                        className={styles.input}
                        type="number"
                        value={Math.round(card.y)}
                        onChange={(e) => onChange({ y: parseFloat(e.target.value) || 0 })}
                    />
                </div>
            </div>
            <div className={styles.row2}>
                <div className={styles.formGroup}>
                    <label htmlFor="cardWidth">幅</label>
                    <input
                        id="cardWidth"
                        name="cardWidth"
                        className={styles.input}
                        type="number"
                        value={Math.round(card.pxW)}
                        onChange={(e) => onChange({ pxW: parseFloat(e.target.value) || 1 })}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label htmlFor="cardHeight">高さ</label>
                    <input
                        id="cardHeight"
                        name="cardHeight"
                        className={styles.input}
                        type="number"
                        value={Math.round(card.pxH)}
                        onChange={(e) => onChange({ pxH: parseFloat(e.target.value) || 1 })}
                    />
                </div>
            </div>
        </div>

        <div className={styles.section}>
            <h4 className={styles.sectionTitle}>外観</h4>
            <div className={styles.row2}>
                <div className={styles.formGroup}>
                    <label htmlFor="cardRotation">回転 (°)</label>
                    <input
                        id="cardRotation"
                        name="cardRotation"
                        className={styles.input}
                        type="number"
                        value={card.rotation || 0}
                        onChange={(e) => onChange({ rotation: parseFloat(e.target.value) || 0 })}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label htmlFor="cardOpacity">不透明度</label>
                    <input
                        id="cardOpacity"
                        name="cardOpacity"
                        className={styles.input}
                        type="number"
                        value={card.opacity ?? 1}
                        step="0.1"
                        max="1"
                        min="0"
                        onChange={(e) => onChange({ opacity: parseFloat(e.target.value) || 1 })}
                    />
                </div>
            </div>
            <div className={styles.formGroup}>
                <label htmlFor="cardZIndex">重なり順 (Z-Index)</label>
                <input
                    id="cardZIndex"
                    name="cardZIndex"
                    className={styles.input}
                    type="number"
                    value={card.zIndex || 1}
                    onChange={(e) => onChange({ zIndex: parseInt(e.target.value) || 1 })}
                />
            </div>
        </div>

        {card.type === 'text' && (
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>テキストスタイル</h4>
            <div className={styles.row2}>
                <div className={styles.formGroup}>
                <label htmlFor="cardFontSize">サイズ</label>
                <input
                    id="cardFontSize"
                    name="cardFontSize"
                    className={styles.input}
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
                <label htmlFor="cardFontColor">色</label>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <input
                        id="cardFontColor"
                        name="cardFontColor"
                        type="color"
                        style={{width:40, height:40, padding:0, border:'none', borderRadius:8, cursor:'pointer'}}
                        value={card.meta?.color || '#000000'}
                        onChange={(e) =>
                        onChange({
                            meta: { ...card.meta, color: e.target.value },
                        })
                        }
                    />
                    <input 
                        id="cardFontColorHex"
                        name="cardFontColorHex"
                        className={styles.input}
                        value={card.meta?.color || '#000000'}
                        onChange={(e) => onChange({ meta: { ...card.meta, color: e.target.value } })}
                    />
                </div>
                </div>
            </div>

            <div className={styles.formGroup}>
              <label>配置</label>
              <div className={styles.segmentedControl}>
                  {['left', 'center', 'right'].map((align) => (
                      <button
                        key={align}
                        className={`${styles.segmentBtn} ${(card.meta?.align || 'left') === align ? styles.segmentActive : ''}`}
                        onClick={() => onChange({ meta: { ...card.meta, align: align as any } })}
                      >
                          <span className="material-icons" style={{fontSize:18}}>format_align_{align}</span>
                      </button>
                  ))}
              </div>
            </div>
            
            <div className={styles.formGroup}>
                <label>太字</label>
                <label className={styles.toggleLabel}>
                    <input 
                        type="checkbox" 
                        checked={card.meta?.fontWeight === 'bold'}
                        onChange={(e) => onChange({ meta: { ...card.meta, fontWeight: e.target.checked ? 'bold' : 'normal' } })}
                    />
                    <span style={{marginLeft:8}}>太字にする</span>
                </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardInspector;
