#!/bin/bash
# Renders every mascot loop and badge into ./render (Blender 5.1+).
B="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.1/blender.exe}"
cd "$(dirname "$0")"
for n in orbit nova cosmo; do
  start=$(date +%s)
  "$B" -b --factory-startup --python mascots.py -- --name $n --size 512 --samples 128 2>&1 | grep -E "Error:|Traceback|MASCOT_DONE"
  echo "$n took $(( $(date +%s) - start ))s"
done
