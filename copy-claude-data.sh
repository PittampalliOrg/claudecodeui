#!/bin/sh
# Script to safely copy .claude data if it exists

if [ -d ".claude-temp" ]; then
    echo "Found .claude directory, copying safe data..."
    
    # Copy projects directory if it exists
    if [ -d ".claude-temp/projects" ]; then
        cp -r .claude-temp/projects /home/claude/.claude/
        echo "Copied projects directory"
    fi
    
    # Copy project-config.json if it exists
    if [ -f ".claude-temp/project-config.json" ]; then
        cp .claude-temp/project-config.json /home/claude/.claude/
        echo "Copied project-config.json"
    fi
    
    # Clean up
    rm -rf .claude-temp
    echo "Cleanup complete"
else
    echo "No .claude directory found in build context"
fi

# Ensure correct ownership
chown -R claude:claude /home/claude/.claude