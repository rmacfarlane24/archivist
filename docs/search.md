# Search System Documentation

## Overview

The Archivist app implements a sophisticated full-text search system using SQLite's FTS5 (Full-Text Search) capabilities with intelligent fallback to LIKE queries. The search allows users to find files and folders across all indexed drives using natural language queries.

## Architecture

The search system has two main implementations:

1. **Per-Drive Storage** (`src/per-drive-storage.ts`) - Production implementation with smart fallback
2. **SQLite Storage** (`src/sqlite-storage.ts`) - Simpler implementation without fallback

## FTS Table Structure

The search index is built using SQLite FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  name,           -- File/folder names
  drive_id,       -- Which drive the file is on
  path,           -- Full file path
  is_directory    -- Whether it's a directory (0/1)
);
```

## Search Process Flow

### 1. User Input
- User types in search input field (top-right corner)
- Placeholder: "Search files and folders..."
- Real-time search with debouncing (delayed execution)

### 2. Frontend Processing
```typescript
// Debounced search in App.tsx
useEffect(() => {
  if (!searchQuery.trim()) {
    setSearchResults([]);
    return;
  }
  
  const timeoutId = setTimeout(async () => {
    const results = await window.electronAPI.searchFilesPaged(
      searchQuery, searchOffset, 50, hideSystemFiles
    );
    // Process and display results...
  }, 300); // 300ms debounce
}, [searchQuery]);
```

### 3. IPC Communication
```typescript
// preload.ts exposes search API
searchFilesPaged: (query: string, offset: number, limit: number, hideSystemFiles?: boolean) => {
  return ipcRenderer.invoke('search-files-paged', query, offset, limit, hideSystemFiles);
}
```

### 4. Main Process Routing
The main process routes search requests to the appropriate storage implementation based on the current storage mode.

## Per-Drive Storage Implementation

### Query Transformation

The `tryMatch` function transforms user queries into FTS syntax:

```typescript
const tryMatch = (q: string) => {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.join('').length < 2) return null;
  
  // Transform tokens: "hello world" → '"hello"* AND "world"*'
  const escaped = tokens.map(t => '"' + t.replace(/"/g, '""') + '"*');
  const expr = escaped.join(' AND ');
  return expr;
};
```

**Examples:**
- `"doc"` → `"doc"*` (prefix search)
- `"hello world"` → `"hello"* AND "world"*` (both terms must match)
- `"a"` → `null` (falls back to LIKE)

### FTS MATCH vs LIKE Fallback

#### When FTS MATCH is Used:
- Query has ≥2 characters total
- Query can be successfully parsed into tokens
- No SQL errors occur during execution

#### When LIKE Fallback Occurs:

**A. Query Length Restrictions:**
```typescript
if (tokens.join('').length < 2) return null;
```
- Single character queries → LIKE
- Empty queries → LIKE

**B. SQL Errors:**
```typescript
try {
  const matchExpr = tryMatch(query);
  if (matchExpr) {
    // Attempt MATCH query...
  }
} catch (e) {
  // fall back to LIKE
}
```

**C. Special Character Blocking:**
```typescript
if (query === '.' || query === '*' || query === '?' || query === '%' || query === '_') {
  return { rows: [], total: 0, mode: 'BLOCKED' };
}
```

### LIKE Query Patterns

**Single Character:**
```sql
-- Query: "a"
WHERE files_fts.name LIKE 'a%'  -- Prefix search (starts with 'a')
```

**Multi-Character:**
```sql
-- Query: "doc"
WHERE files_fts.name LIKE '%doc%'  -- Contains search (anywhere in name)
```

**Suffix Search:**
```sql
-- Query: ".pdf"
WHERE files_fts.name LIKE '%.pdf'  -- Suffix search (ends with '.pdf')
```

## SQLite Storage Implementation

### Query Escaping

The `escapeFtsQuery` function handles special characters:

```typescript
function escapeFtsQuery(query: string): string {
  const hasSpecialChars = /["&|()*+\-<>=^~:\[\]{}]/.test(query);
  
  if (hasSpecialChars) {
    // Phrase search: "file name" → "file name"
    return `"${query.replace(/"/g, '""')}"`;
  } else {
    // Simple text search: "doc" → "doc"
    return query;
  }
}
```

### Key Differences

| Feature | Per-Drive Storage | SQLite Storage |
|---------|------------------|----------------|
| **Fallback Strategy** | Smart fallback to LIKE | No fallback (empty results) |
| **Query Transformation** | Token-based with wildcards | Simple escaping |
| **Single Character** | LIKE prefix search | FTS (may fail) |
| **Error Handling** | Graceful degradation | Timeout protection |
| **Suffix Search** | LIKE fallback works | FTS fails |

## Search Results Structure

Each search result includes:

```typescript
interface SearchResult {
  fileId: string;        // Unique file identifier
  driveId: string;       // Drive containing the file
  driveName: string;     // Human-readable drive name
  fileName: string;      // File/folder name
  fullPath: string;      // Complete file path
  isDirectory: boolean;  // Whether it's a directory
  size?: number;         // File size (when available)
  modified?: string;     // Last modified date (when available)
}
```

## Search Index Management

### Index Creation
The FTS index is created automatically when drives are scanned:

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  name,
  drive_id,
  path,
  is_directory
);
```

### Index Population
Files are indexed during drive scanning:

```typescript
// Insert into search index
const ftsInsertStmt = this.catalogDb?.prepare(`
  INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
`);

for (const file of files) {
  insertStmt.run(file.name, driveId, file.path, file.isDirectory ? 1 : 0);
}
```

### Index Maintenance
- Index is rebuilt when drives are rescanned
- Files are removed from index when drives are deleted
- Manual index rebuilding available via `buildSearchIndex()`

## Performance Characteristics

### FTS MATCH Advantages:
- ✅ **Fast** - Uses optimized full-text index
- ✅ **Relevance ranking** - `ORDER BY bm25(files_fts)`
- ✅ **Token-based** - Handles word boundaries well
- ✅ **Boolean queries** - Supports AND/OR/NOT operations

### FTS MATCH Limitations:
- ❌ **No suffix search** - Cannot find files ending with ".pdf"
- ❌ **No infix search** - Cannot find files containing "abc" in middle
- ❌ **Stricter syntax** - Requires valid FTS syntax
- ❌ **Single character issues** - Fails on queries like "a"

### LIKE Advantages:
- ✅ **Flexible** - Works with any query pattern
- ✅ **Suffix support** - Can find files ending with ".pdf"
- ✅ **Simple** - No syntax requirements
- ✅ **Reliable** - Always works

### LIKE Limitations:
- ❌ **Slower** - Full table scan
- ❌ **Alphabetical ordering** - `ORDER BY files_fts.name`
- ❌ **No relevance ranking** - Results not ranked by relevance

## System File Filtering

The search system can optionally hide system files:

```typescript
const isSystemFile = (fileName: string): boolean => {
  const exactNames = new Set([
    '.DS_Store',
    '.Spotlight-V100',
    '.Trashes',
    '.fseventsd',
    '.TemporaryItems',
    'System Volume Information',
    '$RECYCLE.BIN',
  ]);
  if (exactNames.has(fileName)) return true;
  if (fileName.startsWith('._')) return true; // AppleDouble files
  return false;
};
```

## Pagination

Search results are paginated for performance:

- **Default page size**: 50 results
- **Maximum page size**: 500 results
- **Offset-based pagination**: `LIMIT ? OFFSET ?`
- **Total count**: Returned for UI pagination controls

## Error Handling

### Timeout Protection
```typescript
const timeoutPromise = new Promise<SearchResult[]>((_, reject) => {
  setTimeout(() => reject(new Error('Search timeout after 5 seconds')), 5000);
});

const results = await Promise.race([searchPromise, timeoutPromise]);
```

### Graceful Degradation
- Empty search index → Return empty results with helpful message
- Database errors → Fall back to LIKE or return empty results
- Invalid queries → Block problematic characters

## UI Integration

### Search Input
- Located in top-right corner
- Real-time search with 300ms debouncing
- Dropdown results display
- Keyboard navigation support

### Results Display
- File/folder icons
- Drive information
- Path display
- Click to navigate to file location

### Search State Management
- `searchQuery` - Current search term
- `searchResults` - Array of search results
- `isSearching` - Loading state
- `searchResultsVisible` - Number of visible results

## Future Improvements

1. **Hybrid Search**: Combine FTS and LIKE results for better coverage
2. **Fuzzy Matching**: Add typo tolerance
3. **Search Suggestions**: Auto-complete based on indexed content
4. **Advanced Filters**: Date ranges, file types, size ranges
5. **Search History**: Remember recent searches
6. **Index Optimization**: Better relevance scoring algorithms

## Troubleshooting

### Common Issues

**Empty Search Results:**
- Check if search index is built: `getSearchIndexStatus()`
- Verify drives are indexed: Look for FTS entries
- Check system file filtering settings

**Slow Search Performance:**
- Ensure FTS index is being used (check logs for "MATCH" vs "LIKE")
- Consider reducing page size
- Check for database corruption

**Missing Files:**
- Verify files are indexed during drive scanning
- Check if files are marked as deleted
- Ensure drive is not marked as deleted

### Debug Logging

The search system includes extensive logging:

```typescript
console.log('[Search] searchFilesPaged called with hideSystemFiles=', hideSystemFiles);
console.log('[Search] MATCH query:', sql);
console.log('[Search] LIKE fallback:', likeTerm);
console.log('[Search] Results:', results.length);
```

Enable debug logging to troubleshoot search issues.
