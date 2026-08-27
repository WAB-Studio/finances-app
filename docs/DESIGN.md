# Shared fund app — design guide

Where interface decisions that outlive a single slice are written down.

## The domain leads

- Derive every interface decision from the domain, never from a pattern borrowed for its looks.
- Put the person's experience ahead of what is convenient to build.
- Give the screen to the action the person came to perform.

## Mobile first

RNF-08 sets the requirement. This is how it shows in the interface.

- Design and build every screen for the narrow viewport first.
- Write the unprefixed value of a responsive prop for the narrow viewport.
  Add `xs`, `sm`, `md`, `lg` or `xl` only for what changes above it.
- Treat the narrow viewport as the base case, never as a fallback.
- A screen is done only once it holds at the narrow viewport: no horizontal
  overflow, no overlapping controls, no tap target too small to hit.

## Navigation

- Keep one action reachable at all times. Everything else is found.
- Put the frequent action within thumb reach. Keep navigation out of that zone.
- Open the destinations from a panel.
- Keep the active fund visible wherever a write can happen.
