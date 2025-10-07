import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import styles from './JamboardPage.module.css';

interface Jamboard {
    id: string;
    type: 'staff' | 'personal';
    name: string;
    ownerId: string;
    members: string[];
}

interface DrawingStroke {
    id: string;
    points: { x: number; y: number }[];
    color: string;
    width: number;
    tool: 'pen' | 'eraser' | 'highlighter';
}

interface TodoItem {
    id: string;
    text: string;
    completed: boolean;
    createdBy: string;
    createdAt: number;
}

interface JamboardContent {
    whiteboard: {
        strokes: DrawingStroke[];
    };
    todos: TodoItem[];
}

interface UserSession {
    userId: string;
    username: string;
    permission: number;
}

const JamboardPage: React.FC = () => {
    const { jamboardId } = useParams<{ jamboardId?: string }>();
    const [session, setSession] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    
    const [jamboard, setJamboard] = useState<Jamboard | null>(null);
    const [content, setContent] = useState<JamboardContent | null>(null);
    const [error, setError] = useState<string | null>(null);
    
    const [currentTool, setCurrentTool] = useState<'pen' | 'eraser' | 'highlighter'>('pen');
    const [currentColor, setCurrentColor] = useState('#000000');
    const [currentWidth, setCurrentWidth] = useState(2);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
    
    const [newTodoText, setNewTodoText] = useState('');
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

    useEffect(() => {
        // Check if user is authenticated
        checkAuthentication();
    }, []);

    useEffect(() => {
        if (canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            setCtx(context);
        }
    }, []);

    useEffect(() => {
        if (session && jamboard) {
            fetchContent();
            
            // SSEでリアルタイム更新を受信
            // Server expects /api/jamboards/:jamboardId/stream
            const eventSource = new EventSource(`/api/jamboards/${jamboard.id}/stream`);
            
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                setContent(data);
                redrawCanvas(data.whiteboard.strokes);
            };
            
            eventSource.onerror = () => {
                console.error('SSE connection error');
            };
            
            return () => {
                eventSource.close();
            };
        }
    }, [session, jamboard]);

    useEffect(() => {
        if (content) {
            redrawCanvas(content.whiteboard.strokes);
        }
    }, [content, ctx]);

    const checkAuthentication = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/auth/session', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                setSession(data.user);
                // permission >=1 => staff
                // If there's no jamboardId in path, go to workspaces selection
                if (!jamboardId) {
                    window.location.href = '/jamboard';
                    return;
                }
                await loadJamboard((data.user.permission || 0) >= 1);
            } else {
                setSession(null);
            }
        } catch (err) {
            console.error('Authentication check failed:', err);
            setAuthError('認証の確認に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleDiscordLogin = () => {
        // Redirect to Discord OAuth2 with guildId if present in URL
        try {
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            // Expecting path like /jamboard or /jamboard/<guildId>
            let guildIdFromPath: string | null = null;
            if (pathParts.length >= 2 && pathParts[0] === 'jamboard') {
                guildIdFromPath = pathParts[1];
            }

            const redirect = guildIdFromPath ? `/jamboard/${guildIdFromPath}` : '/jamboard';
            const guildQuery = guildIdFromPath ? `?guildId=${encodeURIComponent(guildIdFromPath)}&redirect=${encodeURIComponent(redirect)}` : '';

            window.location.href = `/api/auth/discord${guildQuery}`;
        } catch (err) {
            window.location.href = '/api/auth/discord';
        }
    };

    const loadJamboard = async (isStaff: boolean) => {
        try {
            let url: string;
            
            if (jamboardId) {
                // If the path param looks like a guild ID (numeric), the client route
                // uses /jamboard/<guildId> for convenience. In that case call the
                // staff endpoint so server-side logic maps to the staff jamboard.
                if (/^\d+$/.test(jamboardId)) {
                    url = '/api/jamboards/staff';
                } else {
                    // Otherwise treat it as a jamboard id
                    url = `/api/jamboards/${jamboardId}`;
                }
            } else if (isStaff) {
                url = '/api/jamboards/staff';
            } else {
                url = '/api/jamboards/personal';
            }
            
            const response = await fetch(url, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch jamboard');
            }
            
            const data = await response.json();
            setJamboard(data.jamboard);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    };

    const fetchContent = async () => {
        if (!jamboard) return;
        
        try {
            const response = await fetch(`/api/jamboards/${jamboard.id}/content`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch content');
            }
            
            const data = await response.json();
            setContent(data.content);
        } catch (err) {
            console.error('Failed to fetch content:', err);
        }
    };

    const redrawCanvas = (strokes: DrawingStroke[]) => {
        if (!ctx || !canvasRef.current) return;
        
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        strokes.forEach(stroke => {
            if (stroke.points.length < 2) return;
            
            ctx.beginPath();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            if (stroke.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
            } else {
                ctx.globalCompositeOperation = 'source-over';
            }
            
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        });
        
        ctx.globalCompositeOperation = 'source-over';
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        setIsDrawing(true);
        setCurrentStroke([{ x, y }]);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !canvasRef.current || !ctx) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const newStroke = [...currentStroke, { x, y }];
        setCurrentStroke(newStroke);
        
        // リアルタイムで描画
        if (currentStroke.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            if (currentTool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
            } else {
                ctx.globalCompositeOperation = 'source-over';
            }
            
            const lastPoint = currentStroke[currentStroke.length - 1];
            ctx.moveTo(lastPoint.x, lastPoint.y);
            ctx.lineTo(x, y);
            ctx.stroke();
            
            ctx.globalCompositeOperation = 'source-over';
        }
    };

    const handleMouseUp = async () => {
        if (!isDrawing || currentStroke.length === 0) return;
        
        setIsDrawing(false);
        
        // ストロークをサーバーに送信
        try {
            await fetch(`/api/jamboards/${jamboard?.id}/strokes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    points: currentStroke,
                    color: currentColor,
                    width: currentWidth,
                    tool: currentTool
                })
            });
        } catch (err) {
            console.error('Failed to save stroke:', err);
        }
        
        setCurrentStroke([]);
    };

    const handleAddTodo = async () => {
        if (!newTodoText.trim() || !jamboard) return;
        
        try {
            await fetch(`/api/jamboards/${jamboard.id}/todos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text: newTodoText })
            });
            
            setNewTodoText('');
            fetchContent();
        } catch (err) {
            console.error('Failed to add todo:', err);
        }
    };

    const handleToggleTodo = async (todoId: string, completed: boolean) => {
        if (!jamboard) return;
        
        try {
            await fetch(`/api/jamboards/${jamboard.id}/todos/${todoId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ completed: !completed })
            });
            
            fetchContent();
        } catch (err) {
            console.error('Failed to toggle todo:', err);
        }
    };

    const handleDeleteTodo = async (todoId: string) => {
        if (!jamboard) return;
        
        try {
            await fetch(`/api/jamboards/${jamboard.id}/todos/${todoId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            fetchContent();
        } catch (err) {
            console.error('Failed to delete todo:', err);
        }
    };

    const clearCanvas = () => {
        if (ctx && canvasRef.current) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    };

    // Show login screen if not authenticated
    if (!session) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.loginBox}>
                    <h1>🎨 Jamboard</h1>
                    <p className={styles.loginDescription}>
                        コラボレーションワークスペース
                    </p>
                    
                    {authError && (
                        <div className={styles.errorMessage}>
                            {authError}
                        </div>
                    )}
                    
                    {loading ? (
                        <div className={styles.loginLoading}>読み込み中...</div>
                    ) : (
                        <button
                            className={styles.loginButton}
                            onClick={handleDiscordLogin}
                        >
                            <svg className={styles.discordIcon} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                            </svg>
                            Discord でログイン
                        </button>
                    )}
                    
                    <p className={styles.loginFooter}>
                        Discordアカウントでログインして<br />
                        コラボレーションを開始しましょう
                    </p>
                </div>
            </div>
        );
    }

    if (loading) {
        return <div className={styles.loading}>読み込み中...</div>;
    }

    if (error) {
        return <div className={styles.error}>エラー: {error}</div>;
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>🎨 {jamboard?.name || 'Jamboard'}</h1>
                <div className={styles.headerInfo}>
                    <span className={styles.badge}>
                        {jamboard?.type === 'staff' ? 'スタッフ共有' : '個人用'}
                    </span>
                </div>
            </header>

            <div className={styles.content}>
                <div className={styles.whiteboardSection}>
                    <div className={styles.toolbar}>
                        <button
                            className={currentTool === 'pen' ? styles.active : ''}
                            onClick={() => setCurrentTool('pen')}
                        >
                            ✏️ ペン
                        </button>
                        <button
                            className={currentTool === 'highlighter' ? styles.active : ''}
                            onClick={() => setCurrentTool('highlighter')}
                        >
                            🖍️ ハイライト
                        </button>
                        <button
                            className={currentTool === 'eraser' ? styles.active : ''}
                            onClick={() => setCurrentTool('eraser')}
                        >
                            🧹 消しゴム
                        </button>
                        
                        <div className={styles.divider} />
                        
                        <input
                            type="color"
                            value={currentColor}
                            onChange={(e) => setCurrentColor(e.target.value)}
                            disabled={currentTool === 'eraser'}
                        />
                        
                        <input
                            type="range"
                            min="1"
                            max="20"
                            value={currentWidth}
                            onChange={(e) => setCurrentWidth(Number(e.target.value))}
                        />
                        
                        <button onClick={clearCanvas}>🗑️ クリア</button>
                    </div>

                    <canvas
                        ref={canvasRef}
                        width={800}
                        height={600}
                        className={styles.canvas}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />
                </div>

                <div className={styles.todoSection}>
                    <h2>📝 Todo リスト</h2>
                    
                    <div className={styles.todoInput}>
                        <input
                            type="text"
                            placeholder="新しいTodoを入力..."
                            value={newTodoText}
                            onChange={(e) => setNewTodoText(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
                        />
                        <button onClick={handleAddTodo}>追加</button>
                    </div>

                    <div className={styles.todoList}>
                        {content?.todos.map(todo => (
                            <div key={todo.id} className={styles.todoItem}>
                                <input
                                    type="checkbox"
                                    checked={todo.completed}
                                    onChange={() => handleToggleTodo(todo.id, todo.completed)}
                                />
                                <span className={todo.completed ? styles.completed : ''}>
                                    {todo.text}
                                </span>
                                <button
                                    className={styles.deleteBtn}
                                    onClick={() => handleDeleteTodo(todo.id)}
                                >
                                    ❌
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JamboardPage;
