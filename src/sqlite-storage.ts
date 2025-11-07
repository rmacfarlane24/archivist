import * as path from 'path';
import * as fs from 'fs-extra';
import { app } from 'electron';
import Database from 'better-sqlite3';

// Paths
const STORAGE_DIR = path.join(app.getPath('userData'), 'storage');
const DB_PATH = path.join(STORAGE_DIR, 'catalog.db');

let db: Database.Database | null = null;

// Public types (match existing API expectations)
export interface DriveInfo {
  id: string;
  name: string;
  path: string;
  totalCapacity: number;
  usedSpace: number;
  freeSpace: number;
  serialNumber: string; // retained for compatibility
  formatType: string;
  addedDate: string;
  lastUpdated?: string;
  deleted?: boolean;
  deletedAt?: string;
}

export interface FileInfo {
  id: string;
  name: string;
  path: string;
  parentPath: string | null;
  size: number;
  created: string | null;
  modified: string | null;
  isDirectory: boolean;
  folderPath: string;
  driveId: string;
  depth: number;
  inode?: number;
  hardLinkCount?: number;
  isHardLink?: boolean;
  hardLinkGroup?: string;
  file_type?: string;
}

export interface SearchResult {
  fileId: string;
  driveId: string;
  driveName: string;
  fileName: string;
  fullPath: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

// Recovery functionality removed for MVP

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function normalizeForStorage(p: string | null): string | null {
  if (!p) return null;
  try {
    // Preserve non-filesystem URIs (e.g., demo://Demo/BigFolder)
    if (p.includes('://')) {
      const withoutTrailing = p.replace(/[\\/]+$/, '');
      return withoutTrailing.normalize('NFC');
    }
    const resolved = path.resolve(p);
    const withoutTrailing = resolved.replace(/[\\/]+$/, '');
    const nfc = withoutTrailing.normalize('NFC');
    return path.normalize(nfc);
  } catch {
    return p;
  }
}

function getExtension(nameOrPath: string): string | undefined {
  const ext = path.extname(nameOrPath);
  if (!ext) return undefined;
  return ext.replace(/^\./, '') || undefined;
}

export async function initializeStorage(): Promise<void> {
  try {
    await fs.ensureDir(STORAGE_DIR);
    console.log('[sqlite-storage] Storage directory ensured:', STORAGE_DIR);
    
    // Check if database file exists and is accessible
    const dbExists = await fs.pathExists(DB_PATH);
    console.log('[sqlite-storage] Database file exists:', dbExists, 'Path:', DB_PATH);
    
    db = new Database(DB_PATH);
    console.log('[sqlite-storage] Database connection established');

    // PRAGMAs
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -200000'); // ~200MB
    db.pragma('mmap_size = 268435456'); // 256MB
    
    // Check if we need to migrate the search index structure (one-time migration)
    let needsIndexRebuild = false;
    try {
      // Try to detect old search index structure
      const tableInfo = db.prepare(`PRAGMA table_info(files_fts)`).all() as any[];
      const hasPathColumn = tableInfo.some((col: any) => col.name === 'path');
      
      if (hasPathColumn) {
        console.log('[sqlite-storage] One-time migration: updating search index to name-only structure...');
        // Drop old FTS table with path column
        db.prepare(`DROP TABLE IF EXISTS files_fts`).run();
        needsIndexRebuild = true;
      }
    } catch (error) {
      // Table might not exist yet, that's fine
      console.log('[sqlite-storage] Search index table does not exist yet, will create new structure');
      needsIndexRebuild = true;
    }

    // Schema
    db.exec(`
    CREATE TABLE IF NOT EXISTS drives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      total_capacity INTEGER NOT NULL DEFAULT 0,
      used_space INTEGER NOT NULL DEFAULT 0,
      free_space INTEGER NOT NULL DEFAULT 0,
      format_type TEXT DEFAULT '',
      added_date TEXT NOT NULL,
      last_updated TEXT,
      deleted INTEGER DEFAULT 0,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      drive_id TEXT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      parent_path TEXT,
      is_directory INTEGER NOT NULL,
      size INTEGER,
      created TEXT,
      modified TEXT,
      depth INTEGER,
      inode INTEGER,
      hard_link_count INTEGER,
      is_hard_link INTEGER,
      hard_link_group TEXT,
      folder_path TEXT,
      file_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      deletion_reason TEXT,
      UNIQUE(drive_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_files_drive_parent ON files(drive_id, parent_path);
    CREATE INDEX IF NOT EXISTS idx_files_drive_name ON files(drive_id, name);
    CREATE INDEX IF NOT EXISTS idx_files_drive_dir_name ON files(drive_id, is_directory, name);
    -- Cover children listing with ORDER BY to avoid extra sort
    CREATE INDEX IF NOT EXISTS idx_files_list_children ON files(
      drive_id, parent_path, is_directory, name COLLATE NOCASE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, drive_id UNINDEXED,
      content='files', content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, name, drive_id) VALUES (new.rowid, new.name, new.drive_id);
    END;
    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, drive_id) VALUES ('delete', old.rowid, old.name, old.drive_id);
    END;
    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, drive_id) VALUES ('delete', old.rowid, old.name, old.drive_id);
      INSERT INTO files_fts(rowid, name, drive_id) VALUES (new.rowid, new.name, new.drive_id);
    END;

    -- Recovery functionality removed for MVP
  `);

    // Migration: Remove legacy UNIQUE constraint on drives.path if present
    try {
      const tableDef = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='drives'`).get() as any;
      const hasUniquePath = typeof tableDef?.sql === 'string' && /UNIQUE\s*\(\s*path\s*\)/i.test(tableDef.sql) || /path\s+TEXT[^,]*UNIQUE/i.test(tableDef.sql);
      if (hasUniquePath) {
        console.warn('[migrate] Detected legacy UNIQUE constraint on drives.path. Rebuilding drives table to remove it.');
        db.exec('PRAGMA foreign_keys=OFF;');
        db.exec('BEGIN IMMEDIATE;');
        // Create new table without UNIQUE(path)
        db.exec(`
          CREATE TABLE IF NOT EXISTS drives_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            total_capacity INTEGER NOT NULL DEFAULT 0,
            used_space INTEGER NOT NULL DEFAULT 0,
            free_space INTEGER NOT NULL DEFAULT 0,
            format_type TEXT DEFAULT '',
            added_date TEXT NOT NULL,
            last_updated TEXT,
            deleted INTEGER DEFAULT 0,
            deleted_at TEXT
          );
        `);
        // Copy data
        db.exec(`
          INSERT INTO drives_new (id, name, path, total_capacity, used_space, free_space, format_type, added_date, last_updated, deleted, deleted_at)
          SELECT id, name, path, total_capacity, used_space, free_space, format_type, added_date, last_updated, COALESCE(deleted,0), deleted_at FROM drives;
        `);
        // Replace old table
        db.exec('DROP TABLE drives;');
        db.exec('ALTER TABLE drives_new RENAME TO drives;');
        db.exec('COMMIT;');
        db.exec('PRAGMA foreign_keys=ON;');
        console.warn('[migrate] drives table rebuilt without UNIQUE(path).');
      }
    } catch (e) {
      try { db.exec('ROLLBACK;'); } catch {}
      try { db.exec('PRAGMA foreign_keys=ON;'); } catch {}
      console.warn('[migrate] Failed to check or migrate UNIQUE(path):', (e as any)?.message || e);
    }

    // Migration: Add deleted columns to existing drives table
    try {
      db.exec(`ALTER TABLE drives ADD COLUMN deleted INTEGER DEFAULT 0;`);
    } catch (e) {
      // Column already exists, ignore error
    }
    
    try {
      db.exec(`ALTER TABLE drives ADD COLUMN deleted_at TEXT;`);
    } catch (e) {
      // Column already exists, ignore error
    }

    // Migration: Add deletion columns to existing files table
    try {
      db.exec(`ALTER TABLE files ADD COLUMN deleted INTEGER DEFAULT 0;`);
    } catch (e) {
      // Column already exists, ignore error
    }
    
    try {
      db.exec(`ALTER TABLE files ADD COLUMN deleted_at TEXT;`);
    } catch (e) {
      // Column already exists, ignore error
    }
    
    try {
      db.exec(`ALTER TABLE files ADD COLUMN deletion_reason TEXT;`);
    } catch (e) {
      // Column already exists, ignore error
    }

    // Remove legacy JSON storage on first init
    try {
      const legacyDrives = path.join(STORAGE_DIR, 'drives.json');
      const legacyFilesDir = path.join(STORAGE_DIR, 'files');
      if (await fs.pathExists(legacyDrives)) await fs.remove(legacyDrives);
      if (await fs.pathExists(legacyFilesDir)) await fs.remove(legacyFilesDir);
    } catch {}

    // One-time cleanup: for drives created before we stopped auto-stamping last_updated,
    // clear last_updated if it was set equal to added_date (i.e., never actually updated).
    try {
      db.prepare(`UPDATE drives SET last_updated = NULL WHERE last_updated = added_date`).run();
    } catch {}

    // Recovery functionality removed for MVP

    // Only rebuild search index if we migrated or if it's truly empty
    if (needsIndexRebuild) {
      try {
        const searchCount = db.prepare(`SELECT COUNT(*) as count FROM files_fts`).get() as any;
        if (searchCount.count === 0) {
          console.log('[sqlite-storage] Search index needs rebuilding, will do in background...');
          // Schedule rebuild for after initialization
          setImmediate(async () => {
            try {
              console.log('[sqlite-storage] Rebuilding search index in background...');
              const activeFiles = db!.prepare(`
                SELECT f.rowid, f.name, f.drive_id 
                FROM files f 
                JOIN drives d ON f.drive_id = d.id 
                WHERE d.deleted = 0
              `).all() as any[];
              
              const insertStmt = db!.prepare(`INSERT INTO files_fts(rowid, name, drive_id) VALUES (?, ?, ?)`);
              for (const file of activeFiles) {
                insertStmt.run(file.rowid, file.name, file.drive_id);
              }
              console.log(`[sqlite-storage] Search index rebuild completed with ${activeFiles.length} files`);
            } catch (error) {
              console.warn('[sqlite-storage] Search index rebuild failed:', error);
            }
          });
        } else {
          console.log('[sqlite-storage] Search index already has data, no rebuild needed');
        }
      } catch (error) {
        console.warn('[sqlite-storage] Could not check search index status:', error);
      }
    } else {
      console.log('[sqlite-storage] Search index structure is current, no migration needed');
    }
    
    console.log('[sqlite-storage] Database initialization completed successfully');
  } catch (error) {
    console.error('[sqlite-storage] Database initialization failed:', error);
    throw error;
  }
}

function mapDriveRow(row: any): DriveInfo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    totalCapacity: Number(row.total_capacity || 0),
    usedSpace: Number(row.used_space || 0),
    freeSpace: Number(row.free_space || 0),
    serialNumber: '',
    formatType: row.format_type || '',
    addedDate: row.added_date,
    lastUpdated: row.last_updated ?? undefined,
    deleted: !!row.deleted,
    deletedAt: row.deleted_at ?? undefined
  };
}

function mapFileRow(row: any): FileInfo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    parentPath: row.parent_path ?? null,
    size: Number(row.size || 0),
    created: row.created ?? null,
    modified: row.modified ?? null,
    isDirectory: !!row.is_directory,
    folderPath: row.folder_path,
    driveId: row.drive_id,
    depth: Number(row.depth || 0),
    inode: row.inode ?? undefined,
    hardLinkCount: row.hard_link_count ?? undefined,
    isHardLink: row.is_hard_link ? true : false,
    hardLinkGroup: row.hard_link_group ?? undefined,
    file_type: row.file_type ?? undefined
  };
}

// Drives API
export async function storeDriveInfo(input: Omit<DriveInfo, 'id' | 'addedDate'> | DriveInfo): Promise<DriveInfo> {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const normalizedPath = normalizeForStorage((input as any).path)!;

  const base = {
    name: (input as any).name,
    path: normalizedPath,
    totalCapacity: (input as any).totalCapacity ?? 0,
    usedSpace: (input as any).usedSpace ?? 0,
    freeSpace: (input as any).freeSpace ?? 0,
    formatType: (input as any).formatType ?? ''
  };

  // 1) If an ID is provided, ALWAYS update that drive ID (allow duplicate paths/names)
  if ('id' in input && (input as any).id) {
    const id = (input as any).id as string;
    const existing = db.prepare(`SELECT * FROM drives WHERE id=?`).get(id) as any;
    if (existing) {
      const explicitStamp = (input as any).lastUpdated ?? now;
      db.prepare(
        `UPDATE drives SET name=?, path=?, total_capacity=?, used_space=?, free_space=?, format_type=?, deleted=0, deleted_at=NULL, last_updated=? WHERE id=?`
      ).run(
        base.name,
        base.path,
        base.totalCapacity,
        base.usedSpace,
        base.freeSpace,
        base.formatType,
        explicitStamp,
        id
      );
      const row = db.prepare(`SELECT * FROM drives WHERE id=?`).get(id) as any;
      return mapDriveRow(row);
    }
    // If no existing row with this ID, insert a new one with this ID
    db.prepare(`INSERT INTO drives(id, name, path, total_capacity, used_space, free_space, format_type, added_date, last_updated, deleted, deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, base.name, base.path, base.totalCapacity, base.usedSpace, base.freeSpace, base.formatType, now, null, 0, null);
    const row = db.prepare(`SELECT * FROM drives WHERE id=?`).get(id) as any;
    return mapDriveRow(row);
  }

  // 2) No ID provided: insert a new drive; if legacy UNIQUE(path) exists, fall back to update-by-path
  const id = generateId();
  try {
    db.prepare(`INSERT INTO drives(id, name, path, total_capacity, used_space, free_space, format_type, added_date, last_updated, deleted, deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, base.name, base.path, base.totalCapacity, base.usedSpace, base.freeSpace, base.formatType, now, null, 0, null);
  } catch (e: any) {
    if (e && typeof e.message === 'string' && e.message.includes('UNIQUE') && e.message.includes('path')) {
      // Legacy DBs: reuse existing row by path
      const existingByPath = db.prepare(`SELECT * FROM drives WHERE path=?`).get(base.path) as any;
      if (existingByPath) {
        db.prepare(
          `UPDATE drives SET name=?, total_capacity=?, used_space=?, free_space=?, format_type=?, deleted=0, deleted_at=NULL, last_updated=? WHERE id=?`
        ).run(
          base.name,
          base.totalCapacity,
          base.usedSpace,
          base.freeSpace,
          base.formatType,
          now,
          existingByPath.id
        );
        const row = db.prepare(`SELECT * FROM drives WHERE id=?`).get(existingByPath.id) as any;
        return mapDriveRow(row);
      }
    }
    throw e;
  }
  const row = db.prepare(`SELECT * FROM drives WHERE id=?`).get(id) as any;
  return mapDriveRow(row);
}

export async function getStoredDrives(): Promise<DriveInfo[]> {
  if (!db) throw new Error('DB not initialized');
  const rows = db.prepare(`SELECT * FROM drives ORDER BY name COLLATE NOCASE`).all() as any[];
  return rows.map(mapDriveRow);
}

export async function getActiveDrives(): Promise<DriveInfo[]> {
  if (!db) throw new Error('DB not initialized');
  const rows = db.prepare(`SELECT * FROM drives WHERE deleted = 0 OR deleted IS NULL ORDER BY name COLLATE NOCASE`).all() as any[];
  return rows.map(mapDriveRow);
}

export async function getDriveById(driveId: string): Promise<DriveInfo | null> {
  if (!db) throw new Error('DB not initialized');
  const row = db.prepare(`SELECT * FROM drives WHERE id=?`).get(driveId) as any;
  return row ? mapDriveRow(row) : null;
}

export async function deleteDrive(driveId: string): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  const tx = db.transaction((id: string) => {
    // Hard delete: remove drive completely
    db!.prepare(`DELETE FROM drives WHERE id=?`).run(id);
    // Remove files from search index for deleted drive
    db!.prepare(`DELETE FROM files_fts WHERE drive_id = ?`).run(id);
    // Remove all files for this drive
    db!.prepare(`DELETE FROM files WHERE drive_id = ?`).run(id);
  });
  tx(driveId);
}

export async function undeleteDrive(driveId: string): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  const tx = db.transaction((id: string) => {
    // Undelete: mark drive as active again
    db!.prepare(`UPDATE drives SET deleted = 0, deleted_at = NULL WHERE id=?`).run(id);
    
    // Re-add files to search index for restored drive
    const files = db!.prepare(`SELECT rowid, name, drive_id FROM files WHERE drive_id = ?`).all(id) as any[];
    const insertStmt = db!.prepare(`INSERT INTO files_fts(rowid, name, drive_id) VALUES (?, ?, ?)`);
    for (const file of files) {
      insertStmt.run(file.rowid, file.name, file.drive_id);
    }
  });
  tx(driveId);
}

// Files API
export async function storeFileTree(driveId: string, fileTree: Omit<FileInfo, 'id'>[]): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  const insert = db.prepare(`INSERT INTO files (
    id, drive_id, name, path, parent_path, is_directory, size, created, modified, depth, inode, hard_link_count, is_hard_link, hard_link_group, folder_path, file_type, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);

  const tx = db.transaction((rows: Omit<FileInfo, 'id'>[]) => {
    // Delete all files for this drive (triggers will automatically remove from FTS index)
    db!.prepare(`DELETE FROM files WHERE drive_id=?`).run(driveId);
    
    // Insert new files (triggers will automatically populate FTS index)
    for (const f of rows) {
      const normPath = normalizeForStorage(f.path)!;
      const normParent = normalizeForStorage(f.parentPath);
      const normFolder = normalizeForStorage(f.folderPath)!;
      const id = generateId();
      const ext = f.file_type ?? getExtension(f.name ?? normPath);
      insert.run(
        id,
        driveId,
        f.name,
        normPath,
        normParent,
        f.isDirectory ? 1 : 0,
        f.size ?? 0,
        f.created ?? null,
        f.modified ?? null,
        f.depth ?? 0,
        f.inode ?? null,
        f.hardLinkCount ?? null,
        f.isHardLink ? 1 : 0,
        f.hardLinkGroup ?? null,
        normFolder,
        ext ?? null
      );
    }
  });
  tx(fileTree);
}

export async function getDriveFiles(driveId: string): Promise<FileInfo[]> {
  if (!db) throw new Error('DB not initialized');
  const rows = db.prepare(`SELECT * FROM files WHERE drive_id=? ORDER BY is_directory DESC, name COLLATE NOCASE ASC`).all(driveId) as any[];
  return rows.map(mapFileRow);
}

export async function storeMetadata(folderPath: string, metadata: Omit<FileInfo, 'id'>[]): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  const norm = normalizeForStorage(folderPath)!;
  const drive = db.prepare(`SELECT * FROM drives WHERE ? LIKE path || '%' ORDER BY length(path) DESC LIMIT 1`).get(norm) as any;
  if (!drive) throw new Error('No drive found for folder path');
  const existing = await getDriveFiles(drive.id);
  const remaining = existing.filter(f => !(f.folderPath && f.folderPath.startsWith(norm)));
  await storeFileTree(drive.id, [...remaining, ...metadata.map(m => ({ ...m, driveId: drive.id }))]);
}

export async function getStoredMetadata(folderPath: string): Promise<FileInfo[]> {
  if (!db) throw new Error('DB not initialized');
  const norm = normalizeForStorage(folderPath)!;
  const rows = db.prepare(`SELECT * FROM files WHERE folder_path=? ORDER BY is_directory DESC, name COLLATE NOCASE ASC`).all(norm) as any[];
  return rows.map(mapFileRow);
}

export async function updateFileSize(driveId: string, filePath: string, newSize: number): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  const norm = normalizeForStorage(filePath)!;
  db.prepare(`UPDATE files SET size=?, updated_at=datetime('now') WHERE drive_id=? AND path=?`).run(newSize, driveId, norm);
}

// Helper function to escape FTS special characters
function escapeFtsQuery(query: string): string {
  // FTS5 special characters that need escaping: " & | ( ) * + - < > = ^ ~ : [ ] { }
  // For better search results, we'll use a more flexible approach:
  // 1. If the query contains special characters, wrap in quotes for phrase search
  // 2. Otherwise, use simple text search which is faster
  const hasSpecialChars = /["&|()*+\-<>=^~:\[\]{}]/.test(query);
  
  if (hasSpecialChars) {
    // Escape double quotes and wrap in quotes for phrase search
    return `"${query.replace(/"/g, '""')}"`;
  } else {
    // Simple text search - faster and more flexible
    return query;
  }
}

// Search
export async function searchFiles(query: string): Promise<SearchResult[]> {
  if (!db) {
    console.error('[sqlite-storage] Database not initialized');
    return [];
  }
  
  if (!query || !query.trim()) {
    console.log('[sqlite-storage] Empty search query, returning empty results');
    return [];
  }
  
  console.log('[sqlite-storage] Search query:', query);
  
  try {
    // Check if search index has any data for debugging
    const indexCount = db.prepare(`SELECT COUNT(*) as count FROM files_fts`).get() as any;
    console.log('[sqlite-storage] Search index has', indexCount.count, 'entries');
    
    if (indexCount.count === 0) {
      console.warn('[sqlite-storage] Search index is empty - returning empty results immediately');
      console.log('[sqlite-storage] To enable search, please add some drives first');
      return [];
    }
    
    // Use FTS search directly - it's fast and handles all query types
    const escapedQuery = escapeFtsQuery(query);
    console.log('[sqlite-storage] Escaped query:', escapedQuery);
    
    // Add timeout protection to prevent hanging
    const searchPromise = new Promise<SearchResult[]>((resolve, reject) => {
      try {
        if (!db) {
          reject(new Error('Database not initialized'));
          return;
        }
        
        const stmt = db.prepare(`
          SELECT 
            f.id as fileId,
            f.drive_id as driveId,
            d.name as driveName,
            f.name as fileName,
            f.path as fullPath,
            f.is_directory as isDirectory,
            f.size as size,
            f.modified as modified
          FROM files_fts, files f, drives d
          WHERE files_fts.rowid = f.rowid
            AND d.id = f.drive_id
            AND d.deleted = 0
            AND f.deleted = 0
            AND files_fts MATCH ?
          ORDER BY bm25(files_fts)
          LIMIT 200
        `);
        
        const rows = stmt.all(escapedQuery) as any[];
        console.log('[sqlite-storage] FTS search returned', rows.length, 'results');
        const results = rows.map(r => ({
          fileId: r.fileId,
          driveId: r.driveId,
          driveName: r.driveName,
          fileName: r.fileName,
          fullPath: r.fullPath,
          isDirectory: !!r.isDirectory,
          size: r.size ?? undefined,
          modified: r.modified ?? undefined
        }));
        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
    
    // Add 5 second timeout
    const timeoutPromise = new Promise<SearchResult[]>((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout after 5 seconds')), 5000);
    });
    
    const results = await Promise.race([searchPromise, timeoutPromise]);
    return results;
    
  } catch (error) {
    console.error('[sqlite-storage] FTS search failed:', error);
    // Return empty results instead of falling back to slow LIKE search
    return [];
  }
}

export async function buildSearchIndex(): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  
  try {
    // Check if FTS table exists
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'`).get() as any;
    if (!tableExists) {
      console.error('[sqlite-storage] FTS table does not exist, cannot rebuild index');
      throw new Error('FTS table does not exist');
    }
    
    // Check if index is empty and rebuild if needed
    const indexCount = db.prepare(`SELECT COUNT(*) as count FROM files_fts`).get() as any;
    console.log('[sqlite-storage] Current search index has', indexCount.count, 'entries');
    
    if (indexCount.count === 0) {
      console.log('[sqlite-storage] Search index is empty, rebuilding...');
      // Use manual population instead of generic REBUILD to avoid including deleted data
      await populateSearchIndex();
      
      // Verify rebuild worked
      const newCount = db.prepare(`SELECT COUNT(*) as count FROM files_fts`).get() as any;
      console.log('[sqlite-storage] Search index rebuild completed with', newCount.count, 'entries');
    } else {
      console.log('[sqlite-storage] Search index already has data, no rebuild needed');
    }
  } catch (error) {
    console.error('[sqlite-storage] Error in buildSearchIndex:', error);
    throw error;
  }
}



export async function getSearchIndexStatus(): Promise<{ isBuilt: boolean; totalIndexed: number; totalFiles?: number; inSync?: boolean }> {
  if (!db) throw new Error('DB not initialized');
  
  try {
    // Check if FTS table exists
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'`).get() as any;
    if (!tableExists) {
      return { isBuilt: false, totalIndexed: 0 };
    }
    
    // Count files in FTS index
    const indexedCount = db.prepare(`SELECT COUNT(*) as c FROM files_fts`).get() as any;
    
    // Count total files from active drives and non-deleted files
    const totalFiles = db.prepare(`
      SELECT COUNT(*) as c FROM files f 
      JOIN drives d ON f.drive_id = d.id 
      WHERE d.deleted = 0 AND f.deleted = 0
    `).get() as any;
    
    const totalIndexed = indexedCount.c as number;
    const totalFilesCount = totalFiles.c as number;
    
    // Check if index is in sync
    const isBuilt = totalIndexed > 0 && Math.abs(totalIndexed - totalFilesCount) < 10; // Allow small discrepancy
    
    return { 
      isBuilt, 
      totalIndexed,
      totalFiles: totalFilesCount,
      inSync: Math.abs(totalIndexed - totalFilesCount) < 10
    };
  } catch (error) {
    console.error('[sqlite-storage] Error getting search index status:', error);
    return { isBuilt: false, totalIndexed: 0 };
  }
}

export async function checkSearchIndexHealth(): Promise<{ 
  healthy: boolean; 
  totalFiles: number; 
  totalIndexed: number; 
  activeDrives: number;
  issues: string[];
}> {
  if (!db) throw new Error('DB not initialized');
  
  const issues: string[] = [];
  
  try {
    // Check if FTS table exists
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'`).get() as any;
    if (!tableExists) {
      issues.push('FTS table does not exist');
      return { healthy: false, totalFiles: 0, totalIndexed: 0, activeDrives: 0, issues };
    }
    
    // Count total files in files table
    const totalFiles = db.prepare(`SELECT COUNT(*) as c FROM files`).get() as any;
    
    // Count files in FTS index
    const totalIndexed = db.prepare(`SELECT COUNT(*) as c FROM files_fts`).get() as any;
    
    // Count active drives
    const activeDrives = db.prepare(`SELECT COUNT(*) as c FROM drives WHERE deleted = 0`).get() as any;
    
    // Check for potential issues
    if (totalIndexed.count === 0 && totalFiles.count > 0) {
      issues.push('FTS index is empty but files exist');
    }
    
    if (totalIndexed.count > totalFiles.count) {
      issues.push('FTS index has more entries than files table');
    }
    
    const healthy = issues.length === 0;
    
    return {
      healthy,
      totalFiles: totalFiles.count || 0,
      totalIndexed: totalIndexed.count || 0,
      activeDrives: activeDrives.count || 0,
      issues
    };
  } catch (error) {
    issues.push(`Error checking index health: ${error}`);
    return { healthy: false, totalFiles: 0, totalIndexed: 0, activeDrives: 0, issues };
  }
}

// Simple memory cache facade to keep existing usage working
class MemoryCache {
  private drives: Map<string, DriveInfo> = new Map();
  private files: Map<string, FileInfo[]> = new Map();
  async initialize(): Promise<void> {
    try {
      const all = await getStoredDrives();
      this.drives.clear();
      for (const d of all) this.drives.set(d.id, d);
    } catch {}
  }
  getDrive(id: string): DriveInfo | undefined { return this.drives.get(id); }
  getAllDrives(): DriveInfo[] { return Array.from(this.drives.values()); }
  setDrive(d: DriveInfo): void { this.drives.set(d.id, d); }
  deleteDrive(id: string): void { this.drives.delete(id); this.files.delete(id); }
  async getFiles(driveId: string): Promise<FileInfo[]> {
    if (this.files.has(driveId)) return this.files.get(driveId)!;
    const rows = await getDriveFiles(driveId);
    this.files.set(driveId, rows);
    return rows;
  }
  setFiles(driveId: string, files: FileInfo[]): void { this.files.set(driveId, files); }
  clearFiles(driveId: string): void { this.files.delete(driveId); }
}

export const memoryCache = new MemoryCache();

// File deletion functions (automatic only - happens during drive rescans)
export async function softDeleteFile(fileId: string, reason: string = 'file_removed'): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  
  const tx = db.transaction((id: string, deletionReason: string) => {
    // Hard delete: remove file completely
    db!.prepare(`DELETE FROM files WHERE id = ?`).run(id);
    
    // Remove from search index (triggers will handle this automatically)
    // But we can also do it manually to be sure
    db!.prepare(`DELETE FROM files_fts WHERE rowid = (SELECT rowid FROM files WHERE id = ?)`).run(id);
  });
  
  try {
    tx(fileId, reason);
    console.log(`[sqlite-storage] File ${fileId} automatically hard deleted during rescan with reason: ${reason}`);
  } catch (error) {
    console.error(`[sqlite-storage] Error hard deleting file ${fileId}:`, error);
  }
}

export async function softDeleteFilesByPath(driveId: string, filePath: string, reason: string = 'file_removed'): Promise<number> {
  if (!db) throw new Error('DB not initialized');
  
  const tx = db.transaction((drive: string, path: string, deletionReason: string) => {
    // Hard delete: remove files completely
    const result = db!.prepare(`
      DELETE FROM files WHERE drive_id = ? AND path = ?
    `).run(drive, path);
    
    // Remove from search index
    db!.prepare(`DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE drive_id = ? AND path = ?)`).run(drive, path);
    
    return result.changes;
  });
  
  try {
    const deletedCount = tx(driveId, filePath, reason);
    console.log(`[sqlite-storage] ${deletedCount} files automatically hard deleted at path ${filePath} during rescan with reason: ${reason}`);
    return deletedCount;
  } catch (error) {
    console.error(`[sqlite-storage] Error hard deleting files at path ${filePath}:`, error);
    return 0;
  }
}

// Recovery functionality removed for MVP

export async function getDeletedFiles(driveId?: string): Promise<Array<{
  id: string;
  name: string;
  path: string;
  driveId: string;
  deletedAt: string;
  deletionReason: string;
  size: number;
  isDirectory: boolean;
}>> {
  if (!db) throw new Error('DB not initialized');
  
  let query = `
    SELECT f.id, f.name, f.path, f.drive_id, f.deleted_at, f.deletion_reason, f.size, f.is_directory
    FROM files f
    WHERE f.deleted = 1
  `;
  
  if (driveId) {
    query += ` AND f.drive_id = ?`;
    const rows = db.prepare(query).all(driveId) as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      driveId: r.drive_id,
      deletedAt: r.deleted_at,
      deletionReason: r.deletion_reason,
      size: r.size || 0,
      isDirectory: !!r.is_directory
    }));
  } else {
    const rows = db.prepare(query).all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      driveId: r.drive_id,
      deletedAt: r.deleted_at,
      deletionReason: r.deletion_reason,
      size: r.size || 0,
      isDirectory: !!r.is_directory
    }));
  }
}

