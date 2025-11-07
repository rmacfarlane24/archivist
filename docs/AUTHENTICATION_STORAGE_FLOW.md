# Authentication & Storage Flow Architecture

## Overview

This document outlines the proper authentication and storage flow for the Archivist app, ensuring reliable user session management and data isolation.

## Core Principles

1. **No Anonymous Storage**: Storage should only be initialized for authenticated users
2. **Sequential Initialization**: Each step must complete before the next begins
3. **Clear State Management**: All components must know the current state
4. **Error Recovery**: Graceful handling of authentication and storage failures

## App Startup Flow

### Phase 1: App Launch
- App starts without any storage initialization
- Check for existing authentication session
- If no valid session exists, show login screen
- If valid session exists, proceed to Phase 2

### Phase 2: Authentication Validation
- Validate the stored session with Supabase
- If session is invalid/expired, clear it and show login
- If session is valid, extract user information
- Proceed to Phase 3

### Phase 3: Storage Initialization
- Initialize user-specific storage directory
- Create/load user's catalog database
- Load user's drive databases
- Mark storage as ready
- Proceed to Phase 4

### Phase 4: Data Loading
- Load user's drives from storage
- Load user's subscription status
- Load any cached metadata
- Mark data as ready
- Show main application UI

## Authentication State Management

### State Transitions
- **UNINITIALIZED**: App just started, no auth check performed
- **CHECKING**: Validating stored session
- **ANONYMOUS**: No valid session, user must log in
- **AUTHENTICATED**: Valid session, user is logged in
- **STORAGE_READY**: User storage initialized and ready
- **DATA_LOADED**: All user data loaded and ready

### State Guards
- UI components should check state before rendering
- Storage operations only allowed in STORAGE_READY or DATA_LOADED states
- Drive operations only allowed in DATA_LOADED state

## Storage Architecture

### User-Specific Storage
- Each authenticated user gets isolated storage directory
- No shared or anonymous storage directories
- Storage path: `~/Library/Application Support/archivist/storage/users/{user-id}/`
- Complete data isolation between users

### Storage Components
- **Catalog Database**: User's drive registry and metadata
- **Drive Databases**: Individual databases for each scanned drive
- **Configuration**: User-specific settings and preferences

## Error Handling

### Authentication Errors
- Invalid/expired sessions → Clear session, show login
- Network errors → Retry with exponential backoff
- Server errors → Show error message with retry option

### Storage Errors
- Storage initialization failure → Show error, allow retry
- Database corruption → Attempt recovery, fallback to fresh start
- Permission errors → Show clear error message

### Recovery Strategies
- Session validation failure → Clear all local data, restart auth flow
- Storage corruption → Backup what's possible, reinitialize
- Network issues → Cache operations, retry when online

## Implementation Guidelines

### State Management
- Use a centralized state manager for all auth/storage state
- Implement proper state transitions with validation
- Provide clear state indicators to all components

### Event Handling
- Auth state changes trigger storage operations
- Storage readiness triggers data loading
- Data loading completion triggers UI updates
- All with proper error boundaries

### Performance Considerations
- Lazy load non-critical data after initial load
- Cache frequently accessed data
- Implement proper cleanup on logout
- Minimize storage operations during normal usage

## Security Considerations

### Data Isolation
- Complete separation between user data
- No cross-user data access possible
- Secure session management
- Proper cleanup on logout

### Session Management
- Validate sessions on app startup
- Handle session expiration gracefully
- Secure storage of session tokens
- Clear all data on logout

## Testing Strategy

### Test Scenarios
- Fresh app install with no existing session
- App restart with valid session
- App restart with expired session
- Network interruption during auth
- Storage corruption scenarios
- Multi-user scenarios on same device

### Validation Points
- State transitions occur in correct order
- Error states are handled properly
- Data isolation is maintained
- Performance meets requirements
- Security requirements are met

## Current Issues to Address

### Race Conditions
- Multiple auth state changes triggering storage switches
- UI rendering before storage is ready
- Drive loading before storage initialization completes
- React StrictMode double-invoking functions in development
- useCallback dependencies causing function re-execution

### State Synchronization
- Auth state and storage state getting out of sync
- UI not reflecting current state accurately
- Missing error states in UI components
- Multiple state managers (AuthStateManager, StorageManager, App.tsx) competing for control

### Error Recovery
- Incomplete error handling in auth flow
- No fallback mechanisms for storage failures
- Poor user feedback during errors
- No retry mechanisms for transient failures

