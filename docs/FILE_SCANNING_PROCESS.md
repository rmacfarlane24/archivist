# File Scanning Process

## Overview
The file scanning process is the core functionality that traverses drive file systems, extracts metadata, and stores it in per-drive SQLite databases for fast search and browsing.

## Scanning Architecture

### Core Components
- **Main Process Scanner**: Handles file system traversal and metadata extraction
- **Progressive Storage**: Large file trees stored in batches to prevent memory issues
- **Progress Reporting**: Real-time progress updates via IPC to UI
- **Error Recovery**: Graceful handling of permission errors and file system issues

### Scanning Flow
1. **Drive Selection**: User selects drive path to scan
2. **Permission Check**: Verify read access to drive path
3. **Drive Info Gathering**: Extract capacity, format, and basic metadata
4. **File System Traversal**: Recursively scan directories and files
5. **Metadata Extraction**: Extract file stats, timestamps, and system info
6. **Progressive Storage**: Store file metadata in batches
7. **Search Index Update**: Add files to FTS5 search index
8. **Completion**: Update drive record with scan results

## File System Traversal

### Algorithm
- **Recursive Directory Walking**: Uses `fs.readdir()` and `fs.stat()` for traversal
- **Depth-First Search**: Processes directories before their contents
- **Symlink Handling**: Follows symlinks but prevents infinite loops
- **Permission Handling**: Skips inaccessible files/directories gracefully

### Performance Optimizations
- **Batch Processing**: Files stored in batches of 1000-3000 to prevent memory issues
- **Streaming**: Large directories processed without loading all files into memory
- **Progress Throttling**: Progress updates limited to prevent UI flooding
- **Early Termination**: Scan can be cancelled by user

### File Metadata Extraction
- **Basic Stats**: Name, path, size, timestamps (created/modified)
- **File System Info**: Inode, hard link count, file type
- **Directory Structure**: Parent path, depth, folder organization
- **System Files**: Detection and optional filtering of system files

## Memory Management

### Large File Tree Handling
- **Progressive Storage**: Files stored in batches rather than all at once
- **Memory Monitoring**: Tracks memory usage during large scans
- **Garbage Collection**: Explicit cleanup of processed file batches
- **Streaming Processing**: Never loads entire file tree into memory

### Database Operations
- **Batch Inserts**: Multiple files inserted in single transaction
- **Connection Management**: Database connections reused efficiently
- **Transaction Optimization**: Large transactions for better performance
- **Index Maintenance**: Search index updated incrementally

## Progress Reporting

### Real-time Updates
- **File Count**: Running count of files processed
- **Directory Count**: Number of directories scanned
- **Current Path**: Currently processing directory
- **Processing Speed**: Files per second calculation
- **Estimated Time**: Time remaining based on current speed

### Progress Data Structure
```typescript
interface ScanProgress {
  driveId: string;
  currentPath: string;
  filesProcessed: number;
  directoriesProcessed: number;
  totalFiles: number;
  totalDirectories: number;
  processingSpeed: number; // files/second
  estimatedTimeRemaining: number; // seconds
  isComplete: boolean;
  error?: string;
}
```

## Error Handling

### Common Error Scenarios
- **Permission Denied**: Skip inaccessible files, continue scanning
- **Drive Disconnected**: Detect and handle drive removal during scan
- **Corrupted Files**: Skip files that can't be read, log errors
- **Memory Pressure**: Reduce batch sizes if memory usage is high
- **Database Errors**: Retry failed database operations

### Recovery Strategies
- **Graceful Degradation**: Continue scanning despite individual file errors
- **Error Logging**: Comprehensive logging of all errors for debugging
- **User Feedback**: Clear error messages for user-actionable issues
- **Partial Results**: Return successfully scanned files even if scan fails

## Performance Characteristics

### Expected Performance
- **Small Drives (<100K files)**: 1-5 seconds
- **Medium Drives (100K-1M files)**: 30 seconds - 2 minutes
- **Large Drives (1M-10M files)**: 2-10 minutes
- **Very Large Drives (10M+ files)**: 10+ minutes

### Performance Factors
- **Drive Speed**: SSD vs HDD performance differences
- **File Count**: More files = longer scan time
- **Directory Depth**: Deep directory structures slower
- **File Size Distribution**: Many small files slower than few large files
- **System Load**: CPU and memory usage affects performance

## Platform-Specific Considerations

### macOS
- **APFS Features**: Handles APFS snapshots and clones
- **Extended Attributes**: Extracts extended file attributes
- **Spotlight Integration**: Respects Spotlight exclusions
- **Permission Model**: Handles macOS permission system

### Windows
- **NTFS Features**: Handles NTFS alternate data streams
- **Long Paths**: Supports Windows long path names
- **Drive Letters**: Handles Windows drive letter system
- **Permission Model**: Handles Windows ACL system

### Linux
- **Ext4 Features**: Handles Linux file system features
- **Symlink Handling**: Proper symlink resolution
- **Permission Model**: Handles Linux permission system
- **Mount Points**: Handles Linux mount point structure

## Database Integration

### Storage Strategy
- **Per-Drive Databases**: Each drive gets its own database file
- **Batch Inserts**: Files inserted in batches for performance
- **Index Management**: Search index updated incrementally
- **Transaction Safety**: All operations wrapped in transactions

### Search Index Updates
- **Incremental Updates**: Search index updated as files are processed
- **FTS5 Integration**: Files added to FTS5 virtual table
- **Manual Management**: No automatic triggers, manual index maintenance
- **Performance**: Index updates don't block file processing

## User Experience

### Scanning UI
- **Progress Bar**: Visual progress indication
- **File Count**: Real-time file count updates
- **Current Directory**: Shows currently processing directory
- **Speed Indicator**: Files per second processing speed
- **Cancel Option**: User can cancel long-running scans

### Background Processing
- **Non-blocking**: Scanning doesn't freeze UI
- **Cancellation**: User can cancel scans at any time
- **Resume Capability**: Scans can be resumed if interrupted
- **Status Persistence**: Scan status preserved across app restarts

## Technical Implementation

### Core Scanning Function
```typescript
async function scanDriveTree(
  drivePath: string, 
  driveId: string, 
  progressCallback: (progress: ScanProgress) => void
): Promise<FileInfo[]>
```

### Batch Processing
- **Batch Size**: 1000-3000 files per batch (configurable)
- **Memory Monitoring**: Batch size adjusted based on memory usage
- **Progress Reporting**: Progress reported after each batch
- **Error Isolation**: Errors in one batch don't affect others

### File System APIs Used
- **`fs.readdir()`**: Directory listing
- **`fs.stat()`**: File metadata extraction
- **`fs.lstat()`**: Symlink handling
- **`path.join()`**: Path manipulation
- **`path.resolve()`**: Absolute path resolution

This scanning process ensures reliable, performant file system traversal while providing real-time feedback and handling errors gracefully.
