"""denarii architecture diagram.

Run from anywhere (macOS, no dependencies):

    python3 docs/diagrams/architecture.py

Writes architecture-light.png and architecture-dark.png next to this file.
Edit the DIAGRAM section; the RENDERER section below it rarely needs changes.
"""

from __future__ import annotations

import pathlib
import subprocess
import tempfile
from dataclasses import dataclass

# ══════════════════════════════════════════════════════════════════════
# DIAGRAM
# ══════════════════════════════════════════════════════════════════════

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

THEMES = {
    "light": dict(
        bg="#fbfaf7", ink="#1d1d1f", mute="#6b6b70", line="#8a8a90",
        node="#ffffff", node_stroke="#c9c7c0",
        group="#f2f0ea", group_stroke="#dcd9d0",
        core="#eaf1ee", core_stroke="#9fbfb1",
        hl="#dbeae3", hl_stroke="#2f7a5c",
        ext="#fff7ec", ext_stroke="#d39a4a",
        store="#eef0f6", store_stroke="#8b93b5",
    ),
    "dark": dict(
        bg="#161618", ink="#ececee", mute="#9a9aa2", line="#7a7a82",
        node="#222226", node_stroke="#3b3b42",
        group="#1c1c1f", group_stroke="#2e2e34",
        core="#18241f", core_stroke="#2f5a48",
        hl="#1f3a2e", hl_stroke="#5fbf96",
        ext="#2a2117", ext_stroke="#b07f3c",
        store="#1e2130", store_stroke="#5a6390",
    ),
}

# ══════════════════════════════════════════════════════════════════════
# RENDERER
# ══════════════════════════════════════════════════════════════════════

SCALE = 2  # PNG pixels per diagram unit
ARROW_GAP = 2  # space between arrowhead tip and the target box

CSS = """
text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;text-anchor:middle}
.title{font-size:14px;font-weight:600;fill:var(--ink)}
.sub{font-size:11px;fill:var(--mute)}
.group-label{font-size:11px;font-weight:700;letter-spacing:.08em;fill:var(--mute)}
.edge-label{font-size:11px;fill:var(--mute);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  paint-order:stroke;stroke:var(--bg);stroke-width:5px;stroke-linejoin:round}
.node{fill:var(--node);stroke:var(--node_stroke);stroke-width:1.2}
.hl{fill:var(--hl);stroke:var(--hl_stroke);stroke-width:1.6}
.ext{fill:var(--ext);stroke:var(--ext_stroke);stroke-width:1.2;stroke-dasharray:5 3}
.store{fill:var(--store);stroke:var(--store_stroke);stroke-width:1.2}
.store-rim{fill:none;stroke:var(--store_stroke);stroke-width:1.2}
.user{fill:var(--node);stroke:var(--ink);stroke-width:1.4}
.group{fill:var(--group);stroke:var(--group_stroke);stroke-width:1}
.core{fill:var(--core);stroke:var(--core_stroke);stroke-width:1.2;stroke-dasharray:6 4}
.edge{fill:none;stroke:var(--line);stroke-width:1.4}
.dashed{stroke-dasharray:5 4}
.arrowhead{fill:var(--line)}
"""


@dataclass
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2

    def anchor(self, side: str, shift: float = 0) -> tuple[float, float]:
        return {
            "top":    (self.cx + shift, self.y),
            "bottom": (self.cx + shift, self.y + self.h),
            "left":   (self.x, self.cy + shift),
            "right":  (self.x + self.w, self.cy + shift),
        }[side]


BOXES = {name: Box(*spec["box"]) for name, spec in {**GROUPS, **NODES}.items()}


def endpoint(ref: str, shift: float) -> tuple[tuple[float, float], str]:
    name, side = ref.split(".")
    return BOXES[name].anchor(side, shift), side


def route(edge: dict) -> list[tuple[float, float]]:
    (x1, y1), side1 = endpoint(edge["src"], edge.get("from_shift", 0))
    (x2, y2), _ = endpoint(edge["dst"], edge.get("to_shift", 0))
    points = [(x1, y1)]
    if x1 != x2 and y1 != y2:
        points.append((x1, y2) if side1 in ("top", "bottom") else (x2, y1))
    points.append((x2, y2))
    return points


def pull_back(a, b, gap):
    """Move b toward a by gap, so arrowheads don't touch boxes."""
    (ax, ay), (bx, by) = a, b
    length = abs(bx - ax) + abs(by - ay)  # segments are axis-aligned
    return bx - (bx - ax) / length * gap, by - (by - ay) / length * gap


