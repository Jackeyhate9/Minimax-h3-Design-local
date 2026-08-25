# Design

The configuration surface is an operations console used beside a desktop creative application. It uses a light, neutral workspace with ink-blue status color, compact native controls, and clear service rows rather than dashboard cards.

## Tokens

- Canvas: `#f4f6f8`; working surface: `#ffffff`; ink: `#18212b`; muted ink: `#52606d`.
- Local/healthy: `#087e6a`; action: `#2255d6`; blocked/error: `#b42318`; warning: `#9a6700`.
- Border: `#d7dde5`; focus: `#2255d6`; radius: 12px for grouped surfaces, 8px for controls.
- System UI font stack; monospace only for endpoint values and model IDs.

## Layout

Desktop uses a narrow status rail beside one continuous settings sheet. Mobile stacks status above settings. Service groups are separated by whitespace and rules, not repeated floating cards.

## Interaction

Discovery is explicit and never changes a selection automatically. Save reports the exact next action. Disabled workflow controls remain readable and explain why generation is unavailable. Motion is limited to the connection-status sweep and respects reduced motion.
