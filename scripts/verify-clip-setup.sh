#!/bin/bash

# CLIP Service Setup Verification Script
# Run this to verify your CLIP service is properly configured

echo "🔍 Verifying CLIP Service Setup..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check 1: Virtual environment exists
echo -n "1. Checking virtual environment... "
if [ -f "venv/bin/python3" ]; then
    echo -e "${GREEN}✅ Found${NC}"
else
    echo -e "${RED}❌ Missing${NC}"
    echo -e "${YELLOW}Run: python3 -m venv venv${NC}"
    exit 1
fi

# Check 2: Activate venv and check packages
echo -n "2. Checking FastAPI installation... "
source venv/bin/activate
if python -c "from fastapi import FastAPI" 2>/dev/null; then
    echo -e "${GREEN}✅ Installed${NC}"
else
    echo -e "${RED}❌ Missing${NC}"
    echo -e "${YELLOW}Run: source venv/bin/activate && pip install -r requirements.txt${NC}"
    deactivate
    exit 1
fi

echo -n "3. Checking PyTorch installation... "
if python -c "import torch" 2>/dev/null; then
    echo -e "${GREEN}✅ Installed${NC}"
else
    echo -e "${RED}❌ Missing${NC}"
    echo -e "${YELLOW}Run: source venv/bin/activate && pip install -r requirements.txt${NC}"
    deactivate
    exit 1
fi

echo -n "4. Checking Transformers installation... "
if python -c "from transformers import CLIPProcessor" 2>/dev/null; then
    echo -e "${GREEN}✅ Installed${NC}"
else
    echo -e "${RED}❌ Missing${NC}"
    echo -e "${YELLOW}Run: source venv/bin/activate && pip install -r requirements.txt${NC}"
    deactivate
    exit 1
fi

# Check 3: Test CLIP service startup
echo -n "5. Testing CLIP service startup... "
python similarity_service.py > /tmp/clip_test.log 2>&1 &
CLIP_PID=$!
sleep 5

if ps -p $CLIP_PID > /dev/null; then
    echo -e "${GREEN}✅ Started (PID: $CLIP_PID)${NC}"
    kill $CLIP_PID 2>/dev/null
    wait $CLIP_PID 2>/dev/null || true
else
    echo -e "${RED}❌ Failed to start${NC}"
    echo "Check /tmp/clip_test.log for errors"
    deactivate
    exit 1
fi

deactivate

# Check 4: Verify clipServiceManager.js updated
echo -n "6. Checking clipServiceManager.js uses venv... "
if grep -q "venvPython" src/services/clipServiceManager.js; then
    echo -e "${GREEN}✅ Configured${NC}"
else
    echo -e "${RED}❌ Not updated${NC}"
    echo -e "${YELLOW}Update src/services/clipServiceManager.js to use venv Python${NC}"
    exit 1
fi

# Check 5: Verify requirements.txt exists
echo -n "7. Checking requirements.txt exists... "
if [ -f "requirements.txt" ]; then
    echo -e "${GREEN}✅ Found${NC}"
else
    echo -e "${RED}❌ Missing${NC}"
    echo -e "${YELLOW}Create requirements.txt with CLIP dependencies${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 All checks passed! CLIP service is ready to use.${NC}"
echo ""
echo "To start the app with CLIP enabled:"
echo "  1. Ensure similarity is enabled in config.json"
echo "  2. Run: npm start"
echo "  3. Check logs for 'CLIP service is ready'"
echo ""

