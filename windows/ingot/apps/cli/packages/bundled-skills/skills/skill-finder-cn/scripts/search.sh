#!/bin/bash
# Skill Search脚本

QUERY="$1"
LIMIT="${2:-10}"

if [ -z "$QUERY" ]; then
    echo "用法: search.sh <关键词> [Quantity]"
    exit 1
fi

echo "🔍 Search: $QUERY"
echo "================================"

clawhub search "$QUERY" --limit "$LIMIT"