export async function permanentlyDeleteFile(fileId: string): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  
  const tx = db.transaction((id: string) => {
    // Remove from search index first
    db!.prepare(`DELETE FROM files_fts WHERE rowid = (SELECT rowid FROM files WHERE id = ?)`).run(id);
    
    // Permanently delete the file
    db!.prepare(`DELETE FROM files WHERE id = ?`).run(id);
  });
  
  tx(fileId);
  console.log(`[sqlite-storage] File ${fileId} permanently deleted`);
}

export async function cleanupSoftDeletedRecords(): Promise<{ 
  deletedFiles: number; 
  deletedDrives: number; 
  freedSpace: number;
}> {
  if (!db) throw new Error('DB not initialized');
  
  console.log('[sqlite-storage] Starting cleanup of soft-deleted records...');
  
  const tx = db.transaction(() => {
    // Get counts before deletion for reporting
    const deletedFilesCount = db!.prepare(`SELECT COUNT(*) as count FROM files WHERE deleted = 1`).get() as any;
    const deletedDrivesCount = db!.prepare(`SELECT COUNT(*) as count FROM drives WHERE deleted = 1`).get() as any;
    
    // Get total size of soft-deleted files for reporting
    const deletedFilesSize = db!.prepare(`
      SELECT COALESCE(SUM(size), 0) as total_size 
      FROM files 
      WHERE deleted = 1 AND size IS NOT NULL
    `).get() as any;
    
    console.log(`[sqlite-storage] Found ${deletedFilesCount.count} soft-deleted files and ${deletedDrivesCount.count} soft-deleted drives`);
    console.log(`[sqlite-storage] Soft-deleted files total size: ${(deletedFilesSize.total_size / (1024 * 1024 * 1024)).toFixed(2)} GB`);
    
    // Remove soft-deleted files from search index (in case they're still there)
    db!.prepare(`
      DELETE FROM files_fts 
      WHERE rowid IN (SELECT rowid FROM files WHERE deleted = 1)
    `).run();
    
    // Hard delete all soft-deleted files
    const filesDeleted = db!.prepare(`DELETE FROM files WHERE deleted = 1`).run();
    
    // Hard delete all soft-deleted drives
    const drivesDeleted = db!.prepare(`DELETE FROM drives WHERE deleted = 1`).run();
    
    console.log(`[sqlite-storage] Hard deleted ${filesDeleted.changes} files and ${drivesDeleted.changes} drives`);
    
    return {
      deletedFiles: filesDeleted.changes,
      deletedDrives: drivesDeleted.changes,
      freedSpace: deletedFilesSize.total_size
    };
  });
  
  const result = tx();
  
  // Run VACUUM to reclaim disk space
  console.log('[sqlite-storage] Running VACUUM to reclaim disk space...');
  db.exec('VACUUM');
  console.log('[sqlite-storage] VACUUM completed');
  
  console.log(`[sqlite-storage] Cleanup completed: ${result.deletedFiles} files, ${result.deletedDrives} drives, ${(result.freedSpace / (1024 * 1024 * 1024)).toFixed(2)} GB freed`);
  
  return result;
}

