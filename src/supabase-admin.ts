import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Service role key for admin operations (only available in main process)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Admin operations will be disabled.');
}

// Create admin client with service role key
const supabaseAdminClient = SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(
      process.env.REACT_APP_SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
  : null;

// Admin operations interface
export interface AdminOperations {
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

// Secure admin operations class
export class SupabaseAdmin implements AdminOperations {
  private isAuthorized(): boolean {
    if (!supabaseAdminClient) {
      console.error('❌ Admin operations disabled: SUPABASE_SERVICE_ROLE_KEY not set');
      return false;
    }
    return true;
  }

  // User management operations
  async getUserById(userId: string): Promise<any> {
    if (!this.isAuthorized()) return null;

    try {
      const { data, error } = await supabaseAdminClient!
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching user by ID:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserById:', error);
      return null;
    }
  }

  async updateUserProfile(userId: string, updates: any): Promise<any> {
    if (!this.isAuthorized()) return null;

    try {
      const { data, error } = await supabaseAdminClient!
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('Error updating user profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in updateUserProfile:', error);
      return null;
    }
  }

  async deleteUser(userId: string): Promise<boolean> {
    if (!this.isAuthorized()) return false;

    try {
      // Delete user data first (cascade will handle the rest)
      const { error: drivesError } = await supabaseAdminClient!
        .from('drives')
        .delete()
        .eq('user_id', userId);

      if (drivesError) {
        console.error('Error deleting user drives:', drivesError);
        return false;
      }

      // Delete user from auth (this will cascade to profiles)
      const { error: authError } = await supabaseAdminClient!.auth.admin.deleteUser(userId);

      if (authError) {
        console.error('Error deleting user from auth:', authError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in deleteUser:', error);
      return false;
    }
  }

  // Data management operations
  async getAllUserData(userId: string): Promise<any> {
    if (!this.isAuthorized()) return null;

    try {
      const [drives, files, metadata] = await Promise.all([
        supabaseAdminClient!.from('drives').select('*').eq('user_id', userId),
        supabaseAdminClient!.from('files').select('*').eq('user_id', userId),
        supabaseAdminClient!.from('metadata').select('*').eq('user_id', userId)
      ]);

      return {
        drives: drives.data || [],
        files: files.data || [],
        metadata: metadata.data || []
      };
    } catch (error) {
      console.error('Error in getAllUserData:', error);
      return null;
    }
  }

  async deleteUserData(userId: string): Promise<boolean> {
    if (!this.isAuthorized()) return false;

    try {
      // Delete all user data (cascade will handle relationships)
      const { error } = await supabaseAdminClient!
        .from('drives')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting user data:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in deleteUserData:', error);
      return false;
    }
  }

  async migrateUserData(fromUserId: string, toUserId: string): Promise<boolean> {
    if (!this.isAuthorized()) return false;

    try {
      // Get all data from source user
      const userData = await this.getAllUserData(fromUserId);
      if (!userData) return false;

      // Update user_id for all data
      const updates = [];

      // Update drives
      for (const drive of userData.drives) {
        updates.push(
          supabaseAdminClient!.from('drives')
            .update({ user_id: toUserId })
            .eq('id', drive.id)
        );
      }

      // Update files
      for (const file of userData.files) {
        updates.push(
          supabaseAdminClient!.from('files')
            .update({ user_id: toUserId })
            .eq('id', file.id)
        );
      }

      // Update metadata
      for (const meta of userData.metadata) {
        updates.push(
          supabaseAdminClient!.from('metadata')
            .update({ user_id: toUserId })
            .eq('id', meta.id)
        );
      }

      // Execute all updates
      await Promise.all(updates);

      // Delete source user
      await this.deleteUser(fromUserId);

      return true;
    } catch (error) {
      console.error('Error in migrateUserData:', error);
      return false;
    }
  }

  // System operations
  async getSystemStats(): Promise<any> {
    if (!this.isAuthorized()) return null;

    try {
      const [users, drives, files, metadata] = await Promise.all([
        supabaseAdminClient!.from('profiles').select('id', { count: 'exact' }),
        supabaseAdminClient!.from('drives').select('id', { count: 'exact' }),
        supabaseAdminClient!.from('files').select('id', { count: 'exact' }),
        supabaseAdminClient!.from('metadata').select('id', { count: 'exact' })
      ]);

      return {
        users: users.count || 0,
        drives: drives.count || 0,
        files: files.count || 0,
        metadata: metadata.count || 0
      };
    } catch (error) {
      console.error('Error in getSystemStats:', error);
      return null;
    }
  }

  async cleanupOrphanedData(): Promise<boolean> {
    if (!this.isAuthorized()) return false;

    try {
      // Find orphaned files (files without valid drive_id)
      const { data: orphanedFiles } = await supabaseAdminClient!
        .from('files')
        .select('id')
        .not('drive_id', 'in', `(select id from drives)`);

      if (orphanedFiles && orphanedFiles.length > 0) {
        const { error } = await supabaseAdminClient!
          .from('files')
          .delete()
          .in('id', orphanedFiles.map(f => f.id));

        if (error) {
          console.error('Error cleaning up orphaned files:', error);
          return false;
        }

        console.log(`Cleaned up ${orphanedFiles.length} orphaned files`);
      }

      return true;
    } catch (error) {
      console.error('Error in cleanupOrphanedData:', error);
      return false;
    }
  }

  async backupUserData(userId: string): Promise<any> {
    if (!this.isAuthorized()) return null;

    try {
      const userData = await this.getAllUserData(userId);
      const user = await this.getUserById(userId);

      return {
        user,
        data: userData,
        backupDate: new Date().toISOString(),
        version: '1.0'
      };
    } catch (error) {
      console.error('Error in backupUserData:', error);
      return null;
    }
  }
}

// Export singleton instance
export const supabaseAdmin = new SupabaseAdmin(); 