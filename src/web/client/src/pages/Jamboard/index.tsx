import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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

const JamboardPage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const [searchParams] = useSearchParams();
    const type = searchParams.get('type') || 'staff';

    const [jamboard, setJamboard] = useState<Jamboard | null>(null);
    const [content, setContent] = useState<JamboardContent | null>(null);
    const [loading, setLoading] = useState(true);
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
        if (canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            setCtx(context);
        }
    }, []);

    useEffect(() => {
        fetchJamboard();
    }, [token, type]);

    useEffect(() => {
        if (jamboard) {
            fetchContent();
            
            // SSEでリアルタイム更新を受信
            const eventSource = new EventSource(`/api/jamboards/${token}/${jamboard.id}/stream`);
            
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
    }, [jamboard]);

    useEffect(() => {
        if (content) {
            redrawCanvas(content.whiteboard.strokes);
        }
    }, [content, ctx]);

    const fetchJamboard = async () => {
        try {
            setLoading(true);
            let url: string;
            
            if (type === 'staff') {
                url = `/api/jamboards/${token}/staff`;
            } else {
                url = `/api/jamboards/${token}`;
            }
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch jamboard');
            }
            
            const data = await response.json();
            setJamboard(data.jamboard);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const fetchContent = async () => {
        if (!jamboard) return;
        
        try {
            const response = await fetch(`/api/jamboards/${token}/${jamboard.id}/content`);
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
            await fetch(`/api/jamboards/${token}/${jamboard?.id}/strokes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            await fetch(`/api/jamboards/${token}/${jamboard.id}/todos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            await fetch(`/api/jamboards/${token}/${jamboard.id}/todos/${todoId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
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
            await fetch(`/api/jamboards/${token}/${jamboard.id}/todos/${todoId}`, {
                method: 'DELETE'
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
