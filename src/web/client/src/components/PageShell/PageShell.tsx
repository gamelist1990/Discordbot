import React, { ReactNode } from 'react';
import styles from './PageShell.module.css';

interface PageShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  className?: string;
}

const PageShell: React.FC<PageShellProps> = ({
  eyebrow,
  title,
  description,
  actions,
  meta,
  aside,
  children,
  compact = false,
  className,
}) => {
  return (
    <div
      className={[
        styles.shell,
        compact ? styles.compact : '',
        aside ? styles.withAside : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.hero}>
        <div className={styles.copy}>
          {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
          <h1 className={styles.title}>{title}</h1>
          {description ? <p className={styles.description}>{description}</p> : null}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>

        {aside ? <aside className={styles.aside}>{aside}</aside> : null}
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  );
};

export default PageShell;
