import subprocess, os
OUT = os.path.dirname(os.path.abspath(__file__))
FF = "/opt/homebrew/bin/ffmpeg"
# dune ridges (lower part); above the first one is open sky
BOUNDS = [(0.50, 0.06, 1.9, 0.6, 0.02, 4.7, 1.3),
          (0.63, 0.07, 1.5, 2.6, 0.025, 4.0, 0.2),
          (0.76, 0.06, 2.2, 4.4, 0.02, 5.6, 2.0),
          (0.89, 0.05, 1.7, 1.4, 0.02, 3.3, 4.1)]

def chan(sky_top, sky_hor, dunes, ch, glow, w=0.00035, shade=0.10, hl=0.06, rim=(255,255,255)):
    e = "st(0,X/W*1.6);st(9,Y/H);"
    # sky: vertical gradient, top → horizon
    v = f"({sky_top[ch]}+({sky_hor[ch]}-{sky_top[ch]})*pow(clip(ld(9)/0.55,0,1),1.4))"
    prev = sky_hor
    sh = "1"; rimt = "0"
    for i, (b, a1, f1, p1, a2, f2, p2) in enumerate(BOUNDS, 1):
        yk = f"({b}+{a1}*sin({f1}*ld(0)+{p1})+{a2}*sin({f2}*ld(0)+{p2}))"
        e += f"st({i},ld(9)-{yk});"
        s = f"(1/(1+exp(-ld({i})/{w})))"
        # each dune: lighter at its ridge, deeper towards its foot
        top_c, foot_c = dunes[i-1]
        dune = f"({top_c[ch]}+({foot_c[ch]}-{top_c[ch]})*clip(ld({i})/0.16,0,1))"
        v = f"({v})*(1-{s})+{s}*{dune}"
        sh += f"*(1-{shade}*{s}*exp(-max(ld({i}),0)/0.04))"
        rimt += f"+{hl}*{s}*exp(-max(ld({i}),0)/0.006)"
    base = f"(({v})*{sh}*(1-{rimt})+{rim[ch]}*({rimt}))"
    for gx, gy, gr, gs, gc in glow:
        g = f"{gs}*exp(-((ld(0)-{gx*1.6})^2+(ld(9)-{gy})^2)/{gr})"
        base = f"({base}+{g}*({gc[ch]}-{base}))"
    return e + f"clip({base},0,255)"

def render(name, sky_top, sky_hor, dunes, glow, **kw):
    expr = ":".join(f"{c}='{chan(sky_top, sky_hor, dunes, i, glow, **kw)}'" for i, c in enumerate("rgb"))
    vf = f"geq={expr},format=yuv444p,noise=alls=4:allf=u,format=yuvj420p"
    subprocess.run([FF, "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=3200x2000,format=gbrp",
                    "-vf", vf, "-frames:v", "1", "-q:v", "2", f"{OUT}/{name}.jpg"], check=True)
    subprocess.run([FF, "-v", "error", "-y", "-i", f"{OUT}/{name}.jpg", "-vf", "scale=800:-1", f"{OUT}/thumb-{name}.jpg"], check=True)


BOUNDS[:] = [(0.48, 0.07, 3.1, 0.6, 0.03, 7.7, 1.3),
             (0.60, 0.08, 2.6, 2.6, 0.03, 6.9, 0.2),
             (0.73, 0.07, 3.4, 4.4, 0.025, 8.6, 2.0),
             (0.87, 0.06, 2.3, 1.4, 0.025, 6.3, 4.1)]
DUNES = [((70, 76, 96), (58, 64, 84)), ((54, 60, 80), (44, 50, 70)),
         ((42, 48, 68), (34, 40, 58)), ((32, 38, 56), (24, 30, 46))]
VIOLET = (0.16, 0.42, 0.14, 0.42, (118, 84, 176))
import sys
for name, warm, rim in [
    ("night-amber", (214, 142, 88), (226, 176, 132)),   # as now
    ("night-rose",  (220, 128, 128), (232, 172, 168)),  # rose / coral
    ("night-peach", (232, 168, 120), (238, 196, 160)),  # softer peach-gold
    ("night-magenta", (204, 112, 160), (226, 164, 196)),# pink-magenta, closer to the violet
]:
    render(name, sky_top=(20, 24, 46), sky_hor=(88, 74, 96), dunes=DUNES,
           glow=[VIOLET, (0.72, 0.47, 0.10, 0.4, warm)], shade=0.10, hl=0.22, rim=rim)
