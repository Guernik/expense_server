"""denarii high-level overview diagram.

Run from anywhere (macOS, no dependencies):

    python3 docs/diagrams/overview.py

Writes overview-light.png and overview-dark.png next to this file.
Same format as architecture.py; rendering lives in render.py.
"""

from render import render

WIDTH, HEIGHT = 1180, 250

NODES = {
    "phone":      dict(box=(20, 40, 150, 56),   title="Phone",      sub="bank notification"),
    "macrodroid": dict(box=(290, 40, 140, 56),  title="MacroDroid", sub="automation app"),
    "denarii":    dict(box=(530, 40, 200, 56),  title="denarii",    sub="classify · dedupe · categorize", style="hl"),
    "telegram":   dict(box=(860, 40, 140, 56),  title="Telegram",   sub="bot", style="ext"),
    "you":        dict(box=(1080, 32, 72, 72),  title="You", style="user"),
    "db":         dict(box=(550, 166, 160, 64), title="Expenses",   sub="SQLite", style="store"),
}

EDGES = [
    dict(src="phone.right",      dst="macrodroid.left", label="notification"),
    dict(src="macrodroid.right", dst="denarii.left",    label="HTTP POST"),
    dict(src="denarii.right",    dst="telegram.left",   label="asks · answers", both=True),
    dict(src="telegram.right",   dst="you.left",        both=True),
    dict(src="denarii.bottom",   dst="db.top"),
]


if __name__ == "__main__":
    render(__file__, globals())
