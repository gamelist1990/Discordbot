import React from 'react';
import { Rnd } from 'react-rnd';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from './types';
import styles from './ProfileSettings.module.css';

interface OverviewEditorCanvasProps {
  cards: Card[];
  width?: number;
  height?: number;
  onUpdateCard: (id: string, patch: Partial<Card>) => void;
  onSelectCard: (id: string | null) => void;
  selectedId?: string | null;
  gridSnap?: number;
  onDuplicateCard?: (id: string) => void;
  onDeleteCard?: (id: string) => void;
  onBringForward?: (id: string) => void;
  onSendBackward?: (id: string) => void;
}

const OverviewEditorCanvas: React.FC<OverviewEditorCanvasProps> = ({
  cards,
  width = 600,
  height = 400,
  onUpdateCard,
  onSelectCard,
  selectedId,
  gridSnap = 1,
  onDuplicateCard,
  onDeleteCard,
  onBringForward,
  onSendBackward,
}) => {
  const handleDragStop = (id: string, d: any) => {
    onUpdateCard(id, { x: d.x, y: d.y });
  };

  const handleResizeStop = (id: string, ref: HTMLElement, position: any) => {
    onUpdateCard(id, {
      pxW: parseInt(ref.style.width),
      pxH: parseInt(ref.style.height),
      x: position.x,
      y: position.y,
    });
  };

  const renderCardContent = (card: Card) => {
    if (card.type === 'image' || card.type === 'sticker') {
      return (
        <img
          src={card.content}
          alt="Card"
          draggable="false"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: card.opacity ?? 1,
            transform: `rotate(${card.rotation || 0}deg)`,
            pointerEvents: 'none',
          }}
        />
      );
    } else if (card.type === 'text') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: card.meta?.align || 'left',
            fontSize: card.meta?.fontSize || 14,
            color: card.meta?.color || '#000',
            fontWeight: card.meta?.fontWeight || 'normal',
            opacity: card.opacity ?? 1,
            transform: `rotate(${card.rotation || 0}deg)`,
            padding: '4px',
            overflow: 'hidden',
            userSelect: 'none',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            fontFamily: card.meta?.fontFamily || 'inherit',
          }}
        >
          {card.content}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={styles.editorContainer}>
      <AnimatePresence>
        {selectedId && (
          <motion.div 
            className={styles.editorToolbar}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <button onClick={() => onDuplicateCard?.(selectedId)} className={styles.toolButton} title="複製">
              <span className="material-icons">content_copy</span>
            </button>
            <button onClick={() => onBringForward?.(selectedId)} className={styles.toolButton} title="前面へ">
              <span className="material-icons">flip_to_front</span>
            </button>
            <button onClick={() => onSendBackward?.(selectedId)} className={styles.toolButton} title="背面へ">
              <span className="material-icons">flip_to_back</span>
            </button>
            <div className={styles.toolbarDivider} />
            <button onClick={() => onDeleteCard?.(selectedId)} className={`${styles.toolButton} ${styles.toolButtonDanger}`} title="削除">
              <span className="material-icons">delete</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={styles.canvasWrap}
        style={{ width: '100%', maxWidth: typeof width === 'number' ? `${width}px` : width, height, position: 'relative' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onSelectCard(null);
          }
        }}
      >
        {cards.map((card) => (
          <Rnd
            key={card.id}
            position={{ x: card.x, y: card.y }}
            size={{ width: card.pxW, height: card.pxH }}
            onDragStop={(_e, d) => handleDragStop(card.id, d)}
            onResizeStop={(_e, _direction, ref, _delta, position) =>
              handleResizeStop(card.id, ref, position)
            }
            dragGrid={[gridSnap, gridSnap]}
            resizeGrid={[gridSnap, gridSnap]}
            bounds="parent"
            style={{
              zIndex: card.zIndex || 1,
            }}
            className={`${styles.previewCard} ${
              selectedId === card.id ? styles.previewCardSelected : ''
            }`}
            onClick={() => onSelectCard(card.id)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              style={{ width: '100%', height: '100%' }}
            >
              {renderCardContent(card)}
            </motion.div>
          </Rnd>
        ))}
      </div>
    </div>
  );
};

export default OverviewEditorCanvas;
