# Shared fund app — design guide

Where interface decisions that outlive a single slice are written down.

## Mobile first

RNF-08 sets the requirement. This is how it shows in the interface.

- Design and build every screen for the narrow viewport first.
- Write the unprefixed value of a responsive prop for the narrow viewport.
  Add `xs`, `sm`, `md`, `lg` or `xl` only for what changes above it.
- Treat the narrow viewport as the base case, never as a fallback.
- A screen is done only once it holds at the narrow viewport: no horizontal
  overflow, no overlapping controls, no tap target too small to hit.

## Utility first

- Give the screen to the action the person came to perform.
- Rank a destination by how often it is used. Never by how important it looks.
- Spend permanent screen space only on what is used daily.

## Navigation

- Keep one action reachable at all times. Everything else is found.
- Put the frequent action within thumb reach. Keep navigation out of that zone.
- Open the destinations from a panel.
- Keep the active fund visible wherever a write can happen.
