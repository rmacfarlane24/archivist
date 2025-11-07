# Archivist App Architecture Overview

## Core Purpose
Archivist is a file metadata management system that scans and indexes files across multiple drives, providing fast search and browsing capabilities without storing actual file content.

## Storage Architecture

### Per-Drive Database System
- **Central Catalog**: `catalog.db` contains drive metadata and cross-drive search index
- **Individual Drive Databases**: Each drive gets its own `drive_XXX.db` file for scalability
- **User Isolation**: Each authenticated user gets separate storage directory (`~/Library/Application Support/archivist/storage/users/{user-id}/`)
- **No Anonymous Storage**: Storage only initializes for authenticated users

### Database Structure

#### Catalog Database (`catalog.db`)
- **`drives` table**: Drive metadata and registry
  - `id` (TEXT PRIMARY KEY): Unique drive identifier
  - `name` (TEXT): Drive name (from path basename)
  - `path` (TEXT): Drive mount point/path
  - `total_capacity` (INTEGER): Total drive capacity in bytes
  - `used_space` (INTEGER): Used space in bytes
  - `free_space` (INTEGER): Free space in bytes
  - `format_type` (TEXT): File system type (e.g., "APFS", "NTFS")
  - `added_date` (TEXT): When drive was added
  - `last_updated` (TEXT): Last update timestamp
  - `deleted` (INTEGER): Deletion flag (0/1)
  - `deleted_at` (TEXT): Deletion timestamp

- **`files_fts` table**: FTS5 virtual table for cross-drive search
  - `name`: File/folder name (indexed)
  - `drive_id`: Drive identifier (UNINDEXED)
  - `path`: Full file path (indexed)
  - `is_directory`: Directory flag (indexed)

#### Drive Databases (`drive_XXX.db`)
- **`files` table**: Complete file metadata for the drive
  - `id` (TEXT PRIMARY KEY): Unique file identifier
  - `drive_id` (TEXT): Drive identifier
  - `name` (TEXT): File/folder name
  - `path` (TEXT): Full file path
  - `parent_path` (TEXT): Parent directory path
  - `is_directory` (INTEGER): Directory flag (0/1)
  - `size` (INTEGER): File size in bytes
  - `created` (TEXT): File creation timestamp
  - `modified` (TEXT): File modification timestamp
  - `depth` (INTEGER): Directory depth
  - `inode` (INTEGER): File system inode number
  - `hard_link_count` (INTEGER): Number of hard links
  - `is_hard_link` (INTEGER): Hard link flag (0/1)
  - `hard_link_group` (TEXT): Hard link group identifier
  - `folder_path` (TEXT): Folder path for organization
  - `file_type` (TEXT): File type/extension
  - `created_at` (TEXT): Record creation timestamp
  - `updated_at` (TEXT): Record update timestamp
  - `deleted` (INTEGER): Deletion flag (0/1)
  - `deleted_at` (TEXT): Deletion timestamp
  - `deletion_reason` (TEXT): Reason for deletion

### Drive Information Gathering
- **Platform-Specific Methods**: Uses `fs.stat()` and system commands
- **macOS**: `df -k` for capacity info, `diskutil info` for format type
- **Windows**: `dir /s` for file counting, `fs.stat()` for basic info
- **Linux**: `find` commands for file counting and capacity
- **File Counting**: Platform-specific commands to get actual file counts
- **Capacity Detection**: System-level disk information via `df` and `diskutil`
- **Format Detection**: File system type detection from system tools

### Storage Flow
1. User authenticates via Supabase
2. Storage switches to user-specific directory
3. Catalog database loads/creates for user
4. Existing drive databases load on-demand
5. User sees only their own drives and files

## Authentication System (Supabase)

### Authentication Flow
- **PKCE Flow**: Secure authentication with Proof Key for Code Exchange
- **Session Persistence**: Sessions stored using custom Electron storage adapter
- **Auto-Refresh**: Tokens automatically refreshed before expiration
- **No URL Detection**: Disabled for Electron app security

### User Management
- **Email/Password**: Standard Supabase authentication
- **Session Validation**: Sessions validated on app startup
- **Multi-User Support**: Multiple users can share same device with complete data isolation
- **Secure Logout**: All user data cleared on sign out

### Integration Points
- **Storage Switching**: Authentication triggers storage user switching
- **Subscription Status**: User subscription data stored in Supabase profiles table
- **Payment Integration**: Stripe webhooks update user subscription status

## Recovery System

### Backup Strategy
- **Per-Drive Backups Only**: Only individual drive databases are backed up before deletion
- **No Catalog Backups**: Catalog database is not backed up (contains only metadata and search index)
- **Event-Driven Backups**: Backups created automatically before drive deletion
- **User-Specific Backups**: Each user's backups stored in their isolated directory

