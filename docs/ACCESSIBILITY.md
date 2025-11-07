# Accessibility Requirements - Bare Minimum Compliance

This document outlines the minimum accessibility requirements for the Archivist application to meet basic WCAG AA compliance standards.

## Overview

The goal is to implement the **bare minimum** accessibility features required for basic compliance without extensive effort. This focuses on the most critical issues that affect the largest number of users.

## Critical Requirements (Must Fix Before Launch)

### 1. Semantic HTML Structure
- **Proper heading hierarchy**: Use h1 → h2 → h3 in logical order
- **Form labels**: All form elements must have proper `<label>` associations using `htmlFor`
- **Button semantics**: Buttons should be actual `<button>` elements, not divs with click handlers

### 2. ARIA Labels for Interactive Elements
- **Buttons without text**: Add `aria-label` for icon-only buttons
- **Custom components**: Add `role` attributes where semantic HTML isn't used
- **Form validation**: Add `aria-describedby` for error messages

### 3. Keyboard Navigation
- **Focus management**: Ensure all interactive elements are keyboard accessible
- **Modal focus**: Focus should be trapped within open modals
- **Focus indicators**: Visible focus outlines on all interactive elements

### 4. Screen Reader Support
- **Dynamic content**: Add `aria-live` regions for status updates and loading states
- **Hidden decorative content**: Add `aria-hidden="true"` to decorative icons

## Current Status

### ✅ Already Implemented
- Form labels in Contact.tsx (proper `htmlFor` associations)
- Basic focus styles with `focus:ring-2 focus:ring-blue-500`
- Some ARIA attributes in App.tsx (`role="group"`, `aria-label`, `aria-pressed`)

### ❌ Missing (Priority Fixes)
- ARIA labels for icon-only buttons (back button, menu button, etc.)
- Proper heading hierarchy throughout the app
- ARIA labels for file/drive selection controls
- Focus management in modals
- ARIA live regions for scan progress and status updates

## Implementation Checklist

### Quick Wins (1-2 hours total)
- [ ] Add `aria-label` to all icon-only buttons
- [ ] Add proper heading structure (`h1` for main title, `h2` for sections)
- [ ] Add `aria-hidden="true"` to decorative SVG icons
- [ ] Ensure all form elements have proper labels (most already done)

### Medium Effort (Half day)
- [ ] Add `aria-live` regions for:
  - Drive scanning progress
  - Search results updates
  - Status messages (success/error)
- [ ] Implement focus trap for modals
- [ ] Add `aria-describedby` for form validation errors

### Before Launch Verification
- [ ] All interactive elements have accessible names
- [ ] Proper heading hierarchy (h1 → h2 → h3)
- [ ] Keyboard navigation works for all core features
- [ ] Screen readers can announce dynamic content changes
- [ ] Focus indicators are visible and logical

## Testing

### Manual Testing
1. **Keyboard navigation**: Tab through entire interface
2. **Focus indicators**: Verify visible focus on all interactive elements
3. **Screen reader**: Test with built-in screen reader (VoiceOver on macOS)

### Automated Testing
- Use browser dev tools accessibility audit
- Check for ARIA attribute validation
- Verify semantic HTML structure

## Notes

- **Color contrast**: Current dark/light mode themes should already meet WCAG AA standards
- **Text scaling**: CSS already uses relative units for text sizing
- **Skip links**: Not required for desktop applications
- **Alternative text for images**: No content images in current design

## Resources

- [WCAG 2.1 AA Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/?versions=2.1&levels=aa)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Screen Reader Testing](https://webaim.org/articles/screenreader_testing/)