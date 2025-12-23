#!/bin/bash
# English TTS using macOS say command with Zoe (Premium) voice

if [ -z "$1" ]; then
    echo "Usage: $0 <text-to-speak>"
    exit 1
fi

LOCKFILE="/tmp/tts_say.lock"
LOCKDIR="/tmp/tts_say.lock.d"
TIMEOUT=600  # 60 seconds (600 * 0.1s)

# Function to acquire lock
acquire_lock() {
    local wait_time=0
    while ! mkdir "$LOCKDIR" 2>/dev/null; do
        if [ $wait_time -ge $TIMEOUT ]; then
            echo "Timeout waiting for TTS lock" >&2
            exit 1
        fi
        sleep 0.1
        wait_time=$((wait_time + 1))
    done
}

# Function to release lock
release_lock() {
    rmdir "$LOCKDIR" 2>/dev/null
}

# Ensure lock is released on exit
trap release_lock EXIT INT TERM

# Acquire the lock
acquire_lock

# Speak the message
say -v "Zoe (Premium)" -r 180 "$1"

# Lock will be released automatically by trap
