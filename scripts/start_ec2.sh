#!/bin/bash
cd /home/ec2-user
export PYTHONPATH=/home/ec2-user
pkill -9 -f stream_monitor.py 2>/dev/null || true
sleep 1
nohup python3 -u src/stream_monitor.py > app.log 2>&1 &
sleep 2
ps aux | grep python3
