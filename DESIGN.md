# Kaapi & Marble - design plan
Subject: an Indian café (a south Indian coffee house: filter kaapi, roasted beans, marble-top tables).
Primary job: customer portal = make a dish feel real on *your* table, then order in 3 taps.
Staff software = glanceable, fast billing/KOT/stock on a counter tablet.

Palette (coffee house: espresso brown on warm white)
- Brand    #6F4A2F  roasted-coffee brown, primary actions, header, plate rims
- Espresso #3E2A1E  staff sidebar, welcome screen, cart bar; #26180F deepest (text on caramel)
- Caramel  #D59A55  the one warm accent: CTAs on brown, badges, "new order" signal
- Paper    #FBF9F6  warm white app ground; panels are pure #FFFFFF
- Ink      #2B1F17  text (brown-black); #62513F secondary, #8E7D6F faint
- Leaf #1F8A4C veg / success; Rust #8C3B17 non-veg (FSSAI marks); Danger #C2341D
CSS variables: --brand, --brand-2, --deep, --deeper, --brand-t, --caramel, --paper, --ink.

Type
- Yatra One (signboard lettering) for the wordmark, hero line and dish names in the AR card only
- Anek Latin (Indian-designed sans, width axis) for all UI; tabular numerals for money
- Receipt preview only: monospace (it is a thermal print)

Layout
- Customer: single phone column (max 560px). Brown header with enamel-plate wordmark,
  hero = live 3D dish on a marble tabletop + "Open camera". Menu as a list on one sheet
  with dividers (not a card grid). Bottom nav: Menu, Table view (camera), Order, Bills.
- AR: full-bleed camera/photo, dark glass card at bottom, swipe to change dish.
- Staff: espresso sidebar, warm white ground, white panels with hairline borders.

Principles
- Spend boldness once: the dish on the marble table. Everything else quiet.
- Money right-aligned, tabular, Indian grouping (₹1,23,456).
- No all-caps eyebrows, no middle-dot meta strings, no arrows in buttons.
