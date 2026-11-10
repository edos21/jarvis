---
name: Jarvis
description: A written account of the day, with what needs action underneath.
colors:
  paper: "#eef1f5"
  sheet: "#ffffff"
  ink-blue-black: "#1b2230"
  slate: "#556079"
  hairline: "#d9dee8"
  control-edge: "#747f97"
  ink-blue: "#2f4fb3"
  on-ink-blue: "#ffffff"
  rail: "#1b2230"
  rail-label: "#a9b4cb"
  rail-strong: "#f2f4f8"
  critical: "#a32318"
  warning: "#a44b07"
  info: "#2f4fb3"
  good: "#1b6e44"
  highlight: "#dfe5f6"
  graphite: "#1a1d21"
  graphite-sheet: "#24272c"
  warm-off-white: "#e6e2d8"
  graphite-muted: "#adb0b8"
  graphite-line: "#383c43"
  graphite-control-edge: "#858a94"
  amber: "#f0a73a"
  on-amber: "#1a1306"
  graphite-rail: "#131518"
  graphite-rail-label: "#a6aab3"
  graphite-rail-strong: "#e6e2d8"
  critical-dark: "#ff8275"
  warning-dark: "#f4d35e"
  info-dark: "#9ab6ff"
  good-dark: "#62d09a"
  highlight-dark: "#463a22"
typography:
  display:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.25
  briefing:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.42
  headline:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.25
  briefing-compact:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.42
  note:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  metadata:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  fine:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  section-title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.6
  figure:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "20px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.on-ink-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-plain:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-blue-black}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.critical}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-blue-black}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  today-card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-blue-black}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  nav-item-active:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.on-ink-blue}"
    rounded: "{rounded.lg}"
    size: "40px"
---

# Design System: Jarvis

## Overview

**Creative North Star: "El parte del día"**

Jarvis reads like a morning report written for one person: a serif paragraph that says how the day stands, then the
items that ask for something, ordered by urgency. The light theme is cool paper with ink blue. The dark theme is
graphite with amber, a console with its own character rather than an inverted light theme. Both share one structure: a
narrow rail, a reading column and, on wide screens, a side column of quiet figures.

The interface is flat, restrained and typographic. Newsreader carries the voice of the report, IBM Plex Sans carries
the work, IBM Plex Mono carries the numbers. Color is reserved for state: severity, movement and the current place.

Its explicit anti-reference is the dashboard of columns that has to be walked through.

**Key Characteristics:**

- A written briefing above action cards ordered by urgency.
- Two authored themes: paper and ink blue, graphite and amber.
- Flat surfaces separated by hairlines, with shadows only on what floats.
- A severity stripe on the left edge of each card.
- Tabular figures wherever numbers are compared.

## Colors

Each theme uses one accent, cool neutrals in light and near-neutral graphite with a warm ink in dark.

### Primary

- **Ink Blue** (light) and **Amber** (dark): primary buttons, the current place in the rail, links and focus rings.

### Neutral

- **Paper** and **Graphite:** the page.
- **Sheet** and **Graphite Sheet:** cards, fields and plain buttons.
- **Ink Blue-Black** and **Warm Off-White:** primary text. The dark ink is deliberately not pure white.
- **Slate** and **Graphite Muted:** metadata and secondary text.
- **Hairline** and **Graphite Line:** dividers and the edges of cards.
- **Control Edge** and **Graphite Control Edge:** the border of anything that can be used, and the fill of healthy
  meters, at 3:1 or better against the page.
- **Rail** and **Graphite Rail:** the navigation band, the darkest surface in each theme. **Rail Strong** is its
  brightest text, never pure white in the dark theme.

### Semantic

- **Critical, Warning, Info, Good:** severity stripes, status words and movement. Dark variants are lighter so they
  hold contrast on graphite. Warning has its own yellow in the dark theme, so it never reads as the accent.
- **Highlight:** the row under a selection, such as the agent report currently open.
- **Chart series 1 to 7** live in `web/src/styles.css`, in a fixed order validated for color blindness. Text never
  wears them.

