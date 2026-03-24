# YouTube Summarizer Extension - Implementation Roadmap

## Project Status: 🚧 In Progress

**Started:** 2026-03-24
**Current Phase:** Phase 1 - Critical Fixes
**Focus:** Ultra Minimal Design + Sidebar Persistence Fix

---

## Phase 1: Critical Fixes (Week 1) - 🔄 In Progress

### Sidebar Persistence Issue
- [x] Analyze current architecture
- [x] Move transcript fetching to background service worker
- [x] Move AI processing to background (already there, optimize)
- [x] Add chrome.storage.session for state persistence
- [x] Implement progress updates via messaging
- [x] Add retry logic with exponential backoff
- [ ] Update content.js to handle progress updates
- [x] Create background-new.js with improved architecture
- [ ] Test persistence across tab switches
- [ ] Update ROADMAP.md with progress

**Current Task:** Testing the persistence across tab switches

**Files Modified:**
- `background-new.js` - New background with persistence logic
- `content-new.js` - Updated content script with progress handling
- `content.css` - Ultra-minimal UI design (2026)
- `ROADMAP.md` - Progress tracking

---

## Phase 2: UI Modernization (Week 2) - 📅 Planned

### Ultra Minimal Design System
- [ ] Implement new color palette (dark mode first)
- [ ] Create CSS custom properties system
- [ ] Redesign sidebar components
  - [ ] Modern header with minimal branding
  - [ ] Progress states with visual feedback
  - [ ] Clean summary cards
  - [ ] Interactive timestamps
- [ ] Add dark/light mode toggle
- [ ] Implement micro-interactions
  - [ ] Hover states
  - [ ] Click feedback
  - [ ] Smooth transitions
- [ ] Add skeleton loading screens
- [ ] Accessibility improvements
  - [ ] Keyboard navigation
  - [ ] Focus management
  - [ ] ARIA labels
  - [ ] Color contrast fixes

---

## Phase 3: Feature Enhancements (Week 3) - 📅 Planned

### Summary Improvements
- [ ] Add summary length options (Quick/Standard/Detailed)
- [ ] Implement chapter detection
- [ ] Add export functionality (Markdown/Plain text)
- [ ] Create summary history view
- [ ] Add transcript quality scoring
- [ ] Implement "Retry" on failures

---

## Phase 4: Polish & Testing (Week 4) - 📅 Planned

### Quality Assurance
- [ ] Accessibility audit (WCAG AA)
- [ ] Performance optimization
- [ ] Cross-browser testing
- [ ] User testing & feedback collection
- [ ] Update documentation
- [ ] Create user guide

---

## Technical Decisions

### Architecture Changes
**Problem:** Content script loses focus when user clicks away, stopping summarization
**Solution:** Move all processing to background service worker
- Background handles: transcript fetching, AI API calls, retry logic
- Content script handles: UI display, user interactions only
- Communication: chrome.runtime.sendMessage with progress updates

### Design Direction: Ultra Minimal
- **Inspiration:** Apple, Linear, Notion
- **Colors:** Single accent (blue) + neutral palette
- **Typography:** System fonts, generous whitespace
- **Animations:** Subtle, purposeful, 200-300ms
- **Dark Mode:** Default, with auto-detection

### Color Palette

**Dark Mode (Default):**
```css
--bg-primary: #0F172A
--bg-secondary: #1E293B
--bg-elevated: #334155
--text-primary: #F1F5F9
--text-secondary: #CBD5E1
--accent: #3B82F6
--border: #334155
```

**Light Mode:**
```css
--bg-primary: #FFFFFF
--bg-secondary: #F8FAFC
--text-primary: #0F172A
--text-secondary: #475569
--accent: #2563EB
--border: #E2E8F0
```

---

## Progress Log

### 2026-03-24
- ✅ Completed code analysis and research
- ✅ Created implementation roadmap
- 🔄 Started Phase 1: Refactoring background.js

---

## Next Actions

1. Update background.js with improved message handling
2. Update content.js to be display-only
3. Implement progress tracking in sidebar
4. Add retry logic for transcript fetching
5. Test persistence across tab switches

---

## Notes

- Prioritize reliability over features
- Dark mode is more popular for YouTube viewers
- Keep sidebar width at 400px for readability
- Use chrome.storage.session for temporary state (cleared on browser close)
- Use chrome.storage.local for persistent cache
