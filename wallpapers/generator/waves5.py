import subprocess, sys, os
OUT = os.path.dirname(os.path.abspath(__file__))
FF = "/opt/homebrew/bin/ffmpeg"

# band boundaries: y = base + a1*sin(f1*x+p1) + a2*sin(f2*x+p2)   (x 0..1.6, y 0..1)
BOUNDS = [(0.20, 0.07, 2.1, 0.4, 0.025, 5.3, 1.0),
          (0.38, 0.09, 1.7, 2.2, 0.03, 4.1, 0.3),
          (0.56, 0.08, 2.4, 4.0, 0.02, 6.2, 2.1),
          (0.74, 0.10, 1.5, 1.1, 0.03, 3.7, 4.4),
          (0.90, 0.06, 2.0, 5.2, 0.02, 5.9, 0.7)]

def chan(cols, ch, w, shade, hl):
    e = "st(0,X/W*1.6);st(9,Y/H);"
    v = f"{cols[0][ch]}"
    sh = "1"
    for i, (b, a1, f1, p1, a2, f2, p2) in enumerate(BOUNDS, 1):
        yk = f"({b}+{a1}*sin({f1}*ld(0)+{p1})+{a2}*sin({f2}*ld(0)+{p2}))"
        e += f"st({i},ld(9)-{yk});"          # >0 below boundary
        s = f"(1/(1+exp(-ld({i})/{w})))"
        v += f"+{s}*({cols[i][ch]}-{cols[i-1][ch]})"
        # shadow just below each boundary (band above casts onto band below), light rim above
        sh += f"*(1-{shade}*{s}*exp(-max(ld({i}),0)/0.045))*(1+{hl}*(1-{s})*exp(min(ld({i}),0)/0.012))"
    return e + f"clip(({v})*{sh},0,255)"

def render(name, cols, w=0.00035, shade=0.10, hl=0.05, grain=5):
    expr = ":".join(f"{c}='{chan(cols, i, w, shade, hl)}'" for i, c in enumerate("rgb"))
    vf = f"geq={expr},format=yuv444p,noise=alls={grain}:allf=u,format=yuvj420p"
    subprocess.run([FF, "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=3200x2000,format=gbrp",
                    "-vf", vf, "-frames:v", "1", "-q:v", "2", f"{OUT}/{name}.jpg"], check=True)
    subprocess.run([FF, "-v", "error", "-y", "-i", f"{OUT}/{name}.jpg", "-vf", "scale=800:-1", f"{OUT}/thumb-{name}.jpg"], check=True)

# muted, tonal: light warm-grey → sage → blue-grey → mauve → sand
LIGHT = [(236, 233, 226), (214, 222, 212), (200, 211, 222), (222, 210, 214), (232, 220, 204), (214, 214, 218)]
DARK  = [(30, 32, 36), (34, 46, 46), (36, 44, 62), (52, 42, 54), (58, 48, 40), (38, 38, 44)]
# cooler, almost monochrome variant
LIGHT2 = [(232, 234, 238), (216, 222, 230), (202, 212, 224), (220, 226, 232), (206, 214, 226), (226, 230, 236)]
DARK2  = [(26, 30, 38), (32, 40, 54), (40, 50, 68), (30, 36, 48), (44, 54, 72), (28, 32, 42)]



LIGHT4 = [(138, 154, 180), (186, 200, 218), (224, 230, 239), (176, 192, 212), (228, 233, 241), (204, 214, 228)]
render("blue6-light", LIGHT4, shade=0.16, hl=0.10)

DARK3  = [(20, 24, 32), (34, 46, 66), (52, 68, 94), (26, 32, 46), (60, 76, 104), (24, 30, 42)]
render("blue6-dark", DARK3, shade=0.26, hl=0.14)
