# Staff Help Page - UI Mockup

## Visual Design Overview

### Color Scheme
- **Primary**: Purple gradient (#667eea → #764ba2)
- **Background**: Light gradient purple
- **Cards**: White with subtle shadows
- **Text**: Dark gray (#37474f, #5f6368)
- **Accents**: Red for required badges (#ea4335)

## Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Header with User Avatar]                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                    🛠️ スタッフ管理ページ                      │
│              サーバー管理者向けのコマンドとサービス              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [📚 コマンドヘルプ]  [⚙️ サービス]                          │
│  ═══════════════                                             │
├──────────┬──────────────────────────────────────────────────┤
│          │  💡 これらのコマンドは「サーバー管理」権限を       │
│ Quick    │     持つユーザーのみ使用できます                  │
│ Links:   ├──────────────────────────────────────────────────┤
│          │                                                   │
│ • help   │  ┌────────────────────────────────────────────┐  │
│ • clear  │  │ /staff clear                               │  │
│ • issue  │  ├────────────────────────────────────────────┤  │
│ • etc... │  │ チャンネルのメッセージを削除します            │  │
│          │  │                                            │  │
│          │  │ オプション:                                 │  │
│          │  │   🔢 count  [必須] INTEGER                │  │
│          │  │      削除するメッセージ数（1〜100）         │  │
│          │  │                                            │  │
│          │  │ 使用例:                                     │  │
│          │  │   /staff clear count:<値>                 │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                   │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ /staff issue                              │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ Issue 作成用のモーダルを開きます            │  │
│          │  │                                            │  │
│          │  │ 使用例:                                     │  │
│          │  │   /staff issue                            │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

## Detailed Component Breakdown

### 1. Header Section
```
╔═══════════════════════════════════════════════════════════╗
║  Purple Gradient Background                               ║
║                                                           ║
║          🛠️ スタッフ管理ページ                             ║
║     サーバー管理者向けのコマンドとサービス                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

### 2. Tab Navigation
```
┌──────────────────┬──────────────────┐
│ 📚 コマンドヘルプ │  ⚙️ サービス     │
└══════════════════┴──────────────────┘
  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  (Active indicator)
```

### 3. Command Card (Detailed)
```
┌─────────────────────────────────────────────────────────┐
│ Purple Gradient Header                                  │
│ /staff clear                                            │
├─────────────────────────────────────────────────────────┤
│ White Background                                        │
│                                                         │
│ チャンネルのメッセージを削除します                       │
│                                                         │
│ オプション                                              │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🔢 count  [必須] INTEGER                           │ │
│ │ 削除するメッセージ数（1〜100）                      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 使用例:                                                 │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Dark Code Block                                     │ │
│ │ /staff clear count:<値>                            │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 4. Services Tab
```
┌────────────────┐  ┌────────────────┐
│      🔧        │  │      ➕        │
│ プライベート    │  │  今後のサービス │
│   チャット     │  │  がここに表示   │
│                │  │    されます     │
│  [  開く  ]    │  │                │
└────────────────┘  └────────────────┘
```

## Interaction States

### Hover Effects

#### Command Card Hover:
```
┌─────────────────────────────────────────────────────────┐
│ Purple Gradient Header                                  │
│ /staff clear                                            │
├─────────────────────────────────────────────────────────┤
│ Slight upward movement (2px)                           │
│ Enhanced shadow (more pronounced)                       │
│ Purple border appears                                   │
└─────────────────────────────────────────────────────────┘
```

#### Tab Hover:
```
┌──────────────────┐
│ 📚 コマンドヘルプ │  ← Light purple background
└──────────────────┘
```

#### Sidebar Link Hover:
```
  → clear  ← Slides right 4px, purple border on left
```

## Responsive Breakpoints

### Desktop (> 1024px)
- Two-column layout (sidebar + main)
- Full command cards
- Large font sizes

### Tablet (768px - 1024px)
- Single column layout
- Sidebar collapses or moves to top
- Medium font sizes

### Mobile (< 768px)
- Stacked layout
- Smaller font sizes
- Touch-friendly buttons
- Reduced padding

## Animation Effects

1. **Page Load**: Fade in from bottom (0.6s)
2. **Tab Switch**: Fade in content (0.4s)
3. **Tab Indicator**: Smooth slide (0.3s cubic-bezier)
4. **Card Hover**: Lift animation (0.3s)
5. **Button Hover**: Scale and shadow (0.3s)

## Accessibility Features

- **Focus Indicators**: Blue outline on all interactive elements
- **Alt Text**: All icons have descriptive text
- **Keyboard Navigation**: Full tab support
- **Color Contrast**: WCAG AA compliant
- **Screen Reader**: Semantic HTML with ARIA labels

## Typography

- **Headings**: 
  - H1: 2.5rem (title)
  - H2: 1.5rem (command names)
  - H3: 1rem (section titles)
- **Body**: 1rem (16px base)
- **Small Text**: 0.85rem - 0.95rem
- **Code**: Monaco, Menlo, Courier New (monospace)

## Spacing System

- **Container Padding**: 24px
- **Card Padding**: 24px (body), 20px (header)
- **Section Gap**: 24px
- **Element Gap**: 16px (medium), 8px (small)

## Shadow Levels

- **Card Default**: `0 2px 8px rgba(0, 0, 0, 0.08)`
- **Card Hover**: `0 8px 24px rgba(103, 126, 234, 0.2)`
- **Button**: `0 4px 12px rgba(103, 126, 234, 0.3)`

## Example Screenshots Description

### Desktop View (1920x1080)
- Full width: 1400px max
- Sidebar: 250px
- Main content: Remaining space
- 2-3 command cards visible without scrolling

### Tablet View (768x1024)
- Full width layout
- Sidebar hidden or collapsed
- 1-2 command cards visible

### Mobile View (375x667)
- Full width with padding
- Single column
- Stacked cards
- Sticky header