### Recovery Options
1. **Restore Deleted Drive**: Restore from per-drive backup file
2. **Rebuild Search Index**: When restoring a drive, its files are re-added to catalog's FTS table
3. **Re-add Drive**: Simple rescan option for users who prefer to rescan

### Backup Structure
```
/storage/users/{userId}/backups/
├── backup_drive_abc123.db  (backup of deleted drive)
├── backup_drive_xyz789.db  (backup of deleted drive)
└── backup_drive_abc123_fts.db  (FTS index backup for drive)
```

## Key Design Principles

### Security
- **Complete Data Isolation**: Users cannot access each other's data
- **No Anonymous Access**: Storage requires valid authentication
- **Secure Session Management**: Industry-standard Supabase authentication
- **Clean Logout**: All data cleared on sign out

### Performance
- **Per-Drive Scaling**: Each drive has its own database for horizontal scaling
- **On-Demand Loading**: Drive databases loaded only when needed
- **Centralized Search**: FTS5 index enables fast cross-drive search
- **Progressive Storage**: Large file trees stored in batches

### Reliability
- **Hard Deletion**: Files and drives are physically removed (not soft deleted)
- **Backup Before Deletion**: Drive databases backed up before deletion
- **Error Recovery**: Comprehensive error handling and recovery mechanisms
- **State Management**: Clear state transitions and validation

## Data Flow Summary

1. **App Startup**: Check for valid Supabase session
2. **Authentication**: Validate session or show login
3. **Storage Initialization**: Switch to user-specific storage directory
4. **Data Loading**: Load user's drives and subscription status
5. **Drive Operations**: Scan drives, store metadata in per-drive databases
6. **Search Operations**: Query centralized FTS5 index across all drives
7. **Recovery Operations**: Restore from backups when needed

## Search System Architecture

### FTS5 Full-Text Search
- **Centralized Index**: Single FTS5 virtual table in catalog database for cross-drive search
- **Manual Management**: No automatic triggers - search index maintained manually for reliability
- **Query Processing**: Supports both MATCH queries (fast) and LIKE fallback (comprehensive)
- **Performance Optimization**: BM25 ranking, query escaping, timeout protection

### Search Features
- **Cross-Drive Search**: Search across all user's drives simultaneously
- **Paged Results**: Support for pagination with configurable limits
- **System File Filtering**: Option to hide system files from results
- **Drive Filtering**: Backend support for filtering by specific drives (not implemented in UI)
- **Query Escaping**: Automatic handling of special characters in search terms

### Search Flow
1. **Query Input**: User enters search term
2. **Query Processing**: Escape special characters, build FTS expression
3. **MATCH Query**: For queries ≥2 characters, use FTS5 MATCH with BM25 ranking
4. **LIKE Fallback**: For single-character queries, use LIKE search (slower but comprehensive)
5. **Result Processing**: Map results to SearchResult objects
6. **Ranking**: Sort by BM25 relevance score (MATCH) or alphabetical (LIKE)

### Search Performance
- **Small Drives (<1M files)**: Sub-second response
- **Medium Drives (1-10M files)**: 1-3 second response  
- **Large Drives (10M+ files)**: 3-10 second response
- **Timeout Protection**: 5-second timeout prevents hanging queries

## Supabase Integration Details

### Authentication Setup
- **PKCE Flow**: Proof Key for Code Exchange for enhanced security
- **Session Persistence**: Custom Electron storage adapter for token storage
- **Auto-Refresh**: Automatic token refresh before expiration
- **No URL Detection**: Disabled for Electron app security
- **Multi-User Support**: Complete data isolation between users

### Row-Level Security (RLS)
- **Complete Data Isolation**: Users can only access their own data
- **Automatic Filtering**: All queries automatically filtered by user ID
- **Policy-Based Security**: Database-level security policies prevent data leaks
- **Defense in Depth**: Security at both application and database levels

### RLS Policies Implemented
- **Profiles Table**: Users can only view/update their own profile
- **Drives Table**: Users can only access their own drives
- **Files Table**: Users can only access their own files  
- **Metadata Table**: Users can only access their own metadata

### Database Schema
- **Profiles**: Extends Supabase auth.users with additional user data
- **Drives**: Drive metadata with user association
- **Files**: File metadata with drive and user associations
- **Metadata**: Custom metadata storage per user/folder
- **Indexes**: Optimized indexes for performance

### Admin Operations
- **Service Role Key**: Admin-level access for system operations
- **User Management**: Create, update, delete users
- **Data Management**: Access any user's data for admin purposes
- **System Operations**: Statistics, cleanup, backup operations
- **Security**: Service role key kept secure, server-side only

### Environment Configuration
- **Client Variables**: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`
- **Admin Variables**: `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- **Security**: Never expose service role key to client-side code

## Payment System

### Current Implementation (Supabase Edge Functions)
- **Architecture**: Server-side payment processing via Supabase Edge Functions
- **Payment Provider**: Stripe integration with webhook-based confirmation
- **User Experience**: Browser-based checkout with deep link callbacks

