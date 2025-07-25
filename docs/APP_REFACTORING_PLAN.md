# App.tsx Refactoring Plan

The current `App.tsx` file has grown to over 180 lines and contains multiple responsibilities. This document outlines a plan to refactor it into smaller, more maintainable components following the Single Responsibility Principle.

## Current Issues

1. **Monolithic Component**: All functionality is contained in one large component
2. **Mixed Concerns**: UI rendering, state management, and business logic are all in one place
3. **Difficult Testing**: Hard to test individual features in isolation
4. **Poor Reusability**: Components are tightly coupled and not reusable
5. **Maintainability**: Changes to one feature can affect unrelated functionality

## Proposed Component Structure

### 1. Header Component (`components/Header.tsx`)
**Responsibility**: Top navigation bar with log file selection

```tsx
interface HeaderProps {
  logFiles: LogFile[]
  selectedLog: string
  onLogChange: (logPath: string) => void
}
```

**Contains**:
- Application title
- Log file dropdown selector
- Future: User menu, settings button

### 2. LogViewer Component (`components/LogViewer.tsx`)
**Responsibility**: Display logs with scrolling and auto-scroll functionality

```tsx
interface LogViewerProps {
  logs: string[]
  autoScroll: boolean
  onAutoScrollChange: (enabled: boolean) => void
  onScroll: () => void
  loadingHistory: boolean
}
```

**Contains**:
- Log display container
- Auto-scroll toggle button
- Scroll event handling
- Loading indicator for history

### 3. Custom Hooks for Business Logic

#### `hooks/useLogStream.ts`
**Responsibility**: Manage log streaming and EventSource connection

```tsx
interface UseLogStreamReturn {
  logs: string[]
  eventSource: EventSource | null
  connectToLog: (logPath: string) => void
  disconnect: () => void
}
```

#### `hooks/useLogHistory.ts`
**Responsibility**: Handle infinite scroll and history loading

```tsx
interface UseLogHistoryReturn {
  historyOffset: number | undefined
  hasMoreHistory: boolean
  loadingHistory: boolean
  loadMoreHistory: () => Promise<void>
  resetHistory: () => void
}
```

#### `hooks/useLogFiles.ts`
**Responsibility**: Fetch and manage available log files

```tsx
interface UseLogFilesReturn {
  logFiles: LogFile[]
  selectedLog: string
  setSelectedLog: (path: string) => void
  loading: boolean
  error: string | null
}
```

#### `hooks/useAutoScroll.ts`
**Responsibility**: Manage auto-scroll behavior and scroll position

```tsx
interface UseAutoScrollReturn {
  autoScroll: boolean
  setAutoScroll: (enabled: boolean) => void
  scrollToBottom: () => void
  handleScroll: () => void
  containerRef: RefObject<HTMLDivElement>
}
```

### 4. Utility Components

#### `components/LoadingIndicator.tsx`
**Responsibility**: Reusable loading spinner/text

#### `components/AutoScrollButton.tsx`
**Responsibility**: Floating auto-scroll toggle button

#### `components/LogLine.tsx`
**Responsibility**: Individual log line rendering (future: syntax highlighting)

## Refactoring Steps

### Phase 1: Extract Header Component
1. Create `Header.tsx` component
2. Move log file selection logic
3. Update `App.tsx` to use new Header component
4. Test functionality

### Phase 2: Extract LogViewer Component
1. Create `LogViewer.tsx` component
2. Move log display and scroll handling
3. Extract auto-scroll button into separate component
4. Update `App.tsx` to use new LogViewer component

### Phase 3: Create Custom Hooks
1. Extract log files management into `useLogFiles` hook
2. Extract log streaming logic into `useLogStream` hook
3. Extract history loading into `useLogHistory` hook
4. Extract auto-scroll logic into `useAutoScroll` hook

### Phase 4: Utility Components
1. Create reusable `LoadingIndicator` component
2. Extract `AutoScrollButton` component
3. Prepare `LogLine` component for future enhancements

## Final File Structure

```
src/
├── components/
│   ├── Header.tsx
│   ├── LogViewer.tsx
│   ├── AutoScrollButton.tsx
│   ├── LoadingIndicator.tsx
│   └── LogLine.tsx
├── hooks/
│   ├── useLogFiles.ts
│   ├── useLogStream.ts
│   ├── useLogHistory.ts
│   └── useAutoScroll.ts
├── types/
│   └── logTypes.ts
└── App.tsx (much smaller, orchestrating components)
```

## Benefits After Refactoring

1. **Testability**: Each component and hook can be tested in isolation
2. **Reusability**: Components can be reused in different contexts
3. **Maintainability**: Changes to one feature won't affect others
4. **Readability**: Smaller, focused components are easier to understand
5. **Development Speed**: Team members can work on different components simultaneously
6. **Type Safety**: Better TypeScript interfaces for component props

## Future Enhancements Enabled

1. **Header**: Easy to add user authentication, settings menu
2. **LogViewer**: Simple to add syntax highlighting, filtering
3. **Hooks**: Can be enhanced with caching, error handling, retries
4. **Components**: Can be styled independently, themed easily

## Migration Strategy

1. Implement refactoring incrementally (one phase at a time)
2. Keep existing functionality working at each step
3. Add tests for each new component/hook
4. Update documentation as components are created
5. Consider using Storybook for component documentation

This refactoring will make the codebase more maintainable and set up a solid foundation for future features outlined in the main development plan.
