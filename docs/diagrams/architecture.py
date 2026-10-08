"""denarii architecture diagram.

Run from anywhere (macOS, no dependencies):

    python3 docs/diagrams/architecture.py

Writes architecture-light.png and architecture-dark.png next to this file.
Rendering lives in render.py.
"""

from render import render

WIDTH, HEIGHT = 1340, 740

# Groups: background panels. (x, y, w, h, label)
GROUPS = {
    "phone":   dict(box=(20, 110, 170, 230),  label="PHONE"),
    "runtime": dict(box=(255, 30, 695, 570),  label="DENARII RUNTIME  ·  Cloudflare Worker or Node container"),
    "core":    dict(box=(440, 200, 490, 280), label="packages/core", style="core", label_right=True),
}

# Nodes. style: node (default) | hl | ext | store | user
NODES = {
    # phone
    "notif":       dict(box=(35, 150, 140, 56),   title="Notification",   sub="bank / wallet app"),
    "macrodroid":  dict(box=(35, 250, 140, 56),   title="MacroDroid",     sub="HTTP POST action"),
    # runtime
    "spa":         dict(box=(290, 70, 130, 50),   title="React SPA",      sub="dashboard"),
    "packs":       dict(box=(460, 126, 110, 56),  title="Rule packs",     sub="YAML, bundled", style="store"),
    "api":         dict(box=(290, 250, 130, 56),  title="Hono API",       sub="ingest · telegram · tRPC"),
    "scheduler":   dict(box=(640, 520, 150, 50),  title="Scheduler",      sub="daily digest"),
    # core
    "classifier":  dict(box=(460, 250, 110, 56),  title="Classifier",     sub="regex rules", style="hl"),
    "dedupe":      dict(box=(640, 250, 100, 56),  title="Dedupe",         sub="±30 s"),
    "categorizer": dict(box=(800, 250, 115, 56),  title="Categorizer",    sub="merchant rules"),
    "flows":       dict(box=(640, 380, 150, 56),  title="Telegram flows", sub="prompts · commands"),
    # outside
    "db":          dict(box=(505, 640, 190, 64),  title="SQLite",         sub="D1 or better-sqlite3", style="store"),
    "google":      dict(box=(290, 644, 130, 56),  title="Google OAuth",   sub="Better Auth", style="ext"),
    "llm":         dict(box=(1030, 250, 140, 56), title="LLM provider",   sub="optional", style="ext"),
    "telegram":    dict(box=(1030, 380, 140, 56), title="Telegram",       sub="Bot API", style="ext"),
    "you":         dict(box=(1234, 372, 72, 72),  title="You", style="user"),
}

# Edges: "node.side" -> "node.side". Sides: top | bottom | left | right.
#   label        text; "\n" stacks lines
#   label_side   above (horizontal, default) | right | left (vertical segments)
#   from_shift / to_shift   slide the anchor along its side (px)
#   both         arrowheads on both ends
#   dashed       optional / external dependency
# Routing: straight if aligned, otherwise one elbow, leaving the start side first.
EDGES = [
    dict(src="notif.bottom",       dst="macrodroid.top"),
    dict(src="macrodroid.right",   dst="api.left",        label="POST /api/ingest"),
    dict(src="spa.bottom",         dst="api.top",         label="tRPC", label_side="right"),
    dict(src="api.right",          dst="classifier.left"),
    dict(src="packs.bottom",       dst="classifier.top"),
    dict(src="classifier.right",   dst="dedupe.left",     label="purchase\ntransfer"),
    dict(src="dedupe.right",       dst="categorizer.left"),
    dict(src="classifier.bottom",  dst="flows.left",      label="unmatched", label_side="right", to_shift=-14),
    dict(src="categorizer.bottom", dst="flows.right",     label="no merchant rule", label_side="left", to_shift=-14),
    dict(src="categorizer.right",  dst="llm.left",        label="suggest\nextract\npropose rule", dashed=True),
    dict(src="flows.right",        dst="telegram.left",   both=True, from_shift=12, to_shift=12),
    dict(src="telegram.right",     dst="you.left",        both=True),
    dict(src="scheduler.top",      dst="flows.bottom"),
    dict(src="core.bottom",        dst="db.top",          label="Store", label_side="left", both=True, from_shift=-85),
    dict(src="api.bottom",         dst="google.top",      label="auth", label_side="right", dashed=True),
    dict(src="you.top",            dst="spa.right",       label="browser", to_shift=-12),
]


if __name__ == "__main__":
    render(__file__, globals())
