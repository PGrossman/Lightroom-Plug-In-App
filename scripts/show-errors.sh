#!/bin/bash

# Show only errors from app.log
# Usage: ./scripts/show-errors.sh [number_of_lines]

LOG_FILE="/Volumes/ATOM RAID/Dropbox/_Personal Files/12 - AI Vibe Coding/02 - Cursor Projects/05 - Lightroom Meta Tagger/z_Logs and traces/app.log"
LINES=${1:-50}  # Default to last 50 errors

echo "📋 Showing last $LINES error/warning lines from app.log..."
echo "─────────────────────────────────────────────────────────"
echo ""

grep -i "error\|ERROR\|fail\|FAIL\|exception\|Exception\|warn\|WARN" "$LOG_FILE" | tail -n "$LINES"

echo ""
echo "─────────────────────────────────────────────────────────"
echo "💡 Tip: Run './scripts/show-errors.sh 100' to see more lines"

