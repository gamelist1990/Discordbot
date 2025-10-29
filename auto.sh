#!/bin/bash

SERVICE_FILE="/etc/systemd/system/bot.service"
BOT_DIR="/home/xxx/Discordbot"
START_SCRIPT="$BOT_DIR/start.sh"

# Check if start.sh is executable
if [ ! -x "$START_SCRIPT" ]; then
    echo "Making start.sh executable..."
    chmod +x "$START_SCRIPT"
fi

# Create systemd service file
echo "Creating systemd service file..."
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Discord Bot Service
After=network.target

[Service]
Type=simple
User=isseidas
WorkingDirectory=$BOT_DIR
ExecStart=$START_SCRIPT
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "Reloading systemd and enabling bot service..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable bot.service

echo "You can now start the bot with: sudo systemctl start bot"