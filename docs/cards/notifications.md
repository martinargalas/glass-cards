# Notifications

`custom:glass-notifications`

One pill with the most important message – the others counted (+2); a tap opens the list. A new message drops in from the top. Two kinds: messages your automations send, and alerts defined in the card that show while their condition holds.

![Notifications](../images/cards/notifications.webp)

**Good for:** the top bar of a wall tablet.

## Quick start

```yaml
type: custom:glass-notifications
entity: sensor.glass_notifications     # optional: messages from automations
alerts:
  - id: window_open
    level: warning                     # info | warning | alert
    icon: mdi:window-open-variant
    title: Bedroom window is open
    message: It's going to rain
    condition:
      entity: binary_sensor.bedroom_window
      state: "on"
```

### Messages from automations

Copy [`packages/glass_notifications.yaml`](../../packages/glass_notifications.yaml) to your
`config/packages/` – it adds the sensor `sensor.glass_notifications` and two scripts. Then, from
any automation:

```yaml
- action: script.glass_notify
  data:
    id: washer_done            # the same id replaces the message
    level: info                # info | warning | alert
    title: Washing is done
    icon: mdi:washing-machine
    ttl: 900                   # seconds; info expires after 15 min by default, the rest stays
```

`script.glass_notify_dismiss` (with the `id`) removes it on every screen. Dismissing an alert
hides it for an hour everywhere.

## Tips

- `place: between` sits in a row next to the status chips; `block` takes a full line; `overlay` covers its panel while shown (phones).

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `entity` | string | Entity |
| `place` | "between" \| "block" \| "overlay" | Placement |
| `size` | number | Size (px) |
| `alerts` | AlertConfig[] | Alerts |
| `snooze` | number | Dismissed alert hidden for |

<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
