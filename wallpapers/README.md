# Wallpapers

Calm wallpapers for glass-cards dashboards, generated procedurally (no third-party
images), 3200×2000 JPEG. Each has a day (light) and night (dark) version of the same
scene, so HA can switch them with its dark mode.

| Set | Day | Night | Notes |
| --- | --- | --- | --- |
| **Blue hills** (default) | `hills-day.jpg` | `hills-night-blue-soft.jpg` | airy blue sky, hazy ridges; night: violet left, cool blue glow right, slightly blurred |
| Blue hills – night variants | | `hills-night-blue.jpg`, `-amber`, `-rose`, `-peach`, `-magenta`, `-plain` | same night scene, different glow colour (`plain` = no violet) |
| Green hills | `green-hills-day.jpg` | – | sage hills under the same sky |
| Calm sea | `sea-day.jpg` | – | flat horizon, soft swell lines |
| Dunes | `dunes-day.jpg` | `dunes-night.jpg` | pale sand dunes; night: plum dusk with amber glow |
| Steel waves | `steel-waves-day.jpg` | `steel-waves-night.jpg` / `-deep` | layered blue-grey waves, darker band on top for the header |
| Grey waves | `grey-waves-day.jpg` | `grey-waves-night.jpg` | low-contrast, almost monochrome |
| Pastel waves | `pastel-waves-day.jpg` | `pastel-waves-night.jpg` | sage, blue, mauve, sand |
| Topo | `topo-day.jpg` | `topo-night.jpg` | soft colour fields with thin contour lines |
| Paper | `paper-day.jpg` | `paper-night.jpg` | linen / paper texture |

## Use

Copy the files to `config/www/wallpapers/` and add a theme, e.g. `config/themes/glass/glass.yaml`:

```yaml
glass:
  modes:
    light:
      lovelace-background: center / cover no-repeat fixed url('/local/wallpapers/hills-day.jpg')
    dark:
      lovelace-background: center / cover no-repeat fixed url('/local/wallpapers/hills-night-blue-soft.jpg')
```

Then set `theme: glass` on the dashboard view and reload themes (`frontend.reload_themes`).

## Generator

`generator/` holds the scripts that made them (Python 3 stdlib + ffmpeg `geq`). They are
working scripts, not a polished tool: palettes and ridge shapes are edited in the files.
`scene.py` / `scene2.py` render the sky + ridge scenes, `waves5.py` the wave sets,
`make.py` topo, `tex.sh` paper.
