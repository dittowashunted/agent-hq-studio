"""Automated first-session playtest: found agency → first mission → second rocket → second mission.

Usage: python scripts/probes/ftue.py <studio_id> [stop_after_step]
Play mode must be running with a fresh (unsaved) profile. Screenshots land in captures/ftue_XX.png.
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SID = sys.argv[1]
STOP = int(sys.argv[2]) if len(sys.argv) > 2 else 99
MCP = [sys.executable, os.path.join(ROOT, "scripts", "studio_mcp.py")]
n = 0


def mcp(*args):
    return subprocess.run(MCP + list(args), capture_output=True, text=True, encoding="utf-8", cwd=ROOT).stdout.strip()


def click(text, wait=700, tries=1):
    # tries > 1 retries once a second while the element isn't on screen yet (e.g. behind the boot screen)
    for i in range(tries):
        out = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "ui_click.py"), SID, text, str(wait)], capture_output=True, text=True, encoding="utf-8", cwd=ROOT).stdout.strip()
        if "clicked" in out or i == tries - 1:
            print(" ", out)
            return "clicked" in out
        time.sleep(1)


def type_text(text):
    mcp("call", "user_keyboard_input", json.dumps({"studio_id": SID, "datamodel_type": "Client", "actions": [{"action": "textInput", "text_inputs": text}, {"action": "wait", "wait_time_ms": 300}]}))


def shot(label):
    global n
    n += 1
    out = mcp("call", "screen_capture", json.dumps({"studio_id": SID, "capture_id": f"ftue_{n:02d}_{label}"}))
    print(f"[{n:02d}] {label}: {out}")
    if n >= STOP:
        sys.exit(0)


time.sleep(10)
shot("start")
click("Agency name", 300, tries=30)
type_text("Nova Orbital")
click("LAUNCH MY AGENCY", 1500)
shot("agency_created")
click("Missions")
click("NEW MISSION")
shot("pick_mode")
click("Low Earth Orbit", 1000)
shot("wizard_destination")
click("CONTINUE")
shot("wizard_rocket")
click("CONTINUE")
shot("wizard_pricing")
click("LAUNCH MISSION", 1500)
time.sleep(4)
shot("launched")
time.sleep(6)
shot("in_flight")
print("waiting for first arrival + goal rewards...")
time.sleep(32)
shot("after_arrival")
click("CLAIM", 1200)
shot("daily_claimed")
print("waiting for cash to reach the second rocket price...")
time.sleep(75)
shot("can_afford")
click("Fleet")
shot("fleet_panel")
click("BUY ROCKET", 1200)
shot("catalog")
click("$100K", 900)
shot("confirm")
click("Buy for", 1800)
shot("delivered")
click("PLAN A MISSION", 1000)
click("Orbital Station", 1000)
click("CONTINUE")
click("CONTINUE")
click("LAUNCH MISSION", 1500)
time.sleep(4)
shot("two_missions")
click("Career", 900)
shot("career")
click("More", 900)
shot("more")
click("SHOP", 1200)
shot("shop")
