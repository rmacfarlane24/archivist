# Archivist - Folder Metadata Manager

A cross-platform Electron desktop application for scanning and managing metadata from folders and directories. Built with TypeScript, React, and Supabase for secure cloud storage with Row-Level Security (RLS).

## Features

- **Cross-platform**: Works on Windows, macOS, and Linux
- **Folder Picker**: Native folder selection dialog for choosing any directory
- **Metadata Scanning**: Extracts file/folder metadata (name, size, dates, type)
- **Cloud Storage**: Secure Supabase database with Row-Level Security (RLS)
- **User Authentication**: Email/password authentication with Supabase Auth
- **Admin Operations**: Secure admin operations with service role key
- **Modern UI**: Clean, responsive interface built with React and TailwindCSS
- **Type Safety**: Full TypeScript support for both main and renderer processes
- **Production Ready**: Optimized builds with embedded environment variables

## Tech Stack

- **Electron**: Cross-platform desktop app framework
- **TypeScript**: Type-safe development
- **React**: Frontend UI library
- **Vite**: Fast build tool and dev server
- **TailwindCSS**: Utility-first CSS framework
- **Supabase**: Cloud database with authentication and RLS
- **fs-extra**: Enhanced file system operations

## Project Structure

```
ARCH/
├── src/                    # Electron main process
│   ├── main.ts            # Main process entry point
│   ├── preload.ts         # Preload script for IPC
│   ├── supabase.ts        # Supabase client configuration
│   ├── supabase-admin.ts  # Admin operations with service role
│   ├── supabase-database.ts # Database operations with RLS
│   └── storage.ts         # Local storage utilities
├── app/                   # React renderer process
│   ├── index.html         # Main HTML file
│   └── src/
│       ├── main.tsx       # React entry point
│       ├── App.tsx        # Main React component
│       ├── AuthWrapper.tsx # Authentication wrapper
│       ├── supabase-client.ts # Client-side Supabase config
│       ├── supabase-admin-client.ts # Admin operations IPC
│       ├── index.css      # Global styles
│       └── types/
│           └── electron.d.ts  # TypeScript declarations
├── lib/                   # Compiled main process (generated)
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript config for renderer
├── tsconfig.electron.json # TypeScript config for main process
├── vite.config.ts         # Vite configuration
├── tailwind.config.js     # TailwindCSS configuration
├── supabase-schema.sql    # Database schema with RLS
├── SUPABASE_SETUP.md      # Supabase setup guide
├── RLS_SETUP.md           # Row-Level Security guide
├── PRODUCTION_BUILD.md    # Production build guide
├── env.production.template # Environment template
└── README.md             # This file
```

## Installation

1. **Clone or download the project**
   ```bash
   git clone <repository-url>
   cd ARCH
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase** (see [SUPABASE_SETUP.md](SUPABASE_SETUP.md))
   ```bash
   # Copy environment template
   cp env.production.template .env
   
   # Edit with your Supabase credentials
   nano .env
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

## Logging Configuration

The application provides configurable logging levels to control terminal output verbosity:

### Environment Variable Control
```bash
# Set logging level via environment variable
export LOG_LEVEL=debug    # Verbose logging (development)
export LOG_LEVEL=info     # Normal logging (default)
export LOG_LEVEL=warn     # Minimal logging (production)
export LOG_LEVEL=error    # Errors only
```

### Available Log Levels
- **`debug`**: Verbose logging including all initialization steps, database queries, and detailed progress
- **`info`**: Normal logging with important operations and progress updates (default)
- **`warn`**: Minimal logging with only warnings and errors
- **`error`**: Errors only - cleanest output

### Example Output Comparison
```bash
# LOG_LEVEL=debug (verbose)
[12:34:56] [INFO] Starting storage manager initialization...
[12:34:56] [DEBUG] Storage directory: /path/to/storage
[12:34:56] [DEBUG] Creating PerDriveStorage instance...
[12:34:56] [DEBUG] PerDriveStorage instance created successfully
[12:34:56] [INFO] Storage manager initialized successfully in 5ms

# LOG_LEVEL=info (normal - default)
[12:34:56] [INFO] Starting storage manager initialization...
[12:34:56] [INFO] Storage manager initialized successfully in 5ms

# LOG_LEVEL=warn (minimal)
# No output unless there are warnings or errors

# LOG_LEVEL=error (errors only)
# No output unless there are errors
```

## Development

### Available Scripts