### Payment Flow
1. **Plan Selection**: User selects plan in app (Monthly £5, Annual £50, Lifetime £100)
2. **Checkout Creation**: App calls Supabase Edge Function to create Stripe session
3. **Browser Redirect**: User redirected to Stripe checkout page
4. **Payment Processing**: Stripe handles payment and sends webhook to Supabase
5. **Database Update**: Webhook function updates user profile with subscription data
6. **Real-time Sync**: App receives real-time updates via Supabase subscriptions

### Subscription Management
- **Plans**: Monthly (£5), Annual (£50), Lifetime (£100) - all in GBP
- **Access Control**: `access_granted` flag controls app functionality
- **Real-time Updates**: Subscription changes reflected immediately via Supabase real-time
- **No Grace Period**: Immediate lockout on payment failure (user preference)

### Database Schema (Profiles Table)
- **`plan`**: Subscription tier (monthly/annual/lifetime)
- **`access_granted`**: Boolean flag for app access
- **`stripe_customer_id`**: Stripe customer identifier
- **`stripe_subscription_id`**: Stripe subscription identifier
- **`subscription_ends_at`**: Subscription expiration date
- **`last_payment_date`**: Most recent payment timestamp
- **`payment_failed`**: Payment failure flag
- **`trial_ends_at`**: Trial period expiration

### Edge Functions
- **`checkout`**: Creates Stripe sessions and returns checkout URLs
- **`webhook`**: Processes Stripe webhooks and updates database
- **`create-portal-session`**: Creates Stripe Customer Portal sessions for billing management

### Security Features
- **Webhook Verification**: Stripe signature validation for webhook authenticity
- **RLS Policies**: Row-level security ensures users can only access their own data
- **Server-side Processing**: All payment logic handled server-side for security
- **Environment Variables**: Stripe keys stored securely in Supabase environment

## IPC Communication (Electron)

### Main Process Handlers
- **Storage Operations**: `add-drive`, `remove-drive`, `get-drives`, `switch-storage-user`
- **File Operations**: `scan-drive`, `search-files`, `get-file-details`, `list-children`
- **Search Operations**: `search-files-paged`, `build-search-index`, `populate-search-index`
- **Backup Operations**: `create-backup`, `restore-drive`, `list-backups`, `delete-backup`
- **System Operations**: `get-storage-status`, `get-database-size`, `cleanup-soft-deleted-records`

### Preload Script Security
- **Exposed APIs**: Only specific functions exposed to renderer process
- **Input Validation**: All IPC parameters validated before processing
- **Error Handling**: Comprehensive error handling and logging
- **Type Safety**: TypeScript interfaces for all IPC communications

### Data Flow
1. **Renderer Request**: Custom HTML makes IPC call via preload script
2. **Main Process**: Handler validates request and processes operation
3. **Storage Layer**: Operation executed via StorageManager interface
4. **Response**: Results returned to renderer process
5. **UI Update**: Custom HTML updates based on response

### IPC Message Types
- **Drive Operations**: Add, remove, list, update drives
- **File Operations**: Scan, search, browse, get details
- **Search Operations**: Full-text search with pagination
- **Backup Operations**: Create, restore, manage backups
- **System Operations**: Status, cleanup, maintenance

## Build & Deployment

### Development Setup
- **Electron Main Process**: TypeScript compilation to JavaScript
- **Custom HTML**: Static HTML files with vanilla JavaScript
- **Supabase Edge Functions**: Deno-based serverless functions
- **Environment Variables**: Development vs production configuration

### Build Process
- **Electron Packaging**: Main process compiled and packaged
- **Asset Bundling**: HTML, CSS, JS files bundled for distribution
- **Platform Builds**: macOS, Windows, Linux specific builds
- **Code Signing**: Platform-specific code signing requirements

### Environment Configuration
- **Development**: Local Supabase instance, test Stripe keys
- **Production**: Production Supabase, live Stripe keys
- **Environment Variables**: Secure storage of API keys and secrets
- **Configuration Files**: Platform-specific configuration management

### Deployment Strategy
- **Desktop Distribution**: Platform-specific installers/packages
- **Auto-Updates**: Electron auto-updater integration
- **Version Management**: Semantic versioning and release management
- **Rollback Capability**: Ability to rollback problematic releases

### Platform Considerations
- **macOS**: Code signing, notarization, Gatekeeper compatibility
- **Windows**: Code signing, Windows Defender compatibility
- **Linux**: Package formats (AppImage, DEB, RPM), distribution compatibility

## Technology Stack
- **Database**: SQLite with FTS5 for search, Supabase PostgreSQL for user data
- **Authentication**: Supabase Auth with PKCE flow and RLS
- **Storage**: Per-drive SQLite databases with user isolation
- **Search**: FTS5 full-text search with manual index management
- **Backup**: File-based backup system with user-specific storage
- **Multi-User**: Complete data isolation per user with RLS policies

