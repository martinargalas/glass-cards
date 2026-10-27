import subprocess, sys, os
OUT = os.path.dirname(os.path.abspath(__file__))
FF = "/opt/homebrew/bin/ffmpeg"

def field(blobs):
    # stores gaussian weights g_i into vars 1..n; x,y normalized with aspect
    s = "st(0,X/W*1.6);st(9,Y/H);"
    for i, (bx, by, sig, _) in enumerate(blobs, 1):
        s += f"st({i},exp(-((ld(0)-{bx*1.6})^2+(ld(9)-{by})^2)/{sig}));"
    return s

def chan(base, blobs, ch, lines, line_col, line_amt):
    e = field(blobs)
    v = f"{base[ch]}"
    for i, (_, _, _, col) in enumerate(blobs, 1):
        v += f"+ld({i})*({col[ch]}-{base[ch]})"
    if lines:
        h = "+".join(f"ld({i})" for i in range(1, len(blobs) + 1))
        h = f"({h}+0.18*sin(ld(0)*5.1+ld(9)*3.3)+0.12*sin(ld(9)*7.7-ld(0)*2.2))"
        e += f"st(8,mod({h}*{lines},1));st(7,exp(-((ld(8)-0.5)^2)/0.0016));"
        v = f"({v})*(1-{line_amt}*ld(7))+{line_col[ch]}*{line_amt}*ld(7)"
    return e + f"clip({v},0,255)"

def render(name, base, blobs, lines=0, line_col=(255,255,255), line_amt=0.0, grain=7):
    expr = ":".join(f"{c}='{chan(base, blobs, i, lines, line_col, line_amt)}'" for i, c in enumerate("rgb"))
    vf = f"geq={expr},scale=3200:2000:flags=bicubic,format=yuv444p,noise=alls={grain}:allf=u,format=yuvj420p"
    subprocess.run([FF, "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=1600x1000,format=gbrp",
                    "-vf", vf, "-frames:v", "1", "-q:v", "2", f"{OUT}/{name}.jpg"], check=True)
    subprocess.run([FF, "-v", "error", "-y", "-i", f"{OUT}/{name}.jpg", "-vf", "scale=800:-1", f"{OUT}/thumb-{name}.jpg"], check=True)

L_BASE = (232, 229, 222)
L_BLOBS = [(0.18, 0.28, 0.10, (190, 206, 192)),   # sage
           (0.82, 0.22, 0.12, (186, 202, 222)),   # dusty blue
           (0.62, 0.84, 0.11, (236, 208, 188)),   # peach
           (0.12, 0.88, 0.08, (210, 202, 226))]   # lavender
D_BASE = (26, 28, 32)
D_BLOBS = [(0.18, 0.28, 0.10, (30, 54, 56)),
           (0.82, 0.22, 0.12, (36, 46, 78)),
           (0.62, 0.84, 0.11, (70, 50, 42)),
           (0.12, 0.88, 0.08, (54, 42, 66))]

which = sys.argv[1:] or ["mist", "topo"]
if "mist" in which:
    render("mist-light", L_BASE, L_BLOBS, grain=6)
    render("mist-dark", D_BASE, D_BLOBS, grain=5)
if "topo" in which:
    render("topo-light", L_BASE, L_BLOBS, lines=9, line_col=(255,255,255), line_amt=0.55, grain=6)
    render("topo-dark", D_BASE, D_BLOBS, lines=9, line_col=(150,160,175), line_amt=0.22, grain=5)
