"""Shared renderer for the diagrams in this directory (macOS, no dependencies).

A diagram module defines WIDTH, HEIGHT, GROUPS, NODES and EDGES and calls
render(__file__, globals()). See architecture.py for the format.
"""

from __future__ import annotations

import pathlib
import subprocess
import tempfile
from dataclasses import dataclass

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


class Diagram:
    def __init__(self, spec: dict):
        self.width = spec["WIDTH"]
        self.height = spec["HEIGHT"]
        self.groups = spec.get("GROUPS", {})
        self.nodes = spec["NODES"]
        self.edges = spec["EDGES"]
        self.boxes = {name: Box(*s["box"]) for name, s in {**self.groups, **self.nodes}.items()}

    def endpoint(self, ref: str, shift: float) -> tuple[tuple[float, float], str]:
        name, side = ref.split(".")
        return self.boxes[name].anchor(side, shift), side

    def route(self, edge: dict) -> list[tuple[float, float]]:
        (x1, y1), side1 = self.endpoint(edge["src"], edge.get("from_shift", 0))
        (x2, y2), _ = self.endpoint(edge["dst"], edge.get("to_shift", 0))
        points = [(x1, y1)]
        if x1 != x2 and y1 != y2:
            points.append((x1, y2) if side1 in ("top", "bottom") else (x2, y1))
        points.append((x2, y2))
        return points

    def svg_edge(self, edge: dict) -> list[str]:
        pts = self.route(edge)
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

    def svg_group(self, name: str, spec: dict) -> list[str]:
        b = self.boxes[name]
        cls = spec.get("style", "group")
        if spec.get("label_right"):
            x, anchor = b.x + b.w - 16, "end"
        else:
            x, anchor = b.x + 16, "start"
        return [
            f'<rect class="{cls}" x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="14"/>',
            f'<text class="group-label" x="{x}" y="{b.y + 24}" style="text-anchor:{anchor}">{spec["label"]}</text>',
        ]

    def svg_node(self, name: str, spec: dict) -> list[str]:
        b = self.boxes[name]
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

    def build_svg(self, theme: dict, canvas_h: int) -> str:
        """canvas_h > height pads the canvas vertically (Quick Look renders squares)."""
        pad = (canvas_h - self.height) / 2
        variables = ";".join(f"--{k}:{v}" for k, v in theme.items())
        body = []
        for name, spec in self.groups.items():
            body += self.svg_group(name, spec)
        for edge in self.edges:
            body += self.svg_edge(edge)
        for name, spec in self.nodes.items():
            body += self.svg_node(name, spec)
        arrow = '<path class="arrowhead" d="M0,0 L10,5 L0,10 z"/>'
        arrow_start = '<path class="arrowhead" d="M10,0 L0,5 L10,10 z"/>'
        return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {-pad:g} {self.width} {canvas_h}" width="{self.width}" height="{canvas_h}">
<style>:root{{{variables}}}{CSS}</style>
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">{arrow}</marker>
<marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto">{arrow_start}</marker>
</defs>
<rect fill="{theme['bg']}" y="{-pad:g}" width="{self.width}" height="{canvas_h}"/>
{chr(10).join(body)}
</svg>"""

    def render_png(self, svg: str, out: pathlib.Path):
        """Rasterize with macOS Quick Look (square output), then center-crop with sips."""
        size = max(self.width, self.height)
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "diagram.svg"
            src.write_text(svg)
            subprocess.run(["qlmanage", "-t", "-s", str(size * SCALE), "-o", tmp, str(src)],
                           check=True, capture_output=True)
            subprocess.run(["sips", "-c", str(self.height * SCALE), str(self.width * SCALE),
                            f"{src}.png", "--out", str(out)], check=True, capture_output=True)


def pull_back(a, b, gap):
    """Move b toward a by gap, so arrowheads don't touch boxes."""
    (ax, ay), (bx, by) = a, b
    length = abs(bx - ax) + abs(by - ay)  # segments are axis-aligned
    return bx - (bx - ax) / length * gap, by - (by - ay) / length * gap


def render(module_file: str, spec: dict):
    """Writes <module>-light.png and <module>-dark.png next to the diagram module."""
    path = pathlib.Path(module_file)
    diagram = Diagram(spec)
    for name, theme in THEMES.items():
        out = path.parent / f"{path.stem}-{name}.png"
        diagram.render_png(diagram.build_svg(theme, max(diagram.width, diagram.height)), out)
        print(out)
