# Generates the architecture diagram (light + dark).
# Render on macOS:
#   python3 architecture.py
#   for t in light dark; do qlmanage -t -s 2680 -o . sq-$t.svg; magick sq-$t.svg.png -crop 2680x1480+0+600 +repage architecture-$t.png; done
#   rm sq-*.svg sq-*.png

W, H = 1340, 740
out = []
def a(s): out.append(s)

def node(x, y, w, h, title, sub=None, cls="node"):
    a(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/>')
    cx = x + w / 2
    if sub:
        a(f'<text class="t" x="{cx}" y="{y + h/2 - 3}">{title}</text>')
        a(f'<text class="s" x="{cx}" y="{y + h/2 + 14}">{sub}</text>')
    else:
        a(f'<text class="t" x="{cx}" y="{y + h/2 + 5}">{title}</text>')

def cyl(x, y, w, h, title, sub, cls="store"):
    ry = 8
    a(f'<path class="{cls}" d="M{x},{y+ry} a{w/2},{ry} 0 0 1 {w},0 v{h-2*ry} a{w/2},{ry} 0 0 1 {-w},0 z"/>')
    a(f'<path class="{cls}-top" d="M{x},{y+ry} a{w/2},{ry} 0 0 0 {w},0"/>')
    cx = x + w / 2
    a(f'<text class="t" x="{cx}" y="{y + h/2 + 2}">{title}</text>')
    a(f'<text class="s" x="{cx}" y="{y + h/2 + 18}">{sub}</text>')

def group(x, y, w, h, label, cls="group", right=False):
    a(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="14"/>')
    if right:
        a(f'<text class="g" x="{x+w-16}" y="{y+24}" style="text-anchor:end">{label}</text>')
    else:
        a(f'<text class="g" x="{x+16}" y="{y+24}">{label}</text>')

def edge(pts, cls="e", start=False):
    d = "M" + " L".join(f"{px},{py}" for px, py in pts)
    ms = ' marker-start="url(#arr-s)"' if start else ""
    mk = "arr-d" if "dash" in cls else "arr"
    a(f'<path class="{cls}" d="{d}" marker-end="url(#{mk})"{ms}/>')

def lbl(x, y, text, anchor="middle"):
    a(f'<text class="l" x="{x}" y="{y}" text-anchor="{anchor}">{text}</text>')

# groups
group(20, 110, 170, 230, "PHONE")
group(255, 30, 695, 570, "DENARII RUNTIME  ·  Cloudflare Worker or Node container")
group(440, 200, 490, 280, "packages/core", cls="core", right=True)

# phone
node(35, 150, 140, 56, "Notification", "bank / wallet app")
node(35, 250, 140, 56, "MacroDroid", "HTTP POST action")
edge([(105, 206), (105, 248)])

# runtime
node(290, 70, 130, 50, "React SPA", "dashboard")
cyl(460, 126, 110, 56, "Rule packs", "YAML, bundled", cls="pack")
node(290, 250, 130, 56, "Hono API", "ingest · telegram · tRPC")
node(460, 250, 110, 56, "Classifier", "regex rules", cls="hl")
node(640, 250, 100, 56, "Dedupe", "±30 s")
node(800, 250, 115, 56, "Categorizer", "merchant rules")
node(640, 380, 150, 56, "Telegram flows", "prompts · commands")
node(640, 520, 150, 50, "Scheduler", "daily digest")

# outside
cyl(505, 640, 190, 64, "SQLite", "D1 or better-sqlite3")
node(290, 644, 130, 56, "Google OAuth", "Better Auth", cls="ext")
node(1030, 250, 140, 56, "LLM provider", "optional", cls="ext")
node(1030, 380, 140, 56, "Telegram", "Bot API", cls="ext")
a('<circle class="user" cx="1270" cy="408" r="36"/>')
a('<text class="t" x="1270" y="413">You</text>')

# edges
edge([(175, 278), (288, 278)]); lbl(232, 266, "POST /api/ingest")
edge([(420, 278), (458, 278)])
edge([(515, 182), (515, 248)])
edge([(355, 120), (355, 248)]); lbl(366, 190, "tRPC", "start")
edge([(570, 278), (638, 278)]); lbl(605, 256, "purchase"); lbl(605, 268, "transfer")
edge([(740, 278), (798, 278)])
edge([(515, 306), (515, 394), (638, 394)]); lbl(526, 352, "unmatched", "start")
edge([(857, 306), (857, 394), (792, 394)]); lbl(846, 352, "no merchant rule", "end")
edge([(915, 278), (1028, 278)], cls="e dash"); lbl(980, 244, "suggest"); lbl(980, 256, "extract"); lbl(980, 268, "propose rule")
edge([(792, 420), (1028, 420)], start=True)
edge([(1172, 408), (1232, 408)], start=True)
edge([(715, 520), (715, 438)])
edge([(600, 482), (600, 638)], start=True); lbl(611, 560, "Store", "start")
edge([(355, 306), (355, 642)], cls="e dash"); lbl(366, 620, "auth", "start")
edge([(1270, 372), (1270, 95), (422, 95)]); lbl(830, 87, "browser")

css = """
:root{--bg:#fbfaf7;--ink:#1d1d1f;--mute:#6b6b70;--line:#8a8a90;--node:#ffffff;--stroke:#c9c7c0;
--grp:#f2f0ea;--grpst:#dcd9d0;--core:#eaf1ee;--corest:#9fbfb1;--hl:#dbeae3;--hlst:#2f7a5c;
--ext:#fff7ec;--extst:#d39a4a;--store:#eef0f6;--storest:#8b93b5;--halo:#fbfaf7}
@media (prefers-color-scheme: dark){:root{--bg:#161618;--ink:#ececee;--mute:#9a9aa2;--line:#7a7a82;
--node:#222226;--stroke:#3b3b42;--grp:#1c1c1f;--grpst:#2e2e34;--core:#18241f;--corest:#2f5a48;
--hl:#1f3a2e;--hlst:#5fbf96;--ext:#2a2117;--extst:#b07f3c;--store:#1e2130;--storest:#5a6390;--halo:#161618}}
.bg{fill:var(--bg)}
text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;text-anchor:middle}
.t{font-size:14px;font-weight:600;fill:var(--ink)}
.s{font-size:11px;fill:var(--mute)}
.g{font-size:11px;font-weight:700;letter-spacing:.08em;fill:var(--mute);text-anchor:start}
.l{paint-order:stroke;stroke:var(--halo);stroke-width:5px;stroke-linejoin:round;font-size:11px;fill:var(--mute);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.node{fill:var(--node);stroke:var(--stroke);stroke-width:1.2}
.hl{fill:var(--hl);stroke:var(--hlst);stroke-width:1.6}
.ext{fill:var(--ext);stroke:var(--extst);stroke-width:1.2;stroke-dasharray:5 3}
.group{fill:var(--grp);stroke:var(--grpst);stroke-width:1}
.core{fill:var(--core);stroke:var(--corest);stroke-width:1.2;stroke-dasharray:6 4}
.store,.pack{fill:var(--store);stroke:var(--storest);stroke-width:1.2}
.store-top,.pack-top{fill:none;stroke:var(--storest);stroke-width:1.2}
.user{fill:var(--node);stroke:var(--ink);stroke-width:1.4}
.e{fill:none;stroke:var(--line);stroke-width:1.4}
.dash{stroke-dasharray:5 4}
.ah{fill:var(--line)}
"""
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="denarii architecture">
<style>{css}</style>
<defs>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker>
<marker id="arr-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker>
<marker id="arr-s" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M10,0 L0,5 L10,10 z"/></marker>
</defs>
<rect class="bg" width="{W}" height="{H}"/>
{chr(10).join(out)}
</svg>'''

import re as _re
root_light = _re.search(r":root\{[^}]*\}", css).group(0)
dark_vars = _re.search(r"@media \(prefers-color-scheme: dark\)\{:root\{([^}]*)\}\}", css).group(1)
base = _re.sub(r"@media \(prefers-color-scheme: dark\)\{:root\{[^}]*\}\}", "", svg)
pad = (W - H) // 2
sq = base.replace(f'viewBox="0 0 {W} {H}" width="{W}" height="{H}"', f'viewBox="0 {-pad} {W} {W}" width="{W}" height="{W}"')
sq = sq.replace(f'<rect class="bg" width="{W}" height="{H}"/>', f'<rect class="bg" y="{-pad}" width="{W}" height="{W}"/>')
open("sq-light.svg","w").write(sq)
open("sq-dark.svg","w").write(sq.replace(root_light, ":root{" + dark_vars + "}"))
print(W, H, pad)