### Named Rules

**The State Only Rule.** Color outside the accent means state. Nothing is colored for decoration.

**The Word Beside It Rule.** A color never carries meaning alone: every severity or status also has an icon and a word,
and every price movement has an arrow and its sign. Use the pieces in `web/src/components/Status.tsx`.

## Typography

**Display Font:** Newsreader Variable (with Georgia, serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace)

**Character:** A literary serif for what Jarvis says, an engineered grotesque for what the owner does, and a mono for
figures. Weights in use are 400, 500 and 600.

### Hierarchy

- **Display** (400, 28 to 32px, about 1.25): page greeting and page titles.
- **Briefing** (400, 22 to 24px, 1.42, 34em wide): the daily paragraph.
- **Title** (600, 16px, 1.45): card titles.
- **Body** (400, 15px, 1.6): content, card details, actions and agent reports. Prose stays near 70 characters (36em).
- **Metadata** (400, 14px, 1.5): timestamps, counts, sources and page subtitles.
- **Fine** (400, 13px): chart axes and legends only, where space forces it.
- **Section Title** (600, 15px): block headings, in sentence case.
- **Figure** (mono 500, 15px, tabular): numbers in rows and meters.

### Named Rules

**The Reading Floor Rule.** Body 15px or larger, metadata never under 13px, no weight under 400, prose near 70
characters per line. This comes from the owner's vision and outranks density. The scale is named in `web/src/styles.css`
(`text-fine`, `text-meta`, `text-body`, `text-title`); new text uses those steps.

**The No Dimming Rule.** Hierarchy comes from size, weight and a real color token, never from opacity on text.

## Layout

The shell is a 64px icon rail on the left at `sm` and up, and a labeled bottom bar on phones, with the page scrolling
in its own region. Today centers a 1180px grid with a reading column up to 768px and a 320px side column at `lg`; below
that, the side column stacks under the cards. Other pages use a centered column between 768px and 1152px wide.

Spacing is a loose rhythm rather than a strict scale: 6 to 10px inside controls, 10 to 20px between cards and blocks,
20 to 32px at page gutters.

**The Thumb Rule.** Below 640px every control is at least 44px in both directions, with 8px between neighbors. Where the
drawing is small, as with task circles and checkboxes, the hit area grows and the drawing doesn't. Use `touchTarget` from
`web/src/components/Button.tsx`; the Mac keeps its compact sizes.

## Elevation & Depth

Flat by default: depth comes from tone (Paper under Sheet) and hairlines. Shadows appear only on what floats above the
page: a small one on the postpone menu, a larger one on chart tooltips and the deepest on the command bar.

**The Float Only Rule.** A surface in the flow of the page has no shadow.

## Shapes

Gently rounded and consistent: 8px on cards and rail items, 6px on buttons and fields, 12px on the command bar, full
circles on task checkboxes.

## Components

### Buttons

Compact and quiet, one filled action per card at most.

- **Shape:** 6px radius, 1px border.
- **Primary:** Ink Blue or Amber fill, with its paired ink. Used for the last action of a card when it completes
  something.
- **Plain:** Sheet with a Control Edge border; the border takes the accent on hover.
- **Danger:** plain, with Critical text; the border takes Critical on hover.
- **States:** disabled swaps to the page color with muted text and a hairline, never opacity; a mutation's error
  appears beside its button.

### Cards

- **Today Card:** Sheet, hairline border, 8px radius, a 4px left stripe in the severity color, then the severity label,
  title and detail on the left, actions wrapping on the right.
- **Severity label:** an icon with a distinct outline and a word, in Metadata at weight 500: octagon and "Urgente",
  triangle and "Atención", circle and "Aviso". It reads the same with no color at all.
- **Other blocks:** Sheet with a hairline border and 8px radius.

### Inputs

Control Edge stroke on Sheet, 6px radius; focus turns the border accent and adds the 2px focus ring. Text at 15px.

### Navigation

