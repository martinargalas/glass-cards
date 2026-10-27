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
    gx, gy, gr, gs, gc = glow
    g = f"{gs}*exp(-((ld(0)-{gx*1.6})^2+(ld(9)-{gy})^2)/{gr})"
    return e + f"clip(({v})*{sh}*(1-{rimt})+{rim[ch]}*({rimt})+{g}*({gc[ch]}-({v})*{sh}),0,255)"

def render(name, sky_top, sky_hor, dunes, glow, **kw):
    expr = ":".join(f"{c}='{chan(sky_top, sky_hor, dunes, i, glow, **kw)}'" for i, c in enumerate("rgb"))
    vf = f"geq={expr},format=yuv444p,noise=alls=4:allf=u,format=yuvj420p"
    subprocess.run([FF, "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=3200x2000,format=gbrp",
                    "-vf", vf, "-frames:v", "1", "-q:v", "2", f"{OUT}/{name}.jpg"], check=True)
    subprocess.run([FF, "-v", "error", "-y", "-i", f"{OUT}/{name}.jpg", "-vf", "scale=800:-1", f"{OUT}/thumb-{name}.jpg"], check=True)

# DAY – airy: clear blue sky fading to a hazy white horizon, pale sunlit sand dunes
render("airy-light",
       sky_top=(122, 160, 204), sky_hor=(236, 240, 244),
       dunes=[((246, 240, 230), (226, 218, 206)),
              ((240, 232, 220), (218, 208, 194)),
              ((236, 226, 212), (212, 200, 184)),
              ((232, 220, 204), (206, 192, 176))],
       glow=(0.85, 0.12, 0.10, 0.25, (255, 252, 240)),
       shade=0.06, hl=0.35, rim=(255, 255, 255))
# NIGHT – intimate: same scene, deep plum dusk, a warm amber glow low on the horizon
render("airy-dark",
       sky_top=(22, 20, 34), sky_hor=(78, 52, 58),
       dunes=[((66, 46, 48), (44, 32, 38)),
              ((56, 40, 44), (38, 28, 34)),
              ((48, 34, 40), (32, 24, 30)),
              ((40, 30, 36), (26, 20, 26))],
       glow=(0.75, 0.50, 0.12, 0.35, (196, 120, 70)),
       shade=0.14, hl=0.28, rim=(214, 150, 104))
