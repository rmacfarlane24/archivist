import { SupportedStorage } from '@supabase/auth-js'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export class ElectronStorageAdapter implements SupportedStorage {
  private storagePath: string
  private data: Record<string, string> = {}

  constructor() {
    // Use Electron's user data directory for persistent storage
    this.storagePath = path.join(app.getPath('userData'), 'supabase-auth.json')
    this.loadData()
  }

  private loadData(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const fileContent = fs.readFileSync(this.storagePath, 'utf8')
        this.data = JSON.parse(fileContent)
      }
    } catch (error) {
      console.error('Error loading auth storage:', error)
      this.data = {}
    }
  }

  private saveData(): void {
    try {
      // Ensure the directory exists
      const dir = path.dirname(this.storagePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2))
    } catch (error) {
      console.error('Error saving auth storage:', error)
    }
  }

  getItem(key: string): string | null {
    return this.data[key] || null
  }

  setItem(key: string, value: string): void {
    this.data[key] = value
    this.saveData()
  }

  removeItem(key: string): void {
    delete this.data[key]
    this.saveData()
  }
}
