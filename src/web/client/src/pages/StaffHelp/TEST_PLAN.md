# Staff Help Page - Test Plan

## Manual Testing Steps

### 1. Backend API Testing

#### Test Staff Commands Endpoint

1. Start the bot:
   ```bash
   npm run dev
   ```

2. Obtain a valid session token (generated when running `/staff help` in Discord)

3. Test the API endpoint:
   ```bash
   curl http://localhost:3000/api/staff/commands/{TOKEN}
   ```

4. **Expected Response:**
   - Status Code: 200
   - JSON with structure:
     ```json
     {
       "name": "staff",
       "description": "...",
       "subcommands": [...]
     }
     ```

5. **Verify:**
   - All subcommands (help, privatechat, clear, issue) are listed
   - Each subcommand has correct name and description
   - Options are properly formatted with type information

### 2. Frontend Testing

#### Test Page Load

1. Navigate to: `http://localhost:3000/staff/help/{TOKEN}`

2. **Verify:**
   - Page loads without errors
   - Header displays "スタッフ管理ページ"
   - Two tabs are visible: "コマンドヘルプ" and "サービス"

#### Test Tab Navigation

1. Click on "コマンドヘルプ" tab
2. **Verify:**
   - Command cards are displayed
   - Each card shows command name, description, and options

3. Click on "サービス" tab
4. **Verify:**
   - Services section is displayed
   - "プライベートチャット" service card is visible
   - Placeholder card for future services is visible

#### Test Sidebar Navigation

1. In the sidebar, click on any command link (e.g., "clear")
2. **Verify:**
   - Page scrolls to the corresponding command card
   - Smooth scrolling animation occurs

#### Test Command Card Display

For each command card, verify:

1. **Header Section:**
   - Command name in format: `/staff {subcommand}`
   - Gradient purple background

2. **Body Section:**
   - Command description is clear and readable
   - Options section (if options exist):
     - Option name in code format
     - Type icon displayed (📝 for STRING, 🔢 for INTEGER, etc.)
     - "必須" badge for required options
     - Type label (STRING, INTEGER, etc.)
     - Description text

3. **Usage Example:**
   - Dark code block with example usage
   - Example includes required parameters

### 3. Responsive Design Testing

Test on different screen sizes:

1. **Desktop (> 1024px)**
   - Verify: Sidebar is visible on left
   - Verify: Two-column layout

2. **Tablet (768px - 1024px)**
   - Verify: Single column layout
   - Verify: All content is readable

3. **Mobile (< 768px)**
   - Verify: Responsive text sizes
   - Verify: Touch-friendly button sizes
   - Verify: Horizontal scrolling not present

### 4. Error Handling Testing

#### Test Invalid Token

1. Navigate to: `http://localhost:3000/staff/help/invalid-token`
2. **Verify:**
   - Error message is displayed
   - No crash or blank page

#### Test Expired Token

1. Wait 30 minutes after generating a token
2. Try to access the page
3. **Verify:**
   - Appropriate error message
   - Suggestion to run `/staff help` again

### 5. Integration Testing

#### Test from Discord

1. In Discord, run: `/staff help`
2. **Verify:**
   - Bot responds with embed message
   - Embed contains Web URL
   - URL is clickable
   - Warning about 30-minute expiration is shown

3. Click the URL
4. **Verify:**
   - Browser opens to help page
   - Page loads successfully
   - All commands from Discord are displayed

#### Test Service Links

1. On the help page, go to "サービス" tab
2. Click "開く" button on "プライベートチャット" service
3. **Verify:**
   - Navigates to private chat page
   - Token is preserved in URL

### 6. Visual Design Testing

Verify Google Material Design principles:

1. **Typography:**
   - Clear hierarchy (headings, body text)
   - Appropriate font sizes
   - Good readability

2. **Colors:**
   - Consistent purple gradient theme
   - Good contrast ratios
   - Appropriate use of white space

3. **Shadows:**
   - Cards have subtle shadows
   - Shadow increases on hover

4. **Animations:**
   - Smooth transitions
   - No jank or lag
   - Tab indicator slides smoothly

### 7. Accessibility Testing

1. **Keyboard Navigation:**
   - Tab through all interactive elements
   - Verify focus indicators are visible
   - Verify all buttons are reachable

2. **Screen Reader:**
   - Test with screen reader
   - Verify alt text and labels are present

## Expected Results Summary

- ✅ All API endpoints return correct data
- ✅ Page loads without errors
- ✅ All interactive elements work correctly
- ✅ Responsive design works on all screen sizes
- ✅ Error handling is graceful
- ✅ Integration with Discord commands works
- ✅ Visual design follows Material Design
- ✅ Accessibility requirements met

## Known Limitations

1. Token expires after 30 minutes (by design)
2. Requires staff/manage server permissions
3. Only displays staff commands (not all bot commands)

## Future Enhancements

1. Add command search functionality
2. Add usage statistics
3. Add dark mode toggle
4. Add command favorites/bookmarks