// Recovery functionality removed for MVP

// Tree helpers
export async function listRoot(driveId: string): Promise<FileInfo[]> {
  if (!db) throw new Error('DB not initialized');
  const rows = db.prepare(`SELECT * FROM files WHERE drive_id=? AND parent_path IS NULL ORDER BY is_directory DESC, name COLLATE NOCASE ASC`).all(driveId) as any[];
  return rows.map(mapFileRow);
}

export async function listChildren(
  driveId: string,
  parentPath: string,
  limit: number = 500,
  offset: number = 0
): Promise<{ files: FileInfo[]; hasMore: boolean }> {
  if (!db) throw new Error('DB not initialized');
  const norm = normalizeForStorage(parentPath)!;
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE drive_id=? AND parent_path=?
       ORDER BY is_directory DESC, name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(driveId, norm, limit + 1, offset) as any[];
  const hasMore = rows.length > limit;
  const files = (hasMore ? rows.slice(0, limit) : rows).map(mapFileRow);
  return { files, hasMore };
}

// Populate a demo drive with many files/folders without touching the filesystem
// (Removed) populateDemoDrive

// Recovery functionality removed for MVP

export async function populateSearchIndex(): Promise<void> {
  if (!db) throw new Error('DB not initialized');
  
  console.log('[sqlite-storage] Manually populating search index...');
  
  try {
    // Clear existing index
    db.prepare(`DELETE FROM files_fts`).run();
    
    // Get all active files from non-deleted drives and non-deleted files
    const activeFiles = db.prepare(`
      SELECT f.rowid, f.name, f.drive_id 
      FROM files f 
      JOIN drives d ON f.drive_id = d.id 
      WHERE d.deleted = 0 AND f.deleted = 0
    `).all() as any[];
    
    console.log('[sqlite-storage] Found', activeFiles.length, 'files to index');
    
    if (activeFiles.length > 0) {
      const insertStmt = db.prepare(`INSERT INTO files_fts(rowid, name, drive_id) VALUES (?, ?, ?)`);
      
      // Insert in batches for better performance
      const batchSize = 1000;
      for (let i = 0; i < activeFiles.length; i += batchSize) {
        const batch = activeFiles.slice(i, i + batchSize);
        for (const file of batch) {
          insertStmt.run(file.rowid, file.name, file.drive_id);
        }
        
        if (i % (batchSize * 10) === 0) {
          console.log(`[sqlite-storage] Indexed ${i + batch.length}/${activeFiles.length} files...`);
        }
      }
      
      console.log('[sqlite-storage] Search index population completed with', activeFiles.length, 'files');
    } else {
      console.log('[sqlite-storage] No files to index');
    }
  } catch (error) {
    console.error('[sqlite-storage] Error populating search index:', error);
    throw error;
  }
}