### Architecture Problems
- **Multiple Flow Managers**: AuthStateManager (React) + StorageManager (Electron) + App.tsx all trying to manage flow
- **Complex Dependencies**: useCallback dependencies causing cascading re-executions
- **IPC Complexity**: Multiple async operations across process boundaries
- **State Fragmentation**: Auth state, storage state, and UI state managed separately

## Robust Solution: Single Flow Manager

### Proposed Architecture
```
Electron Main Process (Single Source of Truth):
├── FlowManager
│   ├── State Management (UNINITIALIZED → CHECKING → AUTHENTICATED → STORAGE_READY → DATA_LOADED)
│   ├── Flow Orchestration (auth → storage → data loading)
│   ├── Error Handling & Recovery
│   └── IPC Communication (state updates to React)
├── StorageManager (user-specific storage only)
├── AuthManager (Supabase integration)
└── IPC Handlers (React communication)

React Renderer Process (Pure UI Layer):
├── AuthWrapper (state display only)
├── App.tsx (drive display only)
└── Components (pure UI, no flow logic)
```

### FlowManager Responsibilities
- **Centralized State**: Single source of truth for all flow state
- **Sequential Execution**: Each phase completes before next begins
- **Error Boundaries**: Comprehensive error handling and recovery
- **IPC Notifications**: Real-time state updates to React UI
- **Retry Logic**: Exponential backoff for transient failures
- **Cleanup**: Proper resource management and cleanup

### React Responsibilities
- **State Display**: Show appropriate UI based on current state
- **User Actions**: Handle sign in/out, retry operations
- **Drive Display**: Show user's drives when DATA_LOADED state
- **Error UI**: Display user-friendly error messages and recovery options

### Benefits of Single Flow Manager
- **Deterministic**: No race conditions or state conflicts
- **Testable**: Single point of control for testing
- **Debuggable**: Clear flow logs and error tracking
- **Maintainable**: One place to modify flow logic
- **Reliable**: Proper error handling and recovery
- **Performant**: No unnecessary re-renders or state updates

## Build Plan

### Phase 1: Single Flow Manager Foundation
**Goal**: Create centralized flow management in Electron main process

#### 1.1 Create FlowManager
- Create `src/flow-manager.ts` in Electron main process
- Implement state machine (UNINITIALIZED → CHECKING → AUTHENTICATED → STORAGE_READY → DATA_LOADED)
- Add sequential flow orchestration (auth → storage → data loading)
- Implement comprehensive error handling and recovery
- Add IPC communication for state updates to React

#### 1.2 Create AuthManager
- Create `src/auth-manager.ts` for Supabase integration
- Implement session validation and management
- Add secure session storage and cleanup
- Handle auth errors with retry logic

#### 1.3 Update IPC Handlers
- Replace existing auth/storage IPC handlers with FlowManager integration
- Add state change notifications to React
- Implement error reporting and recovery commands
- Add flow control commands (retry, reset, etc.)

### Phase 2: React UI Simplification
**Goal**: Simplify React to be pure UI layer

#### 2.1 Simplify AuthWrapper
- Remove AuthStateManager dependency
- Add IPC listeners for state updates from FlowManager
- Display appropriate UI based on current state
- Handle user actions (sign in/out, retry)

#### 2.2 Simplify App.tsx
- Remove drive loading logic
- Add IPC listeners for drive data from FlowManager
- Display drives when DATA_LOADED state
- Handle drive-specific user actions

#### 2.3 Create State Types
- Define shared state types between Electron and React
- Create IPC message types for state updates
- Add TypeScript types for all flow operations

### Phase 3: Storage Integration
**Goal**: Integrate StorageManager with FlowManager

#### 3.1 Update StorageManager
- Integrate with FlowManager for state coordination
- Remove standalone storage switching logic
- Add proper error handling and recovery
- Implement user-specific storage only

#### 3.2 Update PerDriveStorage
- Ensure user-specific directory creation
- Add proper cleanup on user switch
- Implement error recovery for storage corruption
- Add performance monitoring

#### 3.3 FlowManager Integration
- Integrate storage operations into FlowManager flow
- Add storage error handling and recovery
- Implement proper cleanup on sign out
- Add storage health monitoring

### Phase 3: UI Integration
**Goal**: Update UI to use new state system

#### 3.1 Update App Component
- Modify `app/src/App.tsx` to wait for proper initialization
- Add loading states for each phase
- Implement error boundaries for auth/storage failures
- Add retry mechanisms for failed operations

