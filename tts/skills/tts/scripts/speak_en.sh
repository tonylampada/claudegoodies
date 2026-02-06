#!/bin/bash
# English TTS using macOS say command with configurable voice

# Default voice
VOICE="Zoe (Premium)"
RATE=180

# Parse arguments
while getopts "v:r:" opt; do
    case $opt in
        v) VOICE="$OPTARG";;
        r) RATE="$OPTARG";;
        \?) echo "Usage: $0 [-v voice] [-r rate] <text-to-speak>"; exit 1;;
    esac
done
shift $((OPTIND-1))

if [ -z "$1" ]; then
    echo "Usage: $0 [-v voice] [-r rate] <text-to-speak>"
    echo "  -v voice  Voice name (default: 'Zoe (Premium)')"
    echo "  -r rate   Speech rate (default: 180)"
    exit 1
fi

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
say -v "$VOICE" -r "$RATE" "$1"

# Lock will be released automatically by trap
