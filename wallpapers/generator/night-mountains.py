src = open("scene.py").read().split("# DAY")[0]
ns = {"__file__": __file__}
exec(src, ns)
ns["BOUNDS"][:] = [(0.48, 0.07, 3.1, 0.6, 0.03, 7.7, 1.3),
                   (0.60, 0.08, 2.6, 2.6, 0.03, 6.9, 0.2),
                   (0.73, 0.07, 3.4, 4.4, 0.025, 8.6, 2.0),
                   (0.87, 0.06, 2.3, 1.4, 0.025, 6.3, 4.1)]
# same hills after dusk: deep blue night sky, a warm amber glow low on the horizon,
# ridges in layered blue-grey, near ones darker; rims catch the warm light
ns["render"]("var-mountains-night",
       sky_top=(20, 26, 44), sky_hor=(92, 78, 86),
       dunes=[((70, 76, 96), (58, 64, 84)),
              ((54, 60, 80), (44, 50, 70)),
              ((42, 48, 68), (34, 40, 58)),
              ((32, 38, 56), (24, 30, 46))],
       glow=(0.72, 0.47, 0.10, 0.4, (214, 142, 88)),
       shade=0.10, hl=0.22, rim=(226, 176, 132))
