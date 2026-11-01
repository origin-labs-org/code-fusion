name: cf-uiux-pro
description: **UI/UX PROFESSIONAL SKILL** 🎨 Complete frontend expertise for building beautiful, accessible, performant user interfaces. Covers React/Vue/Angular, CSS/SCSS/Tailwind, design systems, accessibility (WCAG 2.1 AA), responsive design, animations, UX patterns, component architecture, state management, performance optimization. Use when working on ANY frontend/UI/UX task.
---

# 🎨 UI/UX PRO - Professional Frontend Skill

**Complete UI/UX engineering capability for modern web applications.**

> *"Design is not just what it looks like and feels like. Design is how it works."* — Steve Jobs

---

## 🎯 When to Use This Skill

- Building or modifying **any UI components**
- Implementing **design systems** or **component libraries**
- Creating **responsive layouts**
- Working with **CSS/animations/transitions**
- Ensuring **accessibility compliance** (WCAG 2.1)
- Optimizing **frontend performance**
- Implementing **UX patterns** and **interactions**
- **Code reviews** of frontend code
- **Design-to-code** implementation

---

## 🛠️ Technology Stack Coverage

### Frameworks
| Framework | Expertise | Key Patterns |
|----------|----------|-------------|
| **React 18+** | ⭐⭐⭐⭐⭐ | Hooks, Concurrent Features, Server Components |
| **Vue 3** | ⭐⭐⭐⭐⭐ | Composition API, Pinia, Suspense |
| **Angular 17+** | ⭐⭐⭐⭐ | Signals, Standalone Components |
| **Next.js/Nuxt** | ⭐⭐⭐⭐⭐ | SSR, SSG, ISR, Routing |

### Styling Solutions
| Solution | Best For |
|----------|----------|
| **Tailwind CSS** | Utility-first, rapid dev, design systems |
| **CSS Modules** | Component isolation |
| **Styled Components** | Dynamic theming |
| **SCSS/SASS** | Large codebases, variables |

---

## 📐 Design System Fundamentals

### Spacing System (4px base unit)
```typescript
const spacing = {
  0: '0px', 1: '4px', 2: '8px', 3: '12px', 4: '16px',
  5: '24px', 6: '32px', 7: '48px', 8: '64px'
}
```

### Typography Scale
```typescript
const fontSize = {
  xs: '0.75rem',    // 12px
  sm: '0.875rem',   // 14px
  base: '1rem',     // 16px
  lg: '1.125rem',   // 18px
  xl: '1.25rem',    // 20px
  '2xl': '1.5rem',  // 24px
  '3xl': '1.875rem' // 30px
}
```

---

## ♿ Accessibility (WCAG 2.1 AA)

### Non-Negotiable Rules

#### Keyboard Navigation
```tsx
// ✅ GOOD: All interactive elements keyboard accessible
<button 
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }}
> Click me</button>
```

#### Focus Management (Modals)
```tsx
useEffect(() => {
  if (isOpen) {
    previousFocusRef.current = document.activeElement as HTMLElement
    modalRef.current?.focus()
    
    const handleEsc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', handleEsc)
    
    return () => {
      document.removeEventListener('keydown', handleEsc)
      previousFocusRef.current?.focus() // Restore focus on close
    }
  }
}, [isOpen, onClose])
```

#### Color Contrast (WCAG Ratios)
- Normal text: **4.5:1** (AA), **7:1** (AAA)
- Large text (18pt+): **3:1** (AA), **4.5:1** (AAA)
- UI components: **3:1** (AA)

---

## 📱 Responsive Design (Mobile-First)

### Breakpoints
```css
/* Base: Mobile (0-639px) */
/* sm: 640px+ - Tablets */
/* md: 768px+ - Tablets */
/* lg: 1024px+ - Laptops */
/* xl: 1280px+ - Desktops */
```

### Touch Targets
```css
/* Minimum: 44x44px (iOS) / 48x48px (Android) */
.button { min-height: 44px; min-width: 44px; padding: 12px 16px; }
```

---

## ⚡ Performance Optimization

### Critical Rendering Path
```html
<!-- 1. Inline critical CSS -->
<!-- 2. Preload fonts/images -->
<!-- 3. Async non-critical JS -->
<!-- 4. Lazy load below-fold images -->
```

### React Performance Patterns
```tsx
// 1. Code splitting with lazy + Suspense
const HeavyComponent = lazy(() => import('./HeavyComponent'))

// 2. Memoization for expensive computations
const ExpensiveList = memo(({ items }) => { /* ... */ })

// 3. Virtualization for long lists (@tanstack/react-virtual)

// 4. Image optimization (WebP/AVIF, lazy loading)
```

---

## 🎭 Animations & Micro-interactions

### Principles
1. **Purposeful** - Communicates something
2. **Performant** - 60fps, GPU-accelerated
3. **Respectful** - Honors `prefers-reduced-motion`
4. **Quick** - ≤300ms feedback, ≤500ms transitions

### Animation Tokens
```css
:root {
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## 🧩 UX Patterns Included

1. **Command Palette** (Cmd+K) - Fuzzy search, keyboard nav
2. **Infinite Scroll** - Intersection Observer, skeleton loading
3. **Toast Notifications** - Auto-dismiss, exit animation, ARIA live
4. **Data Table** - Sort, filter, paginate, accessible
5. **Modal/Dialog** - Focus trap, Escape to close, scroll lock
6. **Dropdown Menu** - Keyboard nav, click outside close
7. **Tabs** - ARIA tabs, keyboard switching
8. **Tooltip** - Hover/focus trigger, delay, dismiss
9. **Skeleton Loading** - Shimmer animation, content preview
10. **Empty States** - Illustrations, CTAs, helpful guidance
11. **Error States** - Recovery actions, clear messaging
12. **Form Validation** - Inline errors, accessible descriptions

---

## 🔍 UI/UX Code Review Checklist

### Visual
- [ ] Matches design spec
- [ ] Responsive at all breakpoints
- [ ] Uses design tokens (no magic numbers)
- [ ] Empty/loading/error states designed

### Interaction  
- [ ] Hover/focus/active/disabled states
- [ ] Transitions smooth (150-300ms)
- [ ] No layout shift (CLS < 0.1)

### Accessibility
- [ ] Images have alt text
- [ ] Contrast ≥ 4.5:1 (AA)
- [ ] Keyboard navigable
- [ ] Screen reader friendly (ARIA labels)
- [ ] Reduced motion respected

### Performance
- [ ] Lighthouse > 90 all categories
- [ ] FCP < 1.8s, TTI < 3.8s, CLS < 0.1
- [ ] Images lazy loaded, optimized
- [ ] Bundle size analyzed

---

## 💡 Quick Commands

```bash
/ui-review                    # Full UI/UX review checklist
/ui-component <name>           # Generate component with best practices
/ui-accessibility             # Check WCAG compliance
/ui-performance              # Optimize performance
/ui-responsive               # Ensure responsive design
/ui-animate                   # Add polished animations
/ui-design-system             # Set up design tokens
```

---

*UI/UX Pro Skill v2.0 - Professional Frontend Engineering*
*Covers: React, Vue, Angular, Tailwind, Accessibility, Performance*
