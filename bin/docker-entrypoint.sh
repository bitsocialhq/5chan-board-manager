#!/bin/sh
# Enable debug logging only for daemon commands:
#   - "5chan start"          (5chan-board-manager)
#   - "bitsocial daemon"    (bitsocial-cli)
case "$*" in
  *start*|*daemon*) export DEBUG="${DEBUG:-5chan:*}" ;;
esac
exec "$@"