The rail on wide screens is 88px, each section an icon over its 14px name: at 18px several icons look alike, and a
tooltip needs a hover and a wait. It scrolls on its own in a short window; ⌘K and the theme stay as icons at its foot,
with their accessible names. The phone bar holds Hoy, Tareas, Correo, Cartera and "Más", with icon and label
at 14px; "Más" opens a bottom sheet with the other sections and the theme, and takes the accent when the current page
lives there. The current page gets an accent-filled tile. Notes and Statements are absent on the phone.

### Wallet positions

A table on wide screens and a stack of short blocks on phones: ticker and value, day move, P&L and weight. On the phone
the block is one button with a chevron; its actions appear only once tapped, one block at a time, and switching blocks
closes the open chart. Only one of the two layouts is mounted, so an open chart loads once.

### Decisions First

A screen opens on what someone decided to send me, not on the tools to tidy it. In Correo the people come first and
"Limpiar Gmail" sits folded at the end, a disclosure with its summary ("Analizado a las…, N remitentes, M correos
viejos"). A row with many actions keeps them behind a tap on its text (a cleanup sender always; a mail row on the
phone), one open row at a time. On the phone a mail row's checkbox still selects, and while something is selected the
group bar sticks to the top with what applies to it. Gmail's trash is said as "A la papelera" everywhere, since Gmail
keeps it 30 days.

### Segmented

A grouped choice for ranges and currencies on charts, in the same compact size as buttons.

### Command Bar

⌘K on the Mac: a centered 512px dialog on a dark scrim, with a query field and a filtered command list.

### Briefing

The signature of the product: the serif paragraph at the head of Today, with an optional voice control beneath it.

It is read once a day. The first open shows it whole and marks it read on the server, so every screen knows. It stays
open while I read, and folds on the next glance (a new mount, or the installed app coming back from the background)
into a 44px "Leer el parte de hoy" disclosure. It speaks on its own only while unread.

### What Waits

Above the cards, always: "Te esperan N" in the title size, then one count per severity with its icon and word
("2 urgentes", "3 de atención", "1 aviso"). It answers "does anything need me" before any card is read. With no cards,
an "Al día" sheet replaces the list: check icon in the good color, one sentence, and the next timed event from the
agenda when there is one. When a source failed, it says nothing waits "en lo que pude leer".

Everything is said once. The side column leaves out what already has a card: a task with a card (so it has a single
"done" control), a ticker with a wallet card from the movers, and the whole Mac block when a Mac card is up. The
agenda's events stay, since they are the day's timeline, and so do the headlines, which say why something moved. On
the phone, where the column falls below every card, "Lo próximo" sits under the count and the Mac block is left to its
own section.

### Numbers and Verbs

Every figure goes through `web/src/lib/format.ts` in es-UY: a decimal comma, a point between thousands, and the
currency code after the number, USD included ("43.000 USD", "680,00 EUR"). Totals round to whole units; prices keep
the cents; a weight has one decimal. A table names its currency once, in the column header ("Valor USD"), and its cells
go bare. Input values keep a decimal point, because that is what the field parses.

Three verbs remove things, each with one meaning: "A la papelera" for Gmail, which keeps it 30 days; "Borrar" for
Jarvis's own data (notes, tasks, statement rows, payments, levels); "Borrar para siempre" for what cannot come back on
the Mac. "Archivar" moves mail out of the inbox and deletes nothing.

A sentence never ends on a time: "a. m." already carries its period, so the time goes first ("A las 10:01 a. m.
terminó la limpieza.").

## Do's and Don'ts

### Do:

- **Do** keep the briefing in Newsreader at the head of Today on the first open of the day.
- **Do** use Warm Off-White on graphite in the dark theme.
- **Do** set compared numbers in tabular figures.
- **Do** keep each severity stripe paired with the severity label.
- **Do** read every new color through the tokens in `web/src/styles.css`.

### Don't:

- **Don't** introduce text under 13px, or body text under 15px.
- **Don't** dim text with opacity or with a translucent text color.
- **Don't** use pure white on near-black.
- **Don't** add shadows to in-flow surfaces.
- **Don't** turn Today into a dashboard of columns that has to be walked through.
