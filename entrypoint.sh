#!/bin/sh
# Start both processes. If either exits, kill the other and exit non-zero
# so the container restarts.

node presenter/server.js &
PRESENTER_PID=$!

node analysis/watcher.js &
WATCHER_PID=$!

# Wait for either process to exit
wait -n $PRESENTER_PID $WATCHER_PID 2>/dev/null
EXIT_CODE=$?

# Kill the survivor
kill $PRESENTER_PID $WATCHER_PID 2>/dev/null
wait 2>/dev/null

exit ${EXIT_CODE:-1}