def svg_edge(edge: dict) -> list[str]:
    pts = route(edge)
    pts[-1] = pull_back(pts[-2], pts[-1], ARROW_GAP)
    if edge.get("both"):
        pts[0] = pull_back(pts[1], pts[0], ARROW_GAP)
    d = "M" + " L".join(f"{x:g},{y:g}" for x, y in pts)
    cls = "edge dashed" if edge.get("dashed") else "edge"
    start = ' marker-start="url(#arrow-start)"' if edge.get("both") else ""
    out = [f'<path class="{cls}" d="{d}" marker-end="url(#arrow)"{start}/>']

    if label := edge.get("label"):
        # midpoint of the longest horizontal segment (label above) or vertical one (label beside)
        side = edge.get("label_side", "above")
        horizontal = side == "above"
        segments = [(a, b) for a, b in zip(pts, pts[1:]) if (a[1] == b[1]) == horizontal]
        a, b = max(segments, key=lambda s: abs(s[1][0] - s[0][0]) + abs(s[1][1] - s[0][1]))
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        lines = label.split("\n")
        if side == "above":
            anchor, x, y0 = "middle", mx, my - 10 - 12 * (len(lines) - 1)
        else:
            anchor = "start" if side == "right" else "end"
            x, y0 = mx + (11 if side == "right" else -11), my + 4 - 6 * (len(lines) - 1)
        for i, line in enumerate(lines):
            out.append(f'<text class="edge-label" x="{x:g}" y="{y0 + 12 * i:g}" style="text-anchor:{anchor}">{line}</text>')
    return out


def svg_group(name: str, spec: dict) -> list[str]:
    b = BOXES[name]
    cls = spec.get("style", "group")
    if spec.get("label_right"):
        x, anchor = b.x + b.w - 16, "end"
    else:
        x, anchor = b.x + 16, "start"
    return [
        f'<rect class="{cls}" x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="14"/>',
        f'<text class="group-label" x="{x}" y="{b.y + 24}" style="text-anchor:{anchor}">{spec["label"]}</text>',
    ]


def svg_node(name: str, spec: dict) -> list[str]:
    b = BOXES[name]
    style = spec.get("style", "node")
    out = []
    if style == "store":
        rim = 8
        out.append(f'<path class="store" d="M{b.x},{b.y + rim} a{b.w / 2},{rim} 0 0 1 {b.w},0 '
                   f'v{b.h - 2 * rim} a{b.w / 2},{rim} 0 0 1 {-b.w},0 z"/>')
        out.append(f'<path class="store-rim" d="M{b.x},{b.y + rim} a{b.w / 2},{rim} 0 0 0 {b.w},0"/>')
        text_y = b.cy + 2  # nudge below the rim
    elif style == "user":
        out.append(f'<circle class="user" cx="{b.cx}" cy="{b.cy}" r="{b.w / 2}"/>')
        text_y = b.cy
    else:
        out.append(f'<rect class="{style}" x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="8"/>')
        text_y = b.cy
    if sub := spec.get("sub"):
        out.append(f'<text class="title" x="{b.cx}" y="{text_y - 3}">{spec["title"]}</text>')
        out.append(f'<text class="sub" x="{b.cx}" y="{text_y + 14}">{sub}</text>')
    else:
        out.append(f'<text class="title" x="{b.cx}" y="{text_y + 5}">{spec["title"]}</text>')
    return out


def build_svg(theme: dict, canvas_h: int) -> str:
    """canvas_h > HEIGHT pads the canvas vertically (Quick Look renders squares)."""
    pad = (canvas_h - HEIGHT) / 2
    variables = ";".join(f"--{k}:{v}" for k, v in theme.items())
    body = []
    for name, spec in GROUPS.items():
        body += svg_group(name, spec)
    for edge in EDGES:
        body += svg_edge(edge)
    for name, spec in NODES.items():
        body += svg_node(name, spec)
    arrow = '<path class="arrowhead" d="M0,0 L10,5 L0,10 z"/>'
    arrow_start = '<path class="arrowhead" d="M10,0 L0,5 L10,10 z"/>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {-pad:g} {WIDTH} {canvas_h}" width="{WIDTH}" height="{canvas_h}">
<style>:root{{{variables}}}{CSS}</style>
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">{arrow}</marker>
<marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto">{arrow_start}</marker>
</defs>
<rect fill="{theme['bg']}" y="{-pad:g}" width="{WIDTH}" height="{canvas_h}"/>
{chr(10).join(body)}
</svg>"""


def render_png(svg: str, out: pathlib.Path):
    """Rasterize with macOS Quick Look (square output), then center-crop with sips."""
    size = max(WIDTH, HEIGHT)
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "diagram.svg"
        src.write_text(svg)
        subprocess.run(["qlmanage", "-t", "-s", str(size * SCALE), "-o", tmp, str(src)],
                       check=True, capture_output=True)
        subprocess.run(["sips", "-c", str(HEIGHT * SCALE), str(WIDTH * SCALE),
                        f"{src}.png", "--out", str(out)], check=True, capture_output=True)


def main():
    here = pathlib.Path(__file__).parent
    for name, theme in THEMES.items():
        out = here / f"architecture-{name}.png"
        render_png(build_svg(theme, max(WIDTH, HEIGHT)), out)
        print(out)


if __name__ == "__main__":
    main()
