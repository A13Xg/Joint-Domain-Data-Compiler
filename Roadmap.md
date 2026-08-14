# Roadmap

## How to Interact with This Roadmap

This roadmap is structured for both human review and agent-based planning. Each feature is a single item with a completion checkbox and implementation context.

**Format:**
- `- [ ]` indicates an incomplete feature
- `- [x]` indicates a completed feature
- Each feature has implementation details and technical context below it to guide implementation planning

**To modify this roadmap via conversation:**
1. Read this section to understand the format
2. Request changes like: "Add the following items to the roadmap..." or "Mark feature X as complete" or "Remove feature Y"
3. Provide the feature name and any implementation context details
4. The agent will maintain the same structure and format while making changes

---

## Features

- [ ] Build an expandable/modular scaffolding for a settings page
  - Web version: persist settings locally to browser storage
  - Desktop version: persist settings to a local directory
  - Should be modular enough to add new settings without restructuring
  - Consider creating a settings provider/hook for web and a file-based config system for desktop
  - Implementation should support both boolean toggles and numeric/string configurations

- [ ] Make visualization downsampling configurable via settings
  - Add a configurable maximum point count (N) to settings
  - For data arrays with length < N: plot all points
  - For data arrays with length >= N: calculate sampling factor Y = array.length / N (rounded to nearest whole number)
  - Sample every Y-th point from the original dataset and plot
  - Apply this to all visualization components that render line charts or data point displays
  - Make this setting accessible from the settings page (from feature #1)