- `npm run dev` - Start development server (Vite + Electron)
- `npm run build` - Build for production
- `npm run build:dev` - Build for development
- `npm run test:build` - Test production build
- `npm run package` - Package the app for distribution
- `npm run package:win` - Package for Windows
- `npm run package:mac` - Package for macOS
- `npm run package:linux` - Package for Linux

### Development Workflow

1. Run `npm run dev` to start the development environment
2. The app will open with hot reload enabled
3. Make changes to React components in `app/src/`
4. Make changes to main process in `src/`
5. Changes will automatically reload

## Supabase Integration

### Features

- **User Authentication**: Secure email/password authentication
- **Row-Level Security (RLS)**: Users can only access their own data
- **Cloud Storage**: Metadata stored securely in Supabase
- **Admin Operations**: Secure admin operations with service role key
- **Production Builds**: Optimized builds with embedded environment variables

### Testing

Run the following tests to verify your setup:

```bash
# Test environment variables
node test-env-vars.js

# Test Supabase connection
node test-supabase.js

# Test RLS policies
node test-rls-policies.js

# Test admin operations
node test-admin-operations.js

# Test production build
node test-production-build.js
```

## Usage

### Authentication

1. **Sign up** with your email and password
2. **Sign in** to access your data

### Main Interface

The app provides a single-page interface with:

1. **Header**: App title and description
2. **Controls**: 
   - "Select Folder" button for native folder picker
3. **Selected Folder Info**: Shows the currently selected folder path
4. **Metadata Table**: Detailed view of selected folder contents

### How to Use

1. **Launch the app**
2. **Sign in** with your Supabase account
3. **Click "Select Folder"** to open the native folder picker
4. **Choose any directory** on your system (including external drives)
5. **View metadata** in the table below (name, size, type, dates)
6. **Metadata is automatically stored** in your Supabase database

### Features

- **Folder Picker**: Use the native folder picker to select any directory
- **Persistent Storage**: Metadata is stored in SQLite and persists across app sessions
- **Error Handling**: Graceful error handling with user-friendly messages
- **Loading States**: Visual feedback during scanning operations

## Database Schema

The app uses Supabase with Row-Level Security (RLS) to store file metadata securely. The schema includes:

### Tables
- **profiles**: User profile information
- **drives**: User's storage drives
- **files**: File metadata for each drive
- **metadata**: Custom metadata for folders

### Security Features
- **Row-Level Security (RLS)**: Users can only access their own data
- **User Authentication**: Secure email/password authentication
- **Admin Operations**: Secure admin operations with service role key

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for detailed schema and setup instructions.

## Building for Distribution

### Prerequisites

- **Windows**: Visual Studio Build Tools
- **macOS**: Xcode Command Line Tools
- **Linux**: Standard build tools

### Build Commands

```bash
# Build for current platform
npm run package

# Build for specific platform
npm run package:win    # Windows
npm run package:mac    # macOS
npm run package:linux  # Linux
```

### Output

Built applications will be available in the `dist/` directory.

## Troubleshooting

### Common Issues

1. **Permission errors**: The app needs file system access permissions
2. **Supabase connection errors**: Check your environment variables in `.env`
3. **Authentication errors**: Verify your Supabase project settings
4. **Build errors**: Ensure all dependencies are installed and build tools are available

### Development Issues

- **TypeScript errors**: Run `npm install` to ensure all type definitions are installed
- **Hot reload not working**: Check that both Vite and Electron processes are running
- **IPC errors**: Verify the preload script is properly configured
- **RLS policy violations**: Check that users are properly authenticated

### Testing Your Setup

Run these tests to diagnose issues:

```bash
# Test environment variables
node test-env-vars.js

# Test Supabase connection
node test-supabase.js

# Test RLS policies
node test-rls-policies.js

# Test admin operations
node test-admin-operations.js

# Test production build
node test-production-build.js
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Documentation

- **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)**: Complete Supabase setup guide
- **[RLS_SETUP.md](RLS_SETUP.md)**: Row-Level Security configuration
- **[PRODUCTION_BUILD.md](PRODUCTION_BUILD.md)**: Production build guide
- **[ACCESSIBILITY.md](ACCESSIBILITY.md)**: Basic accessibility compliance requirements
- **[env.production.template](env.production.template)**: Environment variables template

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the documentation files above
3. Run the test scripts to diagnose issues
4. Open an issue on the repository

---

**Note**: This app requires appropriate permissions to access the file system. On macOS, you may need to grant "Full Disk Access" in System Preferences > Security & Privacy > Privacy > Full Disk Access. 