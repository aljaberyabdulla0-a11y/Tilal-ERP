---
name: Emerald Executive
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#404944'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#707974'
  outline-variant: '#bfc9c3'
  surface-tint: '#2b6954'
  primary: '#003527'
  on-primary: '#ffffff'
  primary-container: '#064e3b'
  on-primary-container: '#80bea6'
  inverse-primary: '#95d3ba'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#0e3427'
  on-tertiary: '#ffffff'
  tertiary-container: '#274b3c'
  on-tertiary-container: '#93baa7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b0f0d6'
  primary-fixed-dim: '#95d3ba'
  on-primary-fixed: '#002117'
  on-primary-fixed-variant: '#0b513d'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#c3ecd7'
  tertiary-fixed-dim: '#a8cfbc'
  on-tertiary-fixed: '#002115'
  on-tertiary-fixed-variant: '#294e3f'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-lg:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  headline-md-mobile:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar_width: 256px
  page_padding: 24px
  gutter: 16px
  card_padding: 20px
  stack_sm: 8px
  stack_md: 16px
  stack_lg: 24px
---

## Brand & Style

This design system is tailored for Tilal Real Estate Marketing, embodying an **Executive Modern** aesthetic that balances high-density data management with a serene, professional atmosphere. The visual narrative is built on the concept of "The Emerald Anchor"—using deep, stable greens to ground the user experience while employing light, airy surfaces to ensure the ERP feels breathable during extended use.

The style leverages **Modern Minimalism** with subtle **Glassmorphism** accents. It prioritizes clarity and authority, ensuring that real estate professionals feel a sense of calm control. The primary language direction is Right-to-Left (RTL), which dictates a specific flow of attention from the right-hand navigation to the left-hand content area.

## Colors

The palette is centered around a monochromatic emerald scale to establish brand authority.
- **Emerald Deep (#064E3B)** serves as the "source of truth," used for active navigation states, primary actions, and semantic headers.
- **Emerald Accent (#10B981)** provides a vibrant contrast for interactive elements like links and focus rings, ensuring high visibility without breaking the executive tone.
- **Mint Tertiary (#D1FAE5)** is utilized for low-emphasis containers and success-state backgrounds.
- **Semantic Accents**: Red (#EF4444) and Amber (#F59E0B) are reserved strictly for status-driven cards and alerts (e.g., late payments or due tasks).

## Typography

The design system utilizes **IBM Plex Sans Arabic** for its exceptional legibility in professional environments and its balanced weight between Arabic and Latin characters.

- **Weight Usage**: Use Bold (700) and SemiBold (600) for structural headings and data summaries. Use Regular (400) for all body text and descriptions. Medium (500) is reserved for labels and navigation items.
- **RTL Considerations**: Ensure line-height is generous (minimum 1.5x for body text) to accommodate Arabic diacritics without overlapping.
- **Hierarchy**: The primary focus is on the `body-md` for data entries, while `headline-sm` is used for card titles.

## Layout & Spacing

This design system uses a **Fixed-Fluid Hybrid** layout model optimized for RTL (Right-to-Left).

- **Sidebar**: A fixed 256px sidebar is docked to the right edge. It remains persistent to provide immediate access to core ERP modules.
- **Top Bar**: A slim, high-index bar contains search, notifications, and profile, utilizing a glassmorphic background blur to remain distinct from the content below.
- **Grid**: Use a 12-column fluid grid for the main content area. Gutters are fixed at 16px to maintain data density.
- **Breakpoints**:
  - **Desktop (1280px+)**: Full sidebar + 12 columns.
  - **Tablet (768px - 1279px)**: Sidebar collapses to icons; 8 columns.
  - **Mobile (Below 768px)**: Sidebar becomes an overlay; 4 columns; horizontal scrolling enabled for all data tables.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Selective Translucency**.

- **Surface Tiers**: The base background is neutral gray (#F9FAFB). Content resides on pure white (#FFFFFF) surfaces with a subtle 1px border (#E5E7EB).
- **Glassmorphism**: Applied to the Top Bar and specific "High-Level Insight" cards. Use `rgba(255, 255, 255, 0.7)` with a 20px backdrop-filter blur.
- **Shadows**: Use a single, soft "Executive Shadow" for floating elements: `0px 4px 20px rgba(0, 0, 0, 0.05)`.
- **Side-Accents**: Status-driven depth is reinforced not by shadows, but by a 4px solid border on the `start` (right) edge of cards to indicate urgency (Red/Amber) or stability (Emerald).

## Shapes

The shape language is consistently **Rounded (Level 2)** to soften the "industrial" feel of an ERP.

- **Standard Elements**: Buttons, input fields, and small containers use a 0.5rem (8px) radius.
- **Cards**: All data and glass cards use a 1rem (16px) radius to create clear visual separation between modules.
- **Interactive Pill**: Navigation active states and badges use a fully rounded (pill) shape to denote interactivity or categorized metadata.

## Components

### Buttons & Interaction
- **Primary**: Solid Emerald (#064E3B) with white text. Hover state shifts to #053A2C.
- **Secondary**: Mint (#D1FAE5) background with Emerald text.
- **Ghost**: No background, Emerald text, 1px border on hover.

### Cards & Badges
- **Glass Insight Cards**: Used for top-level metrics. Features 20px blur and soft 5% opacity shadows.
- **Side-Accent Cards**: Standard cards for tasks/leads. A 4px vertical bar on the right side indicates status.
- **Pill Badges**: Low-contrast pairs (e.g., Mint background with Emerald text) for categorization.

### Data Tables
- **Header**: Sticky with a subtle bottom hairline border. Use #F9FAFB background for the header row to distinguish from data.
- **Rows**: 56px height for readability. On hover, apply a #F3F4F6 background tint.
- **Mobile**: Tables must wrap in a container with `overflow-x: auto` to prevent layout breaking.

### Form Inputs
- **Fields**: White background, 1px Gray border. On focus, the border transitions to Emerald Accent (#10B981) with a 2px soft glow.
- **Labels**: Always positioned above the input, aligned to the right for RTL.
