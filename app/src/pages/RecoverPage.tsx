import React, { useState, useEffect } from 'react';
import { RestoreConfirmation } from '../components/RestoreConfirmation';
import { useAuthStateManager } from '../contexts/AuthStateManager';

// Backup file tree component matching main app's styling
interface BackupFileTreeProps {
  files: any[];
  darkMode: boolean;
  formatFileSize: (bytes: number) => string;
  depth?: number;
}

// File date component for backup files
const BackupFileDate: React.FC<{ file: any; darkMode: boolean }> = ({ file, darkMode }) => {
  const formatDate = (dateString: string | number) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };
  
  return (
    <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} text-center`}>
      {file.modified ? formatDate(file.modified) : ''}
    </div>
  );
};

// File size component for backup files  
const BackupFileSize: React.FC<{ file: any; darkMode: boolean; formatFileSize: (bytes: number) => string }> = ({ file, darkMode, formatFileSize }) => {
  return (
    <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} text-right`}>
      {file.isDirectory ? (
        // For directories, show their actual size if available, otherwise show item count
        file.size && file.size > 0 ? formatFileSize(file.size) : (
          <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {file.children?.length ? `${file.children.length} items` : '—'}
          </span>
        )
      ) : (
        // For files, always show the actual size
        file.size && file.size > 0 ? formatFileSize(file.size) : '—'
      )}
    </div>
  );
};

