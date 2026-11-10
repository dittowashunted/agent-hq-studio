"""Minimal stdio client for Roblox Studio's built-in MCP server (no dependencies).

Lets Claude Code drive Studio before the session has the official MCP loaded.
Usage:
  python scripts/studio_mcp.py list                      # list tools
  python scripts/studio_mcp.py call <tool> '<json args>' # call one tool
  python scripts/studio_mcp.py schema <tool>             # show a tool's input schema
  python scripts/studio_mcp.py luau <studio_id> <Edit|Server|Client> <file.luau>
"""
import base64
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
BAT = os.path.expandvars(r"%LOCALAPPDATA%\Roblox\mcp.bat")


def main() -> int:
    proc = subprocess.Popen(
        ["cmd.exe", "/c", BAT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
    )
    next_id = 0

    def send(method, params=None, notify=False):
        nonlocal next_id
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notify:
            next_id += 1
            msg["id"] = next_id
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        if notify:
            return None
        while True:
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("MCP server closed the connection")
            reply = json.loads(line)
            if reply.get("id") == next_id:
                return reply

    try:
        send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "studio_mcp.py", "version": "0"}})
        send("notifications/initialized", notify=True)
        if sys.argv[1] == "schema":
            for tool in send("tools/list")["result"]["tools"]:
                if tool["name"] == sys.argv[2]:
                    print(json.dumps(tool["inputSchema"], indent=1))
        elif sys.argv[1] == "list":
            for tool in send("tools/list")["result"]["tools"]:
                print(tool["name"], "-", tool.get("description", "")[:110].replace("\n", " "))
        else:
            if sys.argv[1] == "luau":  # luau <studio_id> <Edit|Server|Client> <file.luau>
                tool = "execute_luau"
                with open(sys.argv[4], encoding="utf-8") as f:
                    args = {"studio_id": sys.argv[2], "datamodel_type": sys.argv[3], "code": f.read()}
            else:
                tool = sys.argv[2]
                args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
            reply = send("tools/call", {"name": tool, "arguments": args})
            if "error" in reply:
                print("ERROR:", json.dumps(reply["error"]))
                return 1
            for part in reply["result"].get("content", []):
                if part.get("type") == "text":
                    print(part["text"])
                elif part.get("type") == "image":
                    os.makedirs("captures", exist_ok=True)
                    path = os.path.join("captures", f"{args.get('capture_id', 'capture')}.png")
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(part["data"]))
                    print("saved", path)
                else:
                    print(f"[{part.get('type')} content omitted]")
            if reply["result"].get("isError"):
                return 1
        return 0
    finally:
        proc.kill()


if __name__ == "__main__":
    sys.exit(main())
