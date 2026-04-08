---
sidebar_position: 1
title: Prerequisites
---

# Prerequisites

Before installing StreamGate, ensure your system meets the following requirements.

## Required Software

| Software | Minimum Version | Purpose |
|----------|----------------|---------|
| **Node.js** | 20.0.0+ | Runtime for both services |
| **npm** | 10.0.0+ | Package manager (ships with Node.js 20+) |
| **Git** | Any recent | Cloning the repository |

## Optional Software

| Software | Purpose | When Needed |
|----------|---------|-------------|
| **FFmpeg** | RTMP-to-HLS transcoding | Live streaming or converting MP4 to HLS |
| **Docker** & **Docker Compose** | Containerized deployment | If using Docker setup instead of manual |
| **PostgreSQL** | Production database | Production deployments (SQLite used in dev) |

---

## Installation by Platform

### Windows

**Node.js** (recommended: use the official installer or `winget`):

```powershell
# Option A: winget
winget install OpenJS.NodeJS.LTS

# Option B: Download from https://nodejs.org/en/download/
# Choose the LTS version (20+)
```

**FFmpeg**:

```powershell
# Option A: winget
winget install Gyan.FFmpeg

# Option B: Download from https://ffmpeg.org/download.html
# Extract and add the bin/ folder to your system PATH
```

**Git**:

```powershell
winget install Git.Git
```

### macOS

**Node.js** (recommended: use Homebrew or nvm):

```bash
# Option A: Homebrew
brew install node@20

# Option B: nvm (version manager, recommended for managing multiple versions)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

**FFmpeg**:

```bash
brew install ffmpeg
```

**Git** (included with Xcode Command Line Tools):

```bash
xcode-select --install
```

### Linux (Ubuntu/Debian)

**Node.js** (recommended: use NodeSource or nvm):

```bash
# Option A: NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option B: nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

**FFmpeg**:

```bash
sudo apt update
sudo apt install ffmpeg
```

**Git**:

```bash
sudo apt install git
```

---

## Verify Your Installation

Run all of these checks before proceeding:

```bash
# Node.js — must be 20+
node --version
# Expected: v20.x.x or higher

# npm — must be 10+
npm --version
# Expected: 10.x.x or higher

# Git
git --version
# Expected: git version 2.x.x

# FFmpeg (optional, needed for live streaming)
ffmpeg -version
# Expected: ffmpeg version X.X.X ...
```

:::tip Version too low?
If `node --version` shows a version below 20, consider using **nvm** (Node Version Manager) to install and switch between versions without affecting your system Node.js installation.
:::

## Hardware Requirements

StreamGate is lightweight. Minimum recommended specs for development:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 2 cores | 4 cores |
| **RAM** | 2 GB | 4 GB |
| **Disk** | 1 GB (plus stream storage) | 10 GB+ |
| **Network** | Localhost only for dev | Public IP for production |

:::info Production note
For production deployments with concurrent viewers, consider dedicated hosting with sufficient bandwidth. Each concurrent HLS viewer consumes approximately 2–8 Mbps depending on stream quality.
:::

## Next Steps

- [Manual Setup](./manual-setup.md) — Step-by-step installation and configuration
- [Docker Setup](./docker-setup.md) — Quick start with Docker Compose