const BackupFileTree: React.FC<BackupFileTreeProps> = ({ files, darkMode, formatFileSize, depth = 0 }) => {
  // Move expandedFolders state to parent component level so it persists across re-renders
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    console.log(`Toggling folder: ${path}`);
    setExpandedFolders(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(path)) {
        console.log(`Collapsing: ${path}`);
        newExpanded.delete(path);
      } else {
        console.log(`Expanding: ${path}`);
        newExpanded.add(path);
      }
      return newExpanded;
    });
  };

  const renderFile = (file: any, fileDepth: number = 0) => {
    const isExpanded = expandedFolders.has(file.path);
    const hasChildren = file.children && file.children.length > 0;
    const key = file.id || `${file.path}-${file.name}`;
    
    // Debug logging
    if (file.isDirectory && fileDepth === 0) {
      console.log(`Rendering folder: ${file.name}, hasChildren: ${hasChildren}, childrenCount: ${file.children?.length || 0}, isExpanded: ${isExpanded}`);
    }

    const childrenElements = file.isDirectory && isExpanded && hasChildren ? (
      <div>
        {file.children
          .filter((child: any) => child && typeof child === 'object')
          .map((child: any) => renderFile(child, fileDepth + 1))
          .filter(Boolean)
        }
      </div>
    ) : null;

    return (
      <div key={key}>
        <div 
          className={`w-full max-w-[90%] mx-auto grid grid-cols-[7fr_3fr_2fr] gap-4 items-center py-2 px-3 rounded ${
            darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100'
          } ${file.isDirectory ? 'cursor-pointer' : ''}`}
          onClick={(e) => {
            if (file.isDirectory) {
              console.log(`Clicked folder: ${file.name}, has children: ${hasChildren}`);
              toggleFolder(file.path, e);
            }
          }}
        >
          <div className="flex items-center space-x-3 min-w-0" style={{ paddingLeft: `${fileDepth * 20 + 12}px` }}>
            {file.isDirectory && (
              <span className="text-lg">📁</span>
            )}
            {!file.isDirectory && (
              <div className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="text-sm truncate" title={file.name}>{file.name}</span>
          </div>
          <BackupFileDate file={file} darkMode={darkMode} />
          <BackupFileSize file={file} darkMode={darkMode} formatFileSize={formatFileSize} />
        </div>
        {childrenElements}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {files.map((file) => renderFile(file, depth))}
    </div>
  );
};

interface BackupInfo {
  id: string;
  type: 'drive' | 'catalog';
  driveId?: string;
  driveName?: string;
  timestamp: number;
  size: number;
  path: string;
  totalCapacity?: number;
  usedSpace?: number;
  freeSpace?: number;
  serialNumber?: string;
  formatType?: string;
  addedDate?: string;
  fileCount?: number;
  scanType?: 'initial' | 'sync' | 'unknown';
  backupSequence?: number;
}

interface GroupedBackup {
  driveId: string;
  driveName: string;
  backups: BackupInfo[];
  latestBackup: BackupInfo;
  totalBackups: number;
}

interface RecoverPageProps {
  darkMode: boolean;
  onBack: () => void;
}

export const RecoverPage: React.FC<RecoverPageProps> = ({ darkMode, onBack }) => {
  const authStateManager = useAuthStateManager();
  const [groupedBackups, setGroupedBackups] = useState<GroupedBackup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupInfo | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedBackups, setExpandedBackups] = useState<Set<string>>(new Set());
  const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set());
  const [backupToDelete, setBackupToDelete] = useState<BackupInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [backupFileTrees, setBackupFileTrees] = useState<Map<string, any[]>>(new Map());

  // Load backups on component mount
  useEffect(() => {
    loadGroupedBackups();
  }, []);

  const loadGroupedBackups = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const result = await window.electronAPI.getGroupedBackups();
      if (result.success) {
        setGroupedBackups(result.groupedBackups);
      } else {
        setError(result.error || 'Failed to load backups');
      }
    } catch (error: any) {
      setError(error.message || 'Failed to load backups');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const findBackupById = (backupId: string): BackupInfo | null => {
    for (const group of groupedBackups) {
      const backup = group.backups.find(b => b.id === backupId);
      if (backup) return backup;
    }
    return null;
  };

  const handleRestore = (backupId: string) => {
    const backup = findBackupById(backupId);
    if (backup) {
      setSelectedBackup(backup);
      setShowRestoreModal(true);
    }
  };

  const toggleBackupSelection = (backupId: string) => {
    const newSelection = new Set(selectedBackups);
    if (newSelection.has(backupId)) {
      newSelection.delete(backupId);
    } else {
      newSelection.add(backupId);
    }
    setSelectedBackups(newSelection);
  };

  const toggleGroupExpansion = (driveId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(driveId)) {
      newExpanded.delete(driveId);
    } else {
      newExpanded.add(driveId);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleBackupExpansion = async (backupId: string) => {
    const newExpanded = new Set(expandedBackups);
    if (newExpanded.has(backupId)) {
      newExpanded.delete(backupId);
    } else {
      newExpanded.add(backupId);
      
      // Load file tree if not already loaded
      if (!backupFileTrees.has(backupId)) {
        await loadBackupFileTree(backupId);
      }
    }
    setExpandedBackups(newExpanded);
  };

  const loadBackupFileTree = async (backupId: string) => {
    try {
      console.log(`Loading backup file tree for ${backupId}`);
      
      // Get the full file tree from the backup - this should include all files in hierarchical structure
      const result = await window.electronAPI.getBackupFileTree(backupId);
      
      if (result.success && result.fileTree && result.fileTree.length > 0) {
        console.log(`Got ${result.fileTree.length} files for backup ${backupId}`);
        
        // If the result is already hierarchical (has children), use it directly
        // Otherwise, build the hierarchy from flat structure
        const hasHierarchy = result.fileTree.some(item => item.children && item.children.length > 0);
        
        if (hasHierarchy) {
          console.log('Using pre-built hierarchical structure');
          setBackupFileTrees(prev => new Map(prev.set(backupId, result.fileTree || [])));
        } else {
          console.log('Building hierarchy from flat file list');
          // Build hierarchical tree structure from flat file list
          const fileTree = buildBackupFileTree(result.fileTree);
          setBackupFileTrees(prev => new Map(prev.set(backupId, fileTree)));
        }
      } else {
        console.log('No files found for backup:', result.error);
        setBackupFileTrees(prev => new Map(prev.set(backupId, [])));
      }
    } catch (error) {
      console.error('Failed to load file tree:', error);
      setBackupFileTrees(prev => new Map(prev.set(backupId, [])));
    }
  };

  // Build file tree structure from flat file list (copied from main App.tsx)
  const buildBackupFileTree = (files: any[]) => {
    if (!files || files.length === 0) {
      return [];
    }

    console.log(`Building backup file tree from ${files.length} files`);
    console.log('Sample files:', files.slice(0, 3));

    const fileMap = new Map<string, any>();
    const childrenMap = new Map<string, any[]>();
    
    // Create maps for quick lookup
    files.forEach(file => {
      fileMap.set(file.path, file);
      if (file.parentPath) {
        if (!childrenMap.has(file.parentPath)) {
          childrenMap.set(file.parentPath, []);
        }
        childrenMap.get(file.parentPath)!.push(file);
      }
    });
    
    console.log('Children map size:', childrenMap.size);
    console.log('Children map keys:', Array.from(childrenMap.keys()).slice(0, 5));
    
    // Build tree structure
    const buildNode = (filePath: string): any => {
      const file = fileMap.get(filePath);
      if (!file) {
        return null;
      }
      
      // Get children for this node
      const allChildren = childrenMap.get(filePath) || [];
      const seenChildKeys = new Set<string>();
      const children = allChildren.filter((child) => {
        const key = child.path || child.id || `${child.name}`;
        if (seenChildKeys.has(key)) return false;
        seenChildKeys.add(key);
        return true;
      });
      
      const result = {
        ...file,
        children: children.map(child => buildNode(child.path)).filter(Boolean)
      };
      
      return result;
    };
    
    // Get root items (items with no parentPath or parentPath is null/empty)
    const rootItems = files.filter(file => !file.parentPath || file.parentPath === '');
    console.log(`Building tree from ${rootItems.length} root items`);
    console.log('Root items:', rootItems.slice(0, 3));
    
    const tree = rootItems.map(file => buildNode(file.path)).filter(Boolean);
    console.log(`Built tree with ${tree.length} root nodes`);
    console.log('Tree sample:', tree.slice(0, 2));
    return tree;
  };

  const handleRestoreConfirm = async () => {
    if (!selectedBackup) return;

    try {
      setIsRestoring(true);
      setError(null);
      
      let result;
      if (selectedBackup.type === 'drive') {
        result = await window.electronAPI.restoreDriveFromBackup(selectedBackup.id);
      } else if (selectedBackup.type === 'catalog') {
        result = await window.electronAPI.restoreCatalogFromBackup(selectedBackup.id);
      } else {
        setError('Invalid restore operation');
        return;
      }

      if (result.success) {
        setShowRestoreModal(false);
        setSelectedBackup(null);
        await loadGroupedBackups(); // Refresh the backup list
        
        // If it was a drive restore, refresh the drives list in the main app
        if (selectedBackup.type === 'drive') {
          authStateManager.loadUserData?.();
        }
      } else {
        setError(result.error || 'Failed to restore backup');
      }
    } catch (error: any) {
      setError(error.message || 'Failed to restore backup');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = (backupId: string) => {
    const backup = findBackupById(backupId);
    if (backup) {
      setBackupToDelete(backup);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!backupToDelete) return;

    try {
      setIsDeleting(true);
      setError(null);
      
      const result = await window.electronAPI.deleteBackup(backupToDelete.id);

      if (result.success) {
        setBackupToDelete(null);
        await loadGroupedBackups(); // Refresh the list
      } else {
        setError(result.error || 'Failed to delete backup');
      }
    } catch (error: any) {
      setError(error.message || 'Failed to delete backup');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-custom-gray text-custom-white' : 'bg-gray-100 text-black'}`}>
      {/* Content */}
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          
          {/* Error Display */}
          {error && (
            <div className={`p-4 rounded-lg mb-6 ${darkMode ? 'bg-red-900 border border-red-700' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className={`text-sm ${darkMode ? 'text-red-200' : 'text-red-800'}`}>{error}</span>
              </div>
            </div>
          )}

          {/* Backup List */}
          <div className={`rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={onBack}
                  className={`p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
                <h1 className="text-xl font-medium">Recover</h1>
                <div className="w-6"></div>
              </div>
              
              {/* Explanation text */}
              <div className={`mb-6 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Every time you add or sync a drive a backup is created in case of accidental deletion or an app crash. You may want to clear old backups periodically to free up memory. Note that these backups are only of file metadata and cannot restore any files that were actually deleted. These backups only restore the metadata within Archivist.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Backups</h2>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      const selectedBackupIds = Array.from(selectedBackups);
                      if (selectedBackupIds.length === 1) {
                        handleRestore(selectedBackupIds[0]);
                      }
                    }}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors bg-white text-black border border-gray-300 ${
                      selectedBackups.size !== 1 || isRestoring || isDeleting
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-gray-100 cursor-pointer'
                    }`}
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => {
                      const selectedBackupIds = Array.from(selectedBackups);
                      if (selectedBackupIds.length === 1) {
                        handleDelete(selectedBackupIds[0]);
                      }
                    }}
                    className={`p-2 rounded transition-colors ${
                      selectedBackups.size !== 1 || isRestoring || isDeleting
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-gray-200 cursor-pointer'
                    }`}
                    title="Delete selected backup"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {isLoading ? (
                <div className={`p-8 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <p>Loading backups...</p>
                </div>
              ) : groupedBackups.length === 0 ? (
                <div className={`p-8 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <p>No backups available</p>
                  <p className="text-sm mt-1">Backups are created automatically when drives are deleted</p>
                </div>
              ) : (
                groupedBackups.map((group) => (
                  <div key={group.driveId} className="mb-4">
                    {/* Drive/Group Header */}
                    <div className={`p-4 border-b ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => toggleGroupExpansion(group.driveId)}
                          className={`p-1 rounded transition-colors ${
                            darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100'
                          }`}
                        >
                          <svg 
                            className={`w-4 h-4 transition-transform ${
                              expandedGroups.has(group.driveId) ? 'rotate-90' : ''
                            }`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <h3 className="text-lg font-medium">
                          {group.driveName || `Drive ${group.driveId}`}
                        </h3>
                        <span className={`text-sm px-2 py-1 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                          {group.backups.length} backup{group.backups.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Backup List for this drive */}
                    {expandedGroups.has(group.driveId) && (
                      <div className={`${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                        {group.backups.map((backup) => (
                          <div key={backup.id} className="p-6 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                            <div className="flex items-center space-x-4">
                              {/* Selection Checkbox */}
                              <input
                                type="checkbox"
                                checked={selectedBackups.has(backup.id)}
                                onChange={() => toggleBackupSelection(backup.id)}
                                className="w-4 h-4 text-gray-400 bg-gray-100 border-gray-300 rounded focus:ring-gray-500 dark:focus:ring-gray-500 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                              />
                              
                              {/* Backup Info */}
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <h4 className="text-base font-medium">
                                    Backup #{backup.backupSequence || 1}
                                  </h4>
                                  <span className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-blue-100 text-blue-800'}`}>
                                    {backup.scanType === 'initial' ? 'Initial' : 'Sync'}
                                  </span>
                                </div>
                                <div className={`text-sm mt-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                  <p>{backup.scanType === 'initial' ? 'Added' : backup.scanType === 'sync' ? 'Synced' : 'Created'}: {new Date(backup.timestamp).toLocaleString()}</p>
                                  {backup.type === 'drive' && (
                                    <>
                                      {backup.totalCapacity && (
                                        <p>Capacity: {formatFileSize(backup.totalCapacity)}</p>
                                      )}
                                      {backup.usedSpace && (
                                        <p>Used Space: {formatFileSize(backup.usedSpace)}</p>
                                      )}
                                      {backup.freeSpace && (
                                        <p>Free Space: {formatFileSize(backup.freeSpace)}</p>
                                      )}
                                      {typeof backup.fileCount === 'number' && (
                                        <p>Files: {backup.fileCount.toLocaleString()}</p>
                                      )}
                                      {backup.formatType && (
                                        <p>Format: {backup.formatType}</p>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              
                              {/* Actions */}
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => toggleBackupExpansion(backup.id)}
                                  className={`p-2 rounded transition-colors ${
                                    darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100'
                                  }`}
                                >
                                  <svg 
                                    className={`w-5 h-5 transition-transform ${
                                      expandedBackups.has(backup.id) ? 'rotate-180' : ''
                                    }`} 
                                    fill="none" 
                                    stroke="currentColor" 
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            
                            {/* Expanded File Tree */}
                            {expandedBackups.has(backup.id) && (
                              <div className={`mt-4 p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                                <h4 className={`text-sm font-medium mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                  File Structure
                                </h4>
                                
                                {/* File table header matching main app */}
                                <div className={`w-full max-w-[90%] mx-auto px-4 pb-3 text-xs uppercase tracking-wide border-b ${darkMode ? 'border-gray-600' : 'border-gray-300'} ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                                  <div className="grid grid-cols-[7fr_3fr_2fr] gap-4 select-none items-center">
                                    <div className="text-left">Name</div>
                                    <div className="text-center">Modified</div>
                                    <div className="text-right">Size</div>
                                  </div>
                                </div>
                                
                                <div className="space-y-1 min-h-96 max-h-[70vh] overflow-y-auto pt-2">
                                  {(backupFileTrees.get(backup.id)?.length || 0) > 0 ? (
                                    <BackupFileTree 
                                      files={backupFileTrees.get(backup.id) || []}
                                      darkMode={darkMode}
                                      formatFileSize={formatFileSize}
                                    />
                                  ) : (
                                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} py-4 text-center`}>
                                      {backupFileTrees.has(backup.id) ? 'No files found in backup' : 'Loading file structure...'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Restore Confirmation Modal */}
      <RestoreConfirmation
        isOpen={showRestoreModal}
        onClose={() => {
          setShowRestoreModal(false);
          setSelectedBackup(null);
        }}
        onConfirm={handleRestoreConfirm}
        backup={selectedBackup}
        darkMode={darkMode}
        isRestoring={isRestoring}
      />

      {/* Delete Confirmation Modal */}
      {backupToDelete && (
        <div className={`fixed inset-0 z-[70] flex items-center justify-center ${darkMode ? 'bg-black bg-opacity-50' : 'bg-black bg-opacity-30'}`}>
          <div className={`p-6 rounded-lg shadow-lg max-w-md w-full mx-4 ${darkMode ? 'bg-gray-800' : 'bg-custom-white'}`}>
            <div className="flex items-center space-x-3 mb-4">
              <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <h3 className="text-lg font-medium">Delete Backup</h3>
            </div>
            
            <p className={`text-sm mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Are you sure you want to delete this backup? This action cannot be undone.
            </p>
            
            <div className={`p-3 rounded mb-6 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
              <p className="font-medium">
                {backupToDelete.type === 'drive' 
                  ? (backupToDelete.driveName || `Drive ${backupToDelete.driveId}`)
                  : 'Catalog Backup'
                }
              </p>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Created: {new Date(backupToDelete.timestamp).toLocaleString()}
              </p>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setBackupToDelete(null);
                }}
                disabled={isDeleting}
                className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${
                  isDeleting
                    ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                    : darkMode 
                      ? 'bg-gray-600 hover:bg-custom-gray text-gray-200'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${
                  isDeleting
                    ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

