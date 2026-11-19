# Kaapi & Marble - design plan
Subject: an Indian café (Irani-café crockery, enamel signboards, marble-top tables).
Primary job: customer portal = make a dish feel real on *your* table, then order in 3 taps.
Staff software = glanceable, fast billing/KOT/stock on a counter tablet.

Palette
- Cobalt   #1B3790  enamel-sign blue, brand + primary actions (plate rims use it too)
- Deep     #12275F  staff sidebar, AR glass tint
- Saffron  #F2A81D  the one warm accent: CTAs on cobalt, "new order" signal
- Marble   #F1F2F4  cool white-grey app ground (not cream)
- Ink      #19213A  text (blue-black, from the cobalt family)
- Leaf #1F8A4C veg / success; Rust #8C3B17 non-veg (FSSAI marks); Danger #C2341D

Type
- Yatra One (signboard lettering) for the wordmark, hero line and dish names in the AR card only
- Anek Latin (Indian-designed sans, width axis) for all UI; tabular numerals for money
- Receipt preview only: monospace (it is a thermal print)

Layout
- Customer: single phone column (max 560px). Cobalt header with enamel-plate wordmark,
  hero = live 3D dish on a marble tabletop + "Open camera". Menu as a list on one sheet
  with dividers (not a card grid). Bottom nav: Menu, Table view (camera), Order, Bills.
- AR: full-bleed camera/photo, dark glass card at bottom, swipe to change dish.
- Staff: deep-cobalt sidebar, marble ground, white panels with hairline borders.

Principles
- Spend boldness once: the dish on the marble table. Everything else quiet.
- Money right-aligned, tabular, Indian grouping (₹1,23,456).
- No all-caps eyebrows, no middle-dot meta strings, no arrows in buttons.
