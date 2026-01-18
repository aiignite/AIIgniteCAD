# AGENTS.md

This file provides essential information for agentic coding agents working on this repository.

## Build, Lint, Test Commands

### Development
- `npm install` - Install dependencies
- `npm run dev` - Start development server on http://localhost:3000
- `npm run build` - Production build
- `npm run preview` - Preview production build

### Testing & Linting
- **No test framework is currently configured** - Add Vitest or Jest if needed
- **No linter is currently configured** - Add ESLint if needed
- Type checking: Run `npx tsc --noEmit` to verify TypeScript types

## Code Style Guidelines

### Project Overview
- **Type**: TypeScript + React 19.2.3 web application
- **Build Tool**: Vite 6.2.0
- **Styling**: Tailwind CSS (via CDN) + CSS custom properties
- **Purpose**: AI-powered CAD editor with DXF import/export

### Import Style
- Use absolute imports with `@/*` alias mapped to project root
- React imports: `import React, { useState, useEffect, useCallback, useRef } from 'react'`
- Type imports from local `types.ts`: `import { ToolType, CADElement, Point } from '../types'`
- Service imports: `import { exportToDXF } from '../services/dxfService'`

### Formatting
- Indentation: 4 spaces
- No Prettier/ESLint configured - follow existing patterns
- Max line length: ~100-120 characters (soft guideline)
- Use Tailwind utility classes for all styling
- CSS custom properties in `index.html` for theming

### TypeScript Conventions
- Use `React.FC<Props>` for functional components
- Define interfaces for all complex types
- Export enums from `types.ts` for constants (ToolType, SidePanelMode)
- Strict mode enabled in tsconfig.json
- No implicit any types
- Use optional properties with `?` when appropriate: `start?: Point`

### Naming Conventions
- **Components**: PascalCase (`Header`, `Toolbar`, `Canvas`)
- **Functions/Variables**: camelCase (`handleMouseDown`, `getSVGPoint`)
- **Constants**: Mostly camelCase, UPPER_SNAKE_CASE only for exports when distinctive
- **Files**: PascalCase for components (`Header.tsx`), lowercase for utilities (`dxfService.ts`)
- **IDs**: Use helper `Math.random().toString(36).substr(2, 9)` for unique IDs

### State Management Pattern
- Centralized state in `App.tsx` using React hooks
- Pass data down via props, pass callbacks up for mutations
- Use `useCallback` for handlers passed to child components
- History management: separate state for undo/redo stack
- Notifications: temporary state with auto-dismiss

### Component Architecture
- **App.tsx**: Main container, manages all global state
- **Components** (in `/components`): Header, Toolbar, Canvas, RightPanel, Footer, LoginPage
- **Services** (in `/services`): `dxfService.ts` (DXF import/export), `geminiService.ts` (AI integration)
- **Types**: Centralized in `types.ts`

### Error Handling
- Wrap async functions in try-catch blocks
- Use user-friendly notifications for errors (via `showNotification`)
- Console.error for debugging
- Never expose API keys or secrets in error messages

### React Patterns
- Functional components only (no class components)
- Hooks: `useState`, `useEffect`, `useCallback`, `useRef`, `useMemo`
- Event handlers: Use `React.MouseEvent`, `React.KeyboardEvent`, etc.
- Cleanup effects with return functions
- Use `React.StrictMode` in production builds

### Styling Conventions
- Tailwind utility classes for all styling
- CSS custom properties for colors: `var(--cad-bg)`, `var(--cad-text)`, etc.
- Dark mode support via `.dark` class on `<html>` element
- Font families: `font-display` (Space Grotesk), `font-sans` (Noto Sans), `font-mono`
- Material Symbols icons: `<span className="material-symbols-outlined">icon_name</span>`

### SVG & Canvas
- SVG-based rendering in `Canvas.tsx`
- Use `vectorEffect="non-scaling-stroke"` for stroke scaling
- Coordinate system: X increases right, Y increases down (screen coordinates)
- Default canvas size: 800x600
- Grid pattern using SVG `<pattern>` element

### Environment Variables
- API keys loaded from `.env.local` file
- Access via `process.env.GEMINI_API_KEY` (defined in vite.config.ts)
- Never commit `.env.local` files

### DXF File Handling
- Import: Parse DXF files into CADElement[] array
- Export: Convert CADElement[] to DXF string format
- Supported elements: LINE, CIRCLE, RECTANGLE (as LWPOLYLINE), TEXT, LWPOLYLINE, ARC

### AI Integration (Gemini)
- Model: `gemini-3-flash-preview`
- Service: `@google/genai` package
- Response format: JSON with structured schema
- AI-generated elements assigned `layer: 'AI_GENERATED'` and `color: '#137fec'`

### Keyboard Shortcuts
- Undo: Ctrl+Z / Cmd+Z
- Redo: Ctrl+Y / Cmd+Shift+Z
- Delete: Delete / Backspace
- Cancel: Escape
- Polyline finish: Enter

### API Endpoints (Future)
- No backend API currently configured
- AI calls made directly to Google Gemini from frontend
- Consider adding backend for: file storage, authentication, collaborative editing

### Performance Notes
- History limited to 50 states to prevent memory issues
- Use `useMemo` for expensive computations
- Batch state updates when possible
- Debounce/throttle expensive operations

### Adding New Features
1. Define types in `types.ts` if needed
2. Create component in `/components` following existing patterns
3. Add logic in appropriate service file or parent component
4. Update toolbar/menu if UI controls needed
5. Add keyboard shortcuts in `App.tsx` useEffect
6. Test dev mode: `npm run dev`
7. Verify TypeScript: `npx tsc --noEmit`

### Before Submitting Changes
1. Run `npm run build` to verify production build works
2. Run `npx tsc --noEmit` to check for type errors
3. Test new features in development mode
4. Verify dark/light mode works
5. Check responsive design if UI changes made