#### 3.2 Update Drive Components
- Modify drive loading to wait for DATA_LOADED state
- Add proper error handling for drive operations
- Implement drive refresh after storage switches
- Add loading indicators during state transitions

#### 3.3 Update Login Flow
- Ensure login triggers proper state transitions
- Add session validation after login
- Implement proper error handling for login failures
- Add loading states during authentication

### Phase 4: Error Handling & Recovery
**Goal**: Implement comprehensive error handling

#### 4.1 Authentication Error Recovery
- Implement session validation with retry logic
- Add network error handling with exponential backoff
- Create fallback mechanisms for auth failures
- Add user-friendly error messages

#### 4.2 Storage Error Recovery
- Implement storage corruption detection and recovery
- Add backup mechanisms for critical data
- Create storage initialization retry logic
- Add permission error handling

#### 4.3 UI Error States
- Create error boundary components
- Add retry buttons for failed operations
- Implement error logging and reporting
- Add user guidance for error recovery

### Phase 5: Testing & Validation
**Goal**: Comprehensive testing and validation

#### 5.1 Unit Tests
- Test AuthStateManager state transitions
- Test storage switching logic
- Test error handling and recovery
- Test session validation

#### 5.2 Integration Tests
- Test complete auth flow from startup to data loading
- Test multi-user scenarios
- Test network interruption scenarios
- Test storage corruption scenarios

#### 5.3 Manual Testing
- Test fresh app install with no session
- Test app restart with valid session
- Test app restart with expired session
- Test error recovery scenarios

### Phase 6: Performance & Security
**Goal**: Optimize performance and security

#### 6.1 Performance Optimization
- Implement lazy loading for non-critical data
- Add caching for frequently accessed data
- Optimize storage operations
- Add performance monitoring

#### 6.2 Security Hardening
- Implement secure session storage
- Add session expiration handling
- Implement proper data cleanup on logout
- Add security validation

**Note: Current system already provides good security baseline:**
- ✅ User isolation with separate storage directories
- ✅ Supabase authentication (industry-standard)
- ✅ No anonymous storage access
- ✅ Clean logout with state reset

**Optional security enhancements (if needed):**
- Local session token encryption in storage
- Automatic session refresh before expiry
- Data integrity checks for storage files
- Audit logging for security events (login, logout, data access)
- File system permission validation
- Cross-user access prevention validation

#### 6.3 Documentation
- Update user documentation
- Create developer documentation
- Document error recovery procedures
- Create troubleshooting guide

## Success Criteria

### Functional Requirements
- [ ] App starts without anonymous storage initialization
- [ ] Authentication state is properly managed and synchronized
- [ ] Storage switches work reliably without race conditions
- [ ] Drives load correctly after authentication
- [ ] Error states are handled gracefully with recovery options

### Performance Requirements
- [ ] App startup time remains under 3 seconds
- [ ] Storage switching completes within 1 second
- [ ] Drive loading completes within 2 seconds
- [ ] Memory usage remains stable during state transitions

### Security Requirements
- [ ] Complete data isolation between users
- [ ] Secure session management
- [ ] Proper cleanup on logout
- [ ] No data leakage between sessions

### Quality Requirements
- [ ] All error scenarios handled gracefully
- [ ] User-friendly error messages
- [ ] Comprehensive logging for debugging
- [ ] No race conditions or state synchronization issues

## Risk Mitigation

### Technical Risks
- **Race conditions**: Implement proper debouncing and state guards
- **Storage corruption**: Add backup and recovery mechanisms
- **Network failures**: Implement retry logic with exponential backoff
- **Performance degradation**: Monitor and optimize critical paths

### Timeline Risks
- **Scope creep**: Stick to defined phases and success criteria
- **Testing delays**: Start testing early and iterate
- **Integration issues**: Test components together frequently
- **Performance issues**: Monitor performance throughout development

## Dependencies

### External Dependencies
- Supabase authentication system
- Electron IPC system
- SQLite database system
- File system permissions

### Internal Dependencies
- Existing auth system (to be replaced)
- Existing storage system (to be modified)
- UI components (to be updated)
- Error handling system (to be enhanced)

This build plan provides a structured approach to implementing the new authentication and storage flow architecture, with clear phases, success criteria, and risk mitigation strategies.

This architecture ensures reliable authentication, proper data isolation, and a smooth user experience while maintaining security and performance.
