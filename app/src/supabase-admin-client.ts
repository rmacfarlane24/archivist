import { ipcRenderer } from 'electron';

// Admin operations interface for client-side
export interface AdminClientOperations {
  // User management
  getUserById(userId: string): Promise<any>;
  updateUserProfile(userId: string, updates: any): Promise<any>;
  deleteUser(userId: string): Promise<boolean>;
  
  // Data management
  getAllUserData(userId: string): Promise<any>;
  deleteUserData(userId: string): Promise<boolean>;
  migrateUserData(fromUserId: string, toUserId: string): Promise<boolean>;
  
  // System operations
  getSystemStats(): Promise<any>;
  cleanupOrphanedData(): Promise<boolean>;
  backupUserData(userId: string): Promise<any>;
}

// Client-side admin operations class
export class SupabaseAdminClient implements AdminClientOperations {
  // User management operations
  async getUserById(userId: string): Promise<any> {
    try {
      return await ipcRenderer.invoke('admin-get-user', userId);
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async updateUserProfile(userId: string, updates: any): Promise<any> {
    try {
      return await ipcRenderer.invoke('admin-update-user', userId, updates);
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<boolean> {
    try {
      return await ipcRenderer.invoke('admin-delete-user', userId);
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  // Data management operations
  async getAllUserData(userId: string): Promise<any> {
    try {
      return await ipcRenderer.invoke('admin-get-user-data', userId);
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  }

  async deleteUserData(userId: string): Promise<boolean> {
    try {
      return await ipcRenderer.invoke('admin-delete-user-data', userId);
    } catch (error) {
      console.error('Error deleting user data:', error);
      throw error;
    }
  }

  async migrateUserData(fromUserId: string, toUserId: string): Promise<boolean> {
    try {
      return await ipcRenderer.invoke('admin-migrate-user-data', fromUserId, toUserId);
    } catch (error) {
      console.error('Error migrating user data:', error);
      throw error;
    }
  }

  // System operations
  async getSystemStats(): Promise<any> {
    try {
      return await ipcRenderer.invoke('admin-get-system-stats');
    } catch (error) {
      console.error('Error getting system stats:', error);
      throw error;
    }
  }

  async cleanupOrphanedData(): Promise<boolean> {
    try {
      return await ipcRenderer.invoke('admin-cleanup-orphaned-data');
    } catch (error) {
      console.error('Error cleaning up orphaned data:', error);
      throw error;
    }
  }

  async backupUserData(userId: string): Promise<any> {
    try {
      return await ipcRenderer.invoke('admin-backup-user-data', userId);
    } catch (error) {
      console.error('Error backing up user data:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const supabaseAdminClient = new SupabaseAdminClient(); 